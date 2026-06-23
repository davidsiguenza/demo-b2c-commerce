import 'dotenv/config';
import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { loadConfig } from '@/lib/config';
import { getAccessToken } from '@/b2c/auth';
import {
    listCatalogs,
    findCatalog,
    getCategory,
    dataApi,
    DataApiError,
    listInventoryLists,
} from '@/b2c/data-api';
import { uploadsRouter } from '@/routes/uploads';
import { catalogsRouter } from '@/routes/catalogs';
import { discoverRouter } from '@/routes/discover';

const app = new Hono();
app.use('*', logger());

const config = loadConfig();

app.get('/health', (c) => c.json({ status: 'ok', tenant: config.b2cTenant }));

/** Sanity probe: confirms AM auth and Data API access. */
app.get('/diag/auth', async (c) => {
    try {
        const token = await getAccessToken(config);
        return c.json({ ok: true, tokenPrefix: token.slice(0, 24) + '…' });
    } catch (err) {
        return c.json({ ok: false, error: String(err) }, 500);
    }
});

app.route('/api', uploadsRouter);
app.route('/api', catalogsRouter);
app.route('/api', discoverRouter);

// Serve admin SPA from /public. Must come AFTER the API routes so /api/* hits the
// JSON handlers, not the static fallback.
app.use('/*', serveStatic({ root: './public' }));
app.use('/', serveStatic({ path: './public/index.html' }));

/**
 * Confirms the pricebook and inventory list referenced by .env exist in the
 * sandbox. If either probe is `null`, the BFF's PATCH /catalogs/.../products
 * fails for live edit because OCAPI Data PUT requires the parent resource to
 * exist (it doesn't auto-create pricebooks or inventory lists).
 */
app.get('/diag/edit-targets', async (c) => {
    const pricebookId = config.defaultPricebookId;
    const inventoryListId = config.defaultInventoryListId;

    // OCAPI Data v23.2 doesn't expose `/price_books/{id}` as a single resource —
    // the only supported reads are `/price_books` (list) and the price_book_entries
    // sub-resource. So we list and look our pricebook up by id.
    const probePricebook = async () => {
        try {
            const { data } = await dataApi<{ data?: Array<{ id: string; currency?: string }> }>(
                config,
                `/price_books?count=200`
            );
            const list = data?.data ?? [];
            const found = list.find((p) => p.id === pricebookId) ?? null;
            return {
                id: pricebookId,
                exists: Boolean(found),
                currency: found?.currency ?? null,
                allPricebooks: list.map((p) => p.id),
            };
        } catch (err) {
            if (err instanceof DataApiError) {
                return { id: pricebookId, exists: false, status: err.status, body: err.body };
            }
            return { id: pricebookId, exists: false, error: String(err) };
        }
    };

    const probeInventory = async () => {
        try {
            const lists = await listInventoryLists(config);
            const found = lists.find((l) => l.id === inventoryListId) ?? null;
            return { id: inventoryListId, exists: Boolean(found), allLists: lists.map((l) => l.id) };
        } catch (err) {
            return { id: inventoryListId, exists: false, error: String(err) };
        }
    };

    const [pricebook, inventory] = await Promise.all([probePricebook(), probeInventory()]);
    return c.json({ ok: pricebook.exists && inventory.exists, pricebook, inventory });
});

/**
 * Per-SKU probe: hits the three live-edit endpoints in read-mode so we can
 * tell exactly which resource path is misconfigured. Pass `?sku=...`.
 */
app.get('/diag/sku/:sku', async (c) => {
    const sku = c.req.param('sku');
    if (!/^[a-z0-9][a-z0-9._-]*$/i.test(sku)) {
        return c.json({ ok: false, error: 'invalid sku' }, 400);
    }
    const probe = async (path: string) => {
        try {
            const { status, data } = await dataApi(config, path);
            return { ok: true as const, status, sample: typeof data === 'object' ? Object.keys(data ?? {}).slice(0, 8) : null };
        } catch (err) {
            if (err instanceof DataApiError) {
                return { ok: false as const, status: err.status, body: err.body };
            }
            return { ok: false as const, error: String(err) };
        }
    };
    const [product, priceEntry, inventory] = await Promise.all([
        probe(`/products/${encodeURIComponent(sku)}`),
        probe(`/price_books/${encodeURIComponent(config.defaultPricebookId)}/price_book_entries/${encodeURIComponent(sku)}`),
        probe(`/inventory_lists/${encodeURIComponent(config.defaultInventoryListId)}/product_inventory_records/${encodeURIComponent(sku)}`),
    ]);
    return c.json({
        sku,
        pricebookId: config.defaultPricebookId,
        inventoryListId: config.defaultInventoryListId,
        product,
        priceEntry,
        inventory,
    });
});

/**
 * Dry-run PUT against price_book_entry and inventory_record so we can see
 * the exact OCAPI fault when the live edit "save" lights up. Hit:
 *
 *   GET /diag/put-test/<sku>?price=12.5&stock=5
 */
app.get('/diag/put-test/:sku', async (c) => {
    const sku = c.req.param('sku');
    if (!/^[a-z0-9][a-z0-9._-]*$/i.test(sku)) {
        return c.json({ ok: false, error: 'invalid sku' }, 400);
    }
    const priceQ = c.req.query('price');
    const stockQ = c.req.query('stock');

    const priceResult = priceQ
        ? await (async () => {
              try {
                  const { status, data } = await dataApi(
                      config,
                      `/price_books/${encodeURIComponent(config.defaultPricebookId)}/price_book_entries/${encodeURIComponent(sku)}`,
                      {
                          method: 'PUT',
                          body: JSON.stringify({
                              list_price: { value: Number(priceQ), currency_mnemonic: 'USD' },
                          }),
                      }
                  );
                  return { ok: true, status, data };
              } catch (err) {
                  if (err instanceof DataApiError) return { ok: false, status: err.status, body: err.body };
                  return { ok: false, error: String(err) };
              }
          })()
        : { skipped: true };

    const stockResult = stockQ
        ? await (async () => {
              try {
                  const { status, data } = await dataApi(
                      config,
                      `/inventory_lists/${encodeURIComponent(config.defaultInventoryListId)}/product_inventory_records/${encodeURIComponent(sku)}`,
                      {
                          method: 'PUT',
                          body: JSON.stringify({ allocation: Number(stockQ), perpetual: false }),
                      }
                  );
                  return { ok: true, status, data };
              } catch (err) {
                  if (err instanceof DataApiError) return { ok: false, status: err.status, body: err.body };
                  return { ok: false, error: String(err) };
              }
          })()
        : { skipped: true };

    return c.json({ sku, price: priceResult, stock: stockResult });
});

app.get('/diag/data-api', async (c) => {
    try {
        const catalogs = await listCatalogs(config);
        return c.json({
            ok: true,
            count: catalogs.length,
            ids: catalogs.map((c) => c.id),
        });
    } catch (err) {
        return c.json({ ok: false, error: String(err) }, 500);
    }
});

/**
 * Test endpoint: simulates the discovery phase of an upload.
 * - Reports whether the master catalog already exists (it'll be created by the
 *   site-archive-import job on first upload otherwise — Data API v23.2 doesn't
 *   support PUT on /catalogs)
 * - Reads top-level categories of the storefront catalog so the upload pipeline
 *   knows which categories already exist (vs. need to be created from the zip)
 */
app.get('/api/test/discovery/:masterCatalogId', async (c) => {
    const masterCatalogId = c.req.param('masterCatalogId');
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(masterCatalogId)) {
        return c.json({ ok: false, error: 'invalid masterCatalogId' }, 400);
    }

    try {
        const masterCatalog = await findCatalog(config, masterCatalogId);

        const root = await getCategory(config, config.storefrontCatalogId, 'root', 2);
        const topLevel = (root.categories ?? []).map((cat) => ({
            id: cat.id,
            name: cat.name?.default ?? cat.name?.['x-default'] ?? cat.id,
            online: cat.online ?? null,
            childCount: cat.categories?.length ?? 0,
        }));

        return c.json({
            ok: true,
            master: {
                catalogId: masterCatalogId,
                exists: masterCatalog !== null,
                displayName: masterCatalog?.name?.default ?? null,
                note:
                    masterCatalog === null
                        ? 'Will be created automatically on first site-archive-import.'
                        : 'Existing catalog. Uploads will MERGE into it.',
            },
            storefront: {
                catalogId: config.storefrontCatalogId,
                topLevelCategoryCount: topLevel.length,
                topLevelCategories: topLevel,
            },
        });
    } catch (err) {
        return c.json({ ok: false, error: String(err) }, 500);
    }
});

serve({ fetch: app.fetch, port: config.port }, (info) => {
    console.log(`B2C Catalog Uploader listening on http://localhost:${info.port}`);
});
