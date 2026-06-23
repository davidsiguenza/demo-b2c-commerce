import { parse as parseCsv } from 'csv-parse/sync';

export type CsvRow = {
    id: string;
    name: string;
    price: number;
    currency: string;
    stock: number | null;
    brand: string | null;
    shortDescription: string | null;
    longDescription: string | null;
    imageUrl: string | null;
    categories: Array<{ id: string; name: string | null }>;
};

export type CsvParseResult =
    | { ok: true; rows: CsvRow[] }
    | { ok: false; errors: Array<{ row: number; column?: string; message: string }> };

const REQUIRED_COLUMNS = ['id', 'name', 'price', 'category'] as const;
const KNOWN_COLUMNS = [
    'id',
    'name',
    'price',
    'currency',
    'stock',
    'brand',
    'short_description',
    'long_description',
    'image_url',
    'category',
    'category_name',
] as const;

const ID_RE = /^[a-z0-9][a-z0-9_-]*$/i;

/**
 * Strict CSV parser. Rejects the whole upload if any row is invalid.
 *
 * Expected columns (header row required):
 *   id, name, price, category                            (required)
 *   currency, stock, brand, short_description,
 *   long_description, image_url, category_name           (optional)
 *
 * Multiple categories per product: pipe-separated (`a|b|c`).
 * If category_name is provided it labels every category-id in this row;
 * a future row that uses the same id but with a different category_name
 * keeps the FIRST seen label.
 */
export function parseSellerCsv(csvText: string): CsvParseResult {
    const errors: Array<{ row: number; column?: string; message: string }> = [];
    let rawRows: Record<string, string>[];
    try {
        rawRows = parseCsv(csvText, {
            columns: (header: string[]) => header.map((h) => h.trim().toLowerCase()),
            skip_empty_lines: true,
            trim: true,
            relax_column_count: false,
        }) as Record<string, string>[];
    } catch (err) {
        return {
            ok: false,
            errors: [{ row: 0, message: `CSV parse error: ${(err as Error).message}` }],
        };
    }

    if (rawRows.length === 0) {
        return { ok: false, errors: [{ row: 0, message: 'CSV is empty.' }] };
    }

    // Header validation
    const header = Object.keys(rawRows[0]!);
    for (const col of REQUIRED_COLUMNS) {
        if (!header.includes(col)) {
            errors.push({ row: 1, column: col, message: `Missing required column "${col}"` });
        }
    }
    for (const col of header) {
        if (!KNOWN_COLUMNS.includes(col as (typeof KNOWN_COLUMNS)[number])) {
            errors.push({ row: 1, column: col, message: `Unknown column "${col}" (will be ignored)` });
        }
    }
    // Block on missing required columns; ignore unknown ones (warning-only)
    if (errors.some((e) => e.message.startsWith('Missing'))) {
        return { ok: false, errors: errors.filter((e) => e.message.startsWith('Missing')) };
    }

    const rows: CsvRow[] = [];
    const seenIds = new Set<string>();

    rawRows.forEach((raw, i) => {
        const rowNum = i + 2; // +1 header, +1 1-indexed
        const id = raw.id?.trim();
        const name = raw.name?.trim();
        const priceRaw = raw.price?.trim();
        const categoryRaw = raw.category?.trim();

        if (!id) errors.push({ row: rowNum, column: 'id', message: 'Empty id' });
        else if (!ID_RE.test(id)) errors.push({ row: rowNum, column: 'id', message: `Invalid id "${id}" (only [a-z0-9_-])` });
        else if (seenIds.has(id)) errors.push({ row: rowNum, column: 'id', message: `Duplicate id "${id}"` });

        if (!name) errors.push({ row: rowNum, column: 'name', message: 'Empty name' });

        const price = priceRaw ? Number(priceRaw.replace(',', '.')) : NaN;
        if (!priceRaw) errors.push({ row: rowNum, column: 'price', message: 'Empty price' });
        else if (!Number.isFinite(price) || price < 0)
            errors.push({ row: rowNum, column: 'price', message: `Invalid price "${priceRaw}"` });

        const stockRaw = raw.stock?.trim();
        let stock: number | null = null;
        if (stockRaw) {
            const n = Number(stockRaw);
            if (!Number.isInteger(n) || n < 0)
                errors.push({ row: rowNum, column: 'stock', message: `Invalid stock "${stockRaw}" (must be a non-negative integer)` });
            else stock = n;
        }

        if (!categoryRaw) errors.push({ row: rowNum, column: 'category', message: 'Empty category' });

        const categoryIds = (categoryRaw ?? '')
            .split('|')
            .map((s) => s.trim())
            .filter(Boolean);
        for (const cid of categoryIds) {
            if (!ID_RE.test(cid))
                errors.push({ row: rowNum, column: 'category', message: `Invalid category id "${cid}"` });
        }

        const categoryName = raw.category_name?.trim() || null;
        const imageUrl = raw.image_url?.trim() || null;
        if (imageUrl && !/^https?:\/\//i.test(imageUrl)) {
            errors.push({ row: rowNum, column: 'image_url', message: `Invalid image_url "${imageUrl}" (must start with http:// or https://)` });
        }

        if (id) seenIds.add(id);

        // Even if there are errors for this row, keep building the model so the
        // validation doesn't throw — we just won't return rows when errors exist.
        if (id && name && Number.isFinite(price) && categoryIds.length > 0) {
            rows.push({
                id,
                name,
                price,
                currency: (raw.currency?.trim() || 'USD').toUpperCase(),
                stock,
                brand: raw.brand?.trim() || null,
                shortDescription: raw.short_description?.trim() || null,
                longDescription: raw.long_description?.trim() || null,
                imageUrl,
                categories: categoryIds.map((cid) => ({ id: cid, name: categoryName })),
            });
        }
    });

    if (errors.length) {
        return { ok: false, errors };
    }

    return { ok: true, rows };
}
