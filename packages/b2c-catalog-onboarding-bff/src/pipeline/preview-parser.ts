import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { XMLParser } from 'fast-xml-parser';

export type PreviewProduct = {
    id: string;
    displayName: string | null;
    /** Brand from the source XML — passed through to B2C verbatim. */
    brand: string | null;
    manufacturerName: string | null;
    shortDescription: string | null;
    /** Price found in the pricebook, if any. */
    price: number | null;
    currency: string | null;
    /** Stock found in the inventory list, if any. null = no record yet (will get default 10 from BFF). */
    stock: number | null;
    /** Category ids declared in the upload's catalog.xml. Excludes 'all'/'root' style. */
    categories: string[];
    /** First image path declared in <images>; null if none. */
    primaryImage: string | null;
    /** Quick-glance flags. */
    onlineFlag: boolean | null;
    searchableFlag: boolean | null;
    availableFlag: boolean | null;
};

export type PreviewSummary = {
    productCount: number;
    /** Categories declared in catalog.xml (not yet split into new vs reused — that happens in transform). */
    categoryIds: string[];
    pricebookId: string | null;
    pricebookCurrency: string | null;
    pricebookEntryCount: number;
    inventoryListId: string | null;
    inventoryRecordCount: number;
    productsWithoutPrice: number;
    productsWithoutStock: number;
    productsWithoutImage: number;
};

export type PreviewPayload = {
    summary: PreviewSummary;
    products: PreviewProduct[];
};

const xmlParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    parseAttributeValue: false,
    allowBooleanAttributes: true,
    trimValues: true,
});

/** Parse the extracted catalog upload into a normalized preview payload. */
export async function buildPreview(args: {
    extractedRoot: string;
    catalogXmlRelativePath: string;
    pricebookXmlRelativePaths: string[];
    inventoryXmlRelativePaths: string[];
}): Promise<PreviewPayload> {
    const catalogXml = await readFile(
        join(args.extractedRoot, args.catalogXmlRelativePath),
        'utf8'
    );
    const catalog = xmlParser.parse(catalogXml) as ParsedCatalogRoot;

    const products: PreviewProduct[] = [];
    const productById = new Map<string, PreviewProduct>();

    const declaredCategoryIds = new Set<string>();
    const productEntries = arrayify(catalog.catalog?.product);
    for (const p of productEntries) {
        const id = p['@_product-id'];
        if (!id) continue;
        const product: PreviewProduct = {
            id,
            displayName: pickLocalized(p['display-name']),
            brand: textOf(p.brand),
            manufacturerName: textOf(p['manufacturer-name']),
            shortDescription: pickLocalized(p['short-description']),
            price: null,
            currency: null,
            stock: null,
            categories: [],
            primaryImage: extractFirstImage(p.images),
            onlineFlag: parseBool(textOf(p['online-flag'])),
            searchableFlag: parseBool(textOf(p['searchable-flag'])),
            availableFlag: parseBool(textOf(p['available-flag'])),
        };
        products.push(product);
        productById.set(id, product);
    }

    for (const c of arrayify(catalog.catalog?.category)) {
        const cid = c['@_category-id'];
        if (cid && cid !== 'root' && cid !== 'all') declaredCategoryIds.add(cid);
    }

    for (const a of arrayify(catalog.catalog?.['category-assignment'])) {
        const cid = a['@_category-id'];
        const pid = a['@_product-id'];
        if (!cid || !pid) continue;
        if (cid === 'root' || cid === 'all') continue;
        const prod = productById.get(pid);
        if (prod && !prod.categories.includes(cid)) {
            prod.categories.push(cid);
        }
        declaredCategoryIds.add(cid);
    }

    // ── Pricebook(s) ──
    let pricebookId: string | null = null;
    let pricebookCurrency: string | null = null;
    let pricebookEntryCount = 0;

    for (const rel of args.pricebookXmlRelativePaths) {
        const xml = await readFile(join(args.extractedRoot, rel), 'utf8');
        const parsed = xmlParser.parse(xml) as ParsedPricebookRoot;
        const books = arrayify(parsed.pricebooks?.pricebook);
        for (const book of books) {
            const header = book.header;
            if (!pricebookId && header?.['@_pricebook-id']) {
                pricebookId = header['@_pricebook-id'];
                pricebookCurrency = textOf(header.currency);
            }
            const tables = arrayify(book['price-tables']?.['price-table']);
            for (const t of tables) {
                pricebookEntryCount += 1;
                const pid = t['@_product-id'];
                if (!pid) continue;
                const prod = productById.get(pid);
                if (!prod) continue;
                const amount = arrayify(t.amount)[0];
                if (amount && prod.price === null) {
                    const value = typeof amount === 'object' ? Number(amount['#text']) : Number(amount);
                    if (Number.isFinite(value)) {
                        prod.price = value;
                        prod.currency = pricebookCurrency;
                    }
                }
            }
        }
    }

    // ── Inventory list(s) ──
    let inventoryListId: string | null = null;
    let inventoryRecordCount = 0;

    for (const rel of args.inventoryXmlRelativePaths) {
        const xml = await readFile(join(args.extractedRoot, rel), 'utf8');
        const parsed = xmlParser.parse(xml) as ParsedInventoryRoot;
        const lists = arrayify(parsed.inventory?.['inventory-list']);
        for (const list of lists) {
            if (!inventoryListId && list.header?.['@_list-id']) {
                inventoryListId = list.header['@_list-id'];
            }
            const records = arrayify(list.records?.record);
            for (const rec of records) {
                inventoryRecordCount += 1;
                const pid = rec['@_product-id'];
                if (!pid) continue;
                const prod = productById.get(pid);
                if (!prod) continue;
                const allocation = textOf(rec.allocation);
                const ats = textOf(rec.ats);
                const value = ats ?? allocation;
                if (value !== null) {
                    const n = Number(value);
                    if (Number.isFinite(n)) prod.stock = n;
                }
            }
        }
    }

    const summary: PreviewSummary = {
        productCount: products.length,
        categoryIds: [...declaredCategoryIds].sort(),
        pricebookId,
        pricebookCurrency,
        pricebookEntryCount,
        inventoryListId,
        inventoryRecordCount,
        productsWithoutPrice: products.filter((p) => p.price === null).length,
        productsWithoutStock: products.filter((p) => p.stock === null).length,
        productsWithoutImage: products.filter((p) => !p.primaryImage).length,
    };

    return { summary, products };
}

// ─── helpers ─────────────────────────────────────────────────────────────────

type ParsedCatalogRoot = { catalog?: ParsedCatalog };
type ParsedCatalog = {
    product?: ParsedProduct | ParsedProduct[];
    category?: ParsedCategory | ParsedCategory[];
    'category-assignment'?: ParsedAssignment | ParsedAssignment[];
};
type ParsedProduct = {
    '@_product-id'?: string;
    'display-name'?: ParsedLocalized | ParsedLocalized[];
    'short-description'?: ParsedLocalized | ParsedLocalized[];
    brand?: ParsedText;
    'manufacturer-name'?: ParsedText;
    'online-flag'?: ParsedText;
    'searchable-flag'?: ParsedText;
    'available-flag'?: ParsedText;
    images?: ParsedImages;
};
type ParsedCategory = { '@_category-id'?: string };
type ParsedAssignment = { '@_category-id'?: string; '@_product-id'?: string };
type ParsedLocalized = { '#text'?: string; '@_xml:lang'?: string };
type ParsedText = string | number | boolean | { '#text'?: string | number | boolean };
type ParsedImages = { 'image-group'?: ParsedImageGroup | ParsedImageGroup[]; image?: ParsedImage | ParsedImage[] };
type ParsedImageGroup = { image?: ParsedImage | ParsedImage[] };
type ParsedImage = { '@_path'?: string };

type ParsedPricebookRoot = { pricebooks?: { pricebook?: ParsedPricebook | ParsedPricebook[] } };
type ParsedPricebook = {
    header?: { '@_pricebook-id'?: string; currency?: ParsedText };
    'price-tables'?: { 'price-table'?: ParsedPriceTable | ParsedPriceTable[] };
};
type ParsedPriceTable = {
    '@_product-id'?: string;
    amount?: (string | { '#text'?: string }) | (string | { '#text'?: string })[];
};

type ParsedInventoryRoot = { inventory?: { 'inventory-list'?: ParsedInventoryList | ParsedInventoryList[] } };
type ParsedInventoryList = {
    header?: { '@_list-id'?: string };
    records?: { record?: ParsedInventoryRecord | ParsedInventoryRecord[] };
};
type ParsedInventoryRecord = {
    '@_product-id'?: string;
    allocation?: ParsedText;
    ats?: ParsedText;
};

function arrayify<T>(value: T | T[] | undefined | null): T[] {
    if (value === undefined || value === null) return [];
    return Array.isArray(value) ? value : [value];
}

function textOf(value: ParsedText | undefined): string | null {
    if (value === undefined || value === null) return null;
    if (typeof value === 'string') return value || null;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    const t = (value as { '#text'?: unknown })['#text'];
    if (typeof t === 'string') return t.length > 0 ? t : null;
    if (typeof t === 'number' || typeof t === 'boolean') return String(t);
    return null;
}

function pickLocalized(value: ParsedLocalized | ParsedLocalized[] | undefined): string | null {
    if (value === undefined || value === null) return null;
    const arr = Array.isArray(value) ? value : [value];
    // Prefer x-default, then es-ES, then anything with #text
    const xDef = arr.find((v) => v['@_xml:lang'] === 'x-default' && v['#text']);
    if (xDef?.['#text']) return xDef['#text'];
    const es = arr.find((v) => v['@_xml:lang']?.startsWith('es') && v['#text']);
    if (es?.['#text']) return es['#text'];
    const any = arr.find((v) => v['#text']);
    return any?.['#text'] ?? null;
}

function parseBool(value: string | null): boolean | null {
    if (value === null) return null;
    if (value === 'true') return true;
    if (value === 'false') return false;
    return null;
}

function extractFirstImage(images: ParsedImages | undefined): string | null {
    if (!images) return null;
    const groups = arrayify(images['image-group']);
    for (const g of groups) {
        const imgs = arrayify(g.image);
        const first = imgs[0]?.['@_path'];
        if (first) return first;
    }
    const direct = arrayify(images.image);
    return direct[0]?.['@_path'] ?? null;
}
