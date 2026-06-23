import type { Config } from '@/lib/config';
import { getAccessToken } from './auth';
import { recordApiCall, redactHeaders, truncateBody } from '@/lib/api-trace';

export async function dataApi<T = unknown>(
    config: Config,
    path: string,
    init: RequestInit = {}
): Promise<{ status: number; data: T }> {
    const token = await getAccessToken(config);
    const url = `https://${config.b2cInstanceHost}/s/-/dw/data/v23_2${path}`;
    const method = init.method ?? 'GET';
    const requestHeaders = {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...((init.headers as Record<string, string> | undefined) ?? {}),
    };

    const startedAt = new Date().toISOString();
    const t0 = Date.now();
    let res: Response;
    try {
        res = await fetch(url, { ...init, headers: requestHeaders });
    } catch (err) {
        await recordApiCall({
            api: 'OCAPI Data',
            label: `${method} ${path}`,
            method,
            url,
            requestHeaders: redactHeaders(requestHeaders),
            requestBody: parseBodyForTrace(init.body),
            error: (err as Error).message,
            durationMs: Date.now() - t0,
            startedAt,
            endedAt: new Date().toISOString(),
        });
        throw err;
    }
    const text = await res.text();
    let data: T;
    try {
        data = text ? (JSON.parse(text) as T) : ({} as T);
    } catch {
        data = text as unknown as T;
    }

    await recordApiCall({
        api: 'OCAPI Data',
        label: `${method} ${path}`,
        method,
        url,
        requestHeaders: redactHeaders(requestHeaders),
        requestBody: parseBodyForTrace(init.body),
        status: res.status,
        responseHeaders: redactHeaders(res.headers),
        responseBody: truncateBody(data),
        durationMs: Date.now() - t0,
        startedAt,
        endedAt: new Date().toISOString(),
    });

    if (!res.ok) {
        throw new DataApiError(res.status, path, data, method);
    }
    return { status: res.status, data };
}

/** Best-effort: turn `init.body` (string | Buffer | stream) into something the
 *  trace UI can render. We don't attempt to read streams. */
function parseBodyForTrace(body: unknown): unknown {
    if (body == null) return undefined;
    if (typeof body === 'string') {
        try { return JSON.parse(body); } catch { return body; }
    }
    return '[non-string body]';
}

export class DataApiError extends Error {
    constructor(
        public status: number,
        public path: string,
        public body: unknown,
        public method: string = 'GET'
    ) {
        super(`Data API error ${status} on ${method} ${path}: ${summarizeOcapiBody(body)}`);
    }
}

function summarizeOcapiBody(body: unknown): string {
    if (body && typeof body === 'object') {
        const b = body as { fault?: { type?: string; message?: string }; type?: string; message?: string };
        const fault = b.fault ?? b;
        const type = fault.type;
        const message = fault.message;
        if (type || message) return [type, message].filter(Boolean).join(' — ');
        try {
            return JSON.stringify(body).slice(0, 400);
        } catch {
            return '[unserializable body]';
        }
    }
    return typeof body === 'string' ? body.slice(0, 400) : '';
}

type CatalogResource = {
    id: string;
    name?: Record<string, string>;
    description?: Record<string, string>;
};

type CategoryResource = {
    id: string;
    name?: Record<string, string>;
    parent_category_id?: string;
    online?: boolean;
    categories?: CategoryResource[];
};

/** Health check: list catalogs (returns the array) */
export async function listCatalogs(config: Config) {
    const { data } = await dataApi<{ data?: CatalogResource[] }>(config, '/catalogs?count=200');
    return data?.data ?? [];
}

type InventoryListResource = {
    id: string;
    description?: string;
    default_instock?: boolean;
};

export async function listInventoryLists(config: Config): Promise<InventoryListResource[]> {
    const { data } = await dataApi<{ data?: InventoryListResource[] }>(
        config,
        '/inventory_lists?count=200'
    );
    return data?.data ?? [];
}

/**
 * Read-only check for a catalog's existence.
 *
 * OCAPI Data v23.2 doesn't support creating catalogs via PUT (returns
 * VersionNotFoundException). New catalogs are created by the site-archive-import
 * job when it sees an unknown `catalog-id` in the uploaded XML. So this BFF only
 * needs to *report* whether the seller catalog already lives in B2C; the import
 * pipeline takes care of materializing it on first upload.
 */
export async function findCatalog(
    config: Config,
    catalogId: string
): Promise<CatalogResource | null> {
    try {
        const { data } = await dataApi<CatalogResource>(
            config,
            `/catalogs/${encodeURIComponent(catalogId)}`
        );
        return data?.id ? data : null;
    } catch (err) {
        if (err instanceof DataApiError && err.status === 404) {
            return null;
        }
        throw err;
    }
}

/** Read a category. With `levels` (1-3) you also get child categories nested. */
export async function getCategory(
    config: Config,
    catalogId: string,
    categoryId: string,
    levels = 1
): Promise<CategoryResource> {
    const { data } = await dataApi<CategoryResource>(
        config,
        `/catalogs/${encodeURIComponent(catalogId)}/categories/${encodeURIComponent(
            categoryId
        )}?levels=${levels}`
    );
    return data;
}

// ─────────────────────────────────────────────────────────────────────────────
// Live edit endpoints — used by the seller-detail product table.
//
// We intentionally use OCAPI Data v23.2 PATCH on three separate resources
// (product, price-book entry, inventory record) because that's how SFCC models
// the data. A single "save" in the UI fans out to up to 3 calls per SKU.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Markup-text fields (short/long description) are localized maps where each
 * value can be a plain string on read or a `{markup, source}` object — both on
 * read and on write. PATCH requires the object shape (a plain string returns
 * 400 TypeDecodingException); read responses can come back either way.
 */
export type LocalizedMarkup = Record<string, string | { markup: string; source?: string }>;

export type ProductResource = {
    id: string;
    name?: Record<string, string>;
    short_description?: LocalizedMarkup;
    long_description?: LocalizedMarkup;
    online?: boolean;
    /** OCAPI represents per-site online flags as a map {siteId: boolean}. */
    online_flag?: Record<string, boolean>;
    brand?: string;
    manufacturer_name?: string;
    /** Custom attribute, e.g. for marketplace/seller-of-record demos. */
    c_sellerName?: string;
};

export type PriceBookEntryResource = {
    product_id: string;
    list_price?: { value: number; currency_mnemonic?: string } | number;
    online_from?: string;
    online_to?: string;
};

export type InventoryRecordResource = {
    product_id: string;
    allocation?: number;
    ats?: number;
    perpetual?: boolean;
    stock_level?: number;
};

/**
 * Read a single product. OCAPI Data v23.2 doesn't expose a catalog-scoped
 * product listing (`/catalogs/{id}/products` returns ResourcePathNotFound),
 * so the BFF iterates seller.productIds (from the upload index) and calls
 * this endpoint per SKU. `select` filters returned fields server-side.
 */
export async function getProduct(
    config: Config,
    productId: string,
    select = '(**)'
): Promise<ProductResource | null> {
    try {
        const qs = new URLSearchParams({ select });
        const { data } = await dataApi<ProductResource>(
            config,
            `/products/${encodeURIComponent(productId)}?${qs}`
        );
        return data;
    } catch (err) {
        if (err instanceof DataApiError && err.status === 404) return null;
        throw err;
    }
}

/** Single price-book entry. 404 → null (entry hasn't been priced yet). */
export async function getPriceBookEntry(
    config: Config,
    pricebookId: string,
    productId: string
): Promise<PriceBookEntryResource | null> {
    try {
        const { data } = await dataApi<PriceBookEntryResource>(
            config,
            `/price_books/${encodeURIComponent(pricebookId)}/price_book_entries/${encodeURIComponent(
                productId
            )}`
        );
        return data;
    } catch (err) {
        if (err instanceof DataApiError && err.status === 404) return null;
        throw err;
    }
}

/** Single inventory record. 404 → null (product isn't tracked in this list yet). */
export async function getInventoryRecord(
    config: Config,
    inventoryListId: string,
    productId: string
): Promise<InventoryRecordResource | null> {
    try {
        const { data } = await dataApi<InventoryRecordResource>(
            config,
            `/inventory_lists/${encodeURIComponent(
                inventoryListId
            )}/product_inventory_records/${encodeURIComponent(productId)}`
        );
        return data;
    } catch (err) {
        if (err instanceof DataApiError && err.status === 404) return null;
        throw err;
    }
}

/**
 * PATCH a product. Pass localized fields with the locale key the storefront uses
 * (`default` for x-default, `es-ES`, etc.). Note OCAPI Data v23.2 PATCHes
 * products by id alone — there's no catalog-scoped variant; the product's
 * `owning_catalog_id` is set at creation and isn't part of the URL.
 */
export async function patchProduct(
    config: Config,
    productId: string,
    body: Partial<ProductResource>
): Promise<ProductResource> {
    const { data } = await dataApi<ProductResource>(
        config,
        `/products/${encodeURIComponent(productId)}`,
        {
            method: 'PATCH',
            body: JSON.stringify(body),
        }
    );
    return data;
}

/**
 * PUT (idempotent upsert) on a price-book entry. OCAPI Data v23.2 doesn't
 * support PATCH on this resource — PUT replaces the row, which for our
 * single-currency single-list demo is what we want.
 *
 * NOTE: this helper is currently UNREACHABLE from the live-edit route —
 * `applyOneProductPatch` short-circuits the price branch because the
 * `zzse-258` sandbox doesn't expose `/price_books/.../price_book_entries`
 * via OCAPI Data. See BLOCKERS.md for the diagnosis and the migration plan
 * (pricebook XML import). Kept here so the migration only has to swap
 * the call-site, not re-derive the wire shape.
 */
export async function upsertPriceBookEntry(
    config: Config,
    pricebookId: string,
    productId: string,
    body: { list_price: { value: number; currency_mnemonic: string } }
): Promise<PriceBookEntryResource> {
    const { data } = await dataApi<PriceBookEntryResource>(
        config,
        `/price_books/${encodeURIComponent(pricebookId)}/price_book_entries/${encodeURIComponent(
            productId
        )}`,
        {
            method: 'PUT',
            body: JSON.stringify(body),
        }
    );
    return data;
}

/**
 * PUT on an inventory record. OCAPI Data v23.2 wraps `allocation` as an object
 * (`{amount, reset_date}`) and uses `perpetual_flag` (NOT `perpetual`); a flat
 * `allocation: <int>` returns 400 TypeDecodingException, and `perpetual`
 * returns UnknownPropertyException. We accept the simpler `{ allocation, perpetual }`
 * input the route already passes and translate to the wire shape here.
 */
export async function upsertInventoryRecord(
    config: Config,
    inventoryListId: string,
    productId: string,
    body: { allocation: number; perpetual?: boolean }
): Promise<InventoryRecordResource> {
    const wireBody = {
        allocation: { amount: body.allocation },
        perpetual_flag: Boolean(body.perpetual),
    };
    const { data } = await dataApi<InventoryRecordResource>(
        config,
        `/inventory_lists/${encodeURIComponent(
            inventoryListId
        )}/product_inventory_records/${encodeURIComponent(productId)}`,
        {
            method: 'PUT',
            body: JSON.stringify(wireBody),
        }
    );
    return data;
}
