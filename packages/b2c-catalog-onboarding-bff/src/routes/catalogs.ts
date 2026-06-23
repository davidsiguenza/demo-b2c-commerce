import { Hono } from 'hono';
import {
    listCatalogs,
    findCatalog,
    DataApiError,
    getProduct,
    getPriceBookEntry,
    getInventoryRecord,
    patchProduct,
    upsertInventoryRecord,
    type ProductResource,
} from '@/b2c/data-api';
import { listAllUploads, uploadsForCatalog } from '@/lib/upload-index';
import { loadConfig } from '@/lib/config';
import {
    getJobExecution,
    triggerSearchReindex,
} from '@/b2c/jobs';
import { captureApiCalls } from '@/lib/api-trace';

const config = loadConfig();

export const catalogsRouter = new Hono();

type CatalogSummary = {
    masterCatalogId: string;
    /** Display name from the catalog name in B2C, when available. */
    displayName: string | null;
    catalogExists: boolean;
    uploadCount: number;
    lastUploadAt: string | null;
    lastUploadStatus: string | null;
    knownProductIds: string[];
};

const VALID_CATALOG_ID = /^[A-Za-z0-9_-]{1,100}$/;

catalogsRouter.get('/catalogs', async (c) => {
    try {
        const [allCatalogs, allUploads] = await Promise.all([
            listCatalogs(config),
            listAllUploads(),
        ]);

        const idsFromCatalogs = new Set(
            allCatalogs.filter((cat) => cat.id !== config.storefrontCatalogId).map((cat) => cat.id)
        );
        const idsFromUploads = new Set(allUploads.map((u) => u.masterCatalogId));
        const allIds = new Set([...idsFromCatalogs, ...idsFromUploads]);

        const summaries: CatalogSummary[] = [...allIds].map((masterCatalogId) => {
            const catalog = allCatalogs.find((c) => c.id === masterCatalogId) ?? null;
            const uploads = allUploads
                .filter((u) => u.masterCatalogId === masterCatalogId)
                .sort(
                    (a, b) =>
                        new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime()
                );
            const last = uploads[0] ?? null;
            const knownProductIds = aggregateProductIds(uploads);
            return {
                masterCatalogId,
                displayName: catalog?.name?.default ?? catalog?.name?.['x-default'] ?? null,
                catalogExists: catalog !== null,
                uploadCount: uploads.length,
                lastUploadAt: last?.receivedAt ?? null,
                lastUploadStatus: last?.status ?? null,
                knownProductIds,
            };
        });

        // Sort by most recent upload first, then by id
        summaries.sort((a, b) => {
            if (a.lastUploadAt && b.lastUploadAt) {
                return new Date(b.lastUploadAt).getTime() - new Date(a.lastUploadAt).getTime();
            }
            if (a.lastUploadAt) return -1;
            if (b.lastUploadAt) return 1;
            return a.masterCatalogId.localeCompare(b.masterCatalogId);
        });

        return c.json({ ok: true, count: summaries.length, catalogs: summaries });
    } catch (err) {
        return c.json({ ok: false, error: String(err) }, 500);
    }
});

catalogsRouter.get('/catalogs/:masterCatalogId', async (c) => {
    const masterCatalogId = c.req.param('masterCatalogId');
    if (!VALID_CATALOG_ID.test(masterCatalogId)) {
        return c.json({ ok: false, error: 'Invalid masterCatalogId.' }, 400);
    }

    try {
        let catalog = null;
        try {
            catalog = await findCatalog(config, masterCatalogId);
        } catch (err) {
            if (!(err instanceof DataApiError) || err.status !== 404) throw err;
        }
        const uploads = (await uploadsForCatalog(masterCatalogId)).sort(
            (a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime()
        );
        const productIds = aggregateProductIds(uploads);

        return c.json({
            ok: true,
            catalog: {
                masterCatalogId,
                displayName: catalog?.name?.default ?? catalog?.name?.['x-default'] ?? null,
                catalogExists: catalog !== null,
                productCount: productIds.length,
                productIds,
                uploads: uploads.map((u) => ({
                    id: u.id,
                    receivedAt: u.receivedAt,
                    status: u.status,
                    sourceFilename: u.sourceFilename,
                    sourceBytes: u.sourceBytes,
                    productCount: u.validation?.productCount ?? null,
                    newCategoryIds: u.transform?.newCategoryIds ?? [],
                    reusedCategoryIds: u.transform?.reusedCategoryIds ?? [],
                    job: u.job ?? null,
                })),
            },
        });
    } catch (err) {
        return c.json({ ok: false, error: String(err) }, 500);
    }
});

function aggregateProductIds(uploads: Awaited<ReturnType<typeof listAllUploads>>): string[] {
    const seen = new Set<string>();
    for (const u of uploads) {
        for (const pid of u.transform?.productIds ?? []) {
            seen.add(pid);
        }
    }
    return [...seen];
}

// ─────────────────────────────────────────────────────────────────────────────
// Live product editor — list + batch patch
//
// The catalog upload pipeline writes every localized field with xml:lang
// "x-default", which OCAPI Data v23.2 surfaces as the `default` map key. We
// read/write only that key here; multi-locale support can be layered on later
// without changing the wire format.
// ─────────────────────────────────────────────────────────────────────────────

const LOCALE_KEY = 'default';

type EditableProduct = {
    id: string;
    name: string | null;
    shortDescription: string | null;
    longDescription: string | null;
    online: boolean | null;
    brand: string | null;
    manufacturerName: string | null;
    price: number | null;
    currency: string | null;
    stock: number | null;
};

/**
 * GET /api/catalogs/:masterCatalogId/products
 *
 * Returns the live edit-shape of products in the master catalog. For each
 * product we fan out three reads in parallel: the product resource itself
 * (for name/desc/online), its price-book entry in the default pricebook, and
 * its inventory record in the default inventory list. Missing pricing or
 * inventory rows resolve to null on the wire — the UI draws an empty input
 * the user can fill.
 *
 * Pagination uses `start` and `count` query params (defaults: 0/25, max 200).
 */
catalogsRouter.get('/catalogs/:masterCatalogId/products', async (c) => {
    const masterCatalogId = c.req.param('masterCatalogId');
    if (!VALID_CATALOG_ID.test(masterCatalogId)) {
        return c.json({ ok: false, error: 'Invalid masterCatalogId.' }, 400);
    }
    const start = clampInt(c.req.query('start'), 0, 0, 10_000);
    const count = clampInt(c.req.query('count'), 25, 1, 200);

    try {
        const masterCatalog = await findCatalog(config, masterCatalogId);
        if (!masterCatalog) {
            return c.json(
                { ok: false, error: `Catalog "${masterCatalogId}" doesn't exist yet. Upload products first.` },
                404
            );
        }

        // OCAPI Data v23.2 has no catalog-scoped product listing — productIds
        // come from the upload index (the BFF wrote the import zip, so it knows
        // the SKUs by construction). One read per SKU.
        const allIds = aggregateProductIds(await uploadsForCatalog(masterCatalogId));
        const total = allIds.length;
        const pageIds = allIds.slice(start, start + count);

        const enriched = await Promise.all(
            pageIds.map(async (id): Promise<EditableProduct> => {
                const [productRes, priceRes, invRes] = await Promise.allSettled([
                    getProduct(
                        config,
                        id,
                        '(id,name,short_description,long_description,online_flag,brand,manufacturer_name,searchable)'
                    ),
                    getPriceBookEntry(config, config.defaultPricebookId, id),
                    getInventoryRecord(config, config.defaultInventoryListId, id),
                ]);
                const p = productRes.status === 'fulfilled' ? productRes.value : null;
                const priceEntry = priceRes.status === 'fulfilled' ? priceRes.value : null;
                const invRecord = invRes.status === 'fulfilled' ? invRes.value : null;

                const listPrice =
                    priceEntry && typeof priceEntry.list_price === 'object'
                        ? priceEntry.list_price.value
                        : typeof priceEntry?.list_price === 'number'
                          ? priceEntry.list_price
                          : null;
                const currency =
                    priceEntry && typeof priceEntry.list_price === 'object'
                        ? priceEntry.list_price.currency_mnemonic ?? null
                        : null;

                return {
                    id,
                    name: readLocalized(p?.name),
                    shortDescription: readMarkup(p?.short_description),
                    longDescription: readMarkup(p?.long_description),
                    online: p?.online_flag?.[LOCALE_KEY] ?? p?.online ?? null,
                    brand: p?.brand ?? null,
                    manufacturerName: p?.manufacturer_name ?? null,
                    price: listPrice,
                    currency,
                    stock: invRecord?.allocation ?? invRecord?.ats ?? null,
                };
            })
        );

        return c.json({
            ok: true,
            masterCatalogId,
            pricebookId: config.defaultPricebookId,
            inventoryListId: config.defaultInventoryListId,
            start,
            count,
            total,
            products: enriched,
        });
    } catch (err) {
        return c.json({ ok: false, error: String(err) }, ocapiStatus(err));
    }
});

/** Plain string lookup against an OCAPI localized map. */
function readLocalized(map: Record<string, string> | undefined): string | null {
    if (!map) return null;
    return map[LOCALE_KEY] ?? map['x-default'] ?? null;
}

/**
 * OCAPI returns short/long descriptions as markup_text objects:
 *   { default: { _type: 'markup_text', markup: '…', source: '…' } }
 * but accepts plain strings on PATCH input. We surface `source` (the original
 * plain text) when present so users edit clean strings, never markup HTML.
 */
function readMarkup(map: unknown): string | null {
    if (!map || typeof map !== 'object') return null;
    const m = map as Record<string, unknown>;
    const v = m[LOCALE_KEY] ?? m['x-default'];
    if (typeof v === 'string') return v;
    if (v && typeof v === 'object') {
        const obj = v as { source?: string; markup?: string };
        return obj.source ?? obj.markup ?? null;
    }
    return null;
}

type ProductPatch = {
    id: string;
    name?: string;
    shortDescription?: string;
    longDescription?: string;
    online?: boolean;
    price?: number;
    currency?: string;
    stock?: number;
};

type PatchResult =
    | { id: string; ok: true; appliedFields: string[] }
    | { id: string; ok: false; failedFields: { field: string; error: string }[] };

/**
 * PATCH /api/catalogs/:masterCatalogId/products
 *
 * Body: { patches: ProductPatch[] }
 *
 * Each patch is processed independently and concurrently. For each SKU we may
 * fan out to three OCAPI calls (product / price-book entry / inventory
 * record) — each runs in parallel and its outcome is recorded per-field, so a
 * batch with one bad SKU still applies the rest.
 *
 * If `REINDEX_JOB_ID` is set, after the batch completes we trigger the search
 * reindex job and return its execution id so the UI can poll. When unset we
 * skip the trigger and the storefront falls back to SFCC's scheduled
 * delta-index (5-15min).
 */
catalogsRouter.patch('/catalogs/:masterCatalogId/products', async (c) => {
    const masterCatalogId = c.req.param('masterCatalogId');
    if (!VALID_CATALOG_ID.test(masterCatalogId)) {
        return c.json({ ok: false, error: 'Invalid masterCatalogId.' }, 400);
    }
    const body = (await c.req.json().catch(() => null)) as { patches?: ProductPatch[] } | null;
    if (!body || !Array.isArray(body.patches) || body.patches.length === 0) {
        return c.json({ ok: false, error: 'Body must be { patches: ProductPatch[] } with ≥1 entry.' }, 400);
    }
    if (body.patches.length > 200) {
        return c.json({ ok: false, error: 'Max 200 patches per batch.' }, 400);
    }

    const patches = body.patches;
    // Capture every SFCC API call made inside this request (live-edit
    // PATCHes + reindex trigger) so the admin UI can show them in an
    // expandable panel after the save completes.
    const { result, calls: apiCalls } = await captureApiCalls(async () => {
        const results: PatchResult[] = await Promise.all(
            patches.map((p) => applyOneProductPatch(p))
        );

        let reindex: { triggered: boolean; jobId?: string; executionId?: string; error?: string } = {
            triggered: false,
        };
        const anyOk = results.some((r) => r.ok);
        if (anyOk && config.reindexJobId) {
            try {
                const exec = await triggerSearchReindex(config, config.reindexJobId);
                reindex = {
                    triggered: true,
                    jobId: config.reindexJobId,
                    executionId: exec.id,
                };
            } catch (err) {
                reindex = {
                    triggered: false,
                    jobId: config.reindexJobId,
                    error: String(err),
                };
            }
        }
        return { results, reindex };
    });

    return c.json({
        ok: true,
        masterCatalogId,
        updated: result.results.filter((r) => r.ok).length,
        failed: result.results.filter((r) => !r.ok).length,
        results: result.results,
        reindex: result.reindex,
        apiCalls,
    });
});

/**
 * GET /api/jobs/:jobId/executions/:executionId
 *
 * Pass-through so the admin UI can poll a triggered job (reindex, site-archive
 * import) without re-implementing OCAPI client-side.
 */
catalogsRouter.get('/jobs/:jobId/executions/:executionId', async (c) => {
    const jobId = c.req.param('jobId');
    const executionId = c.req.param('executionId');
    try {
        const exec = await getJobExecution(config, jobId, executionId);
        return c.json({
            ok: true,
            id: exec.id,
            jobId: exec.job_id,
            status: exec.status ?? exec.execution_status ?? 'PENDING',
            startTime: exec.start_time ?? null,
            endTime: exec.end_time ?? null,
        });
    } catch (err) {
        return c.json({ ok: false, error: String(err) }, ocapiStatus(err));
    }
});

/** Map an OCAPI Data error status onto Hono's narrow ContentfulStatusCode set. */
function ocapiStatus(err: unknown): 400 | 404 | 500 {
    if (err instanceof DataApiError) {
        if (err.status === 400) return 400;
        if (err.status === 404) return 404;
    }
    return 500;
}

async function applyOneProductPatch(patch: ProductPatch): Promise<PatchResult> {
    if (!patch.id || typeof patch.id !== 'string') {
        return {
            id: String(patch.id ?? '?'),
            ok: false,
            failedFields: [{ field: 'id', error: 'Missing or invalid id' }],
        };
    }

    const productBody: Partial<ProductResource> = {};
    if (typeof patch.name === 'string') productBody.name = { [LOCALE_KEY]: patch.name };
    // OCAPI Data v23.2 requires the markup_text shape for short/long description —
    // a plain string body returns 400 TypeDecodingException ("expected START_OBJECT").
    // We pass the same value as both `markup` and `source` so the storefront sees
    // unformatted text identical to what the user typed.
    if (typeof patch.shortDescription === 'string')
        productBody.short_description = {
            [LOCALE_KEY]: { markup: patch.shortDescription, source: patch.shortDescription },
        };
    if (typeof patch.longDescription === 'string')
        productBody.long_description = {
            [LOCALE_KEY]: { markup: patch.longDescription, source: patch.longDescription },
        };
    // OCAPI Data uses online_flag (a per-locale map) on read AND write — accepting
    // the plain `online` boolean here just means we don't expose the locale-keyed
    // shape to the UI; we still write to the map under LOCALE_KEY.
    if (typeof patch.online === 'boolean') productBody.online_flag = { [LOCALE_KEY]: patch.online };

    const tasks: Array<{ field: string; promise: Promise<unknown> }> = [];

    if (Object.keys(productBody).length > 0) {
        tasks.push({
            field: 'product',
            promise: patchProduct(config, patch.id, productBody),
        });
    }
    // Live price edits are disabled on this sandbox — see BLOCKERS.md
    // (`Live price edit on zzse-258 — ResourcePathNotFoundException`).
    // Surface a clear error instead of a misleading OCAPI 404.
    if (typeof patch.price === 'number' && Number.isFinite(patch.price)) {
        tasks.push({
            field: 'price',
            promise: Promise.reject(
                new Error(
                    'Price live-edit is disabled: OCAPI Data does not expose price_book_entries on this sandbox. See BLOCKERS.md for fix options (XML import / SCAPI Pricing / different sandbox).'
                )
            ),
        });
    }
    if (typeof patch.stock === 'number' && Number.isFinite(patch.stock)) {
        tasks.push({
            field: 'stock',
            promise: upsertInventoryRecord(config, config.defaultInventoryListId, patch.id, {
                allocation: Math.max(0, Math.floor(patch.stock)),
                perpetual: false,
            }),
        });
    }

    if (tasks.length === 0) {
        return {
            id: patch.id,
            ok: false,
            failedFields: [{ field: '*', error: 'No editable fields supplied' }],
        };
    }

    const settled = await Promise.allSettled(tasks.map((t) => t.promise));
    const failedFields = settled
        .map((s, i) => ({ s, field: tasks[i]!.field }))
        .filter(({ s }) => s.status === 'rejected')
        .map(({ s, field }) => ({
            field,
            error: s.status === 'rejected' ? String(s.reason) : '',
        }));
    const appliedFields = tasks.map((t) => t.field).filter((_, i) => settled[i]!.status === 'fulfilled');

    if (failedFields.length > 0 && appliedFields.length === 0) {
        return { id: patch.id, ok: false, failedFields };
    }
    if (failedFields.length > 0) {
        // Partial success: surface as failure so UI can highlight, but include the bits that landed.
        return { id: patch.id, ok: false, failedFields };
    }
    return { id: patch.id, ok: true, appliedFields };
}

function clampInt(raw: string | undefined, dflt: number, min: number, max: number): number {
    if (raw === undefined) return dflt;
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n)) return dflt;
    return Math.max(min, Math.min(max, n));
}
