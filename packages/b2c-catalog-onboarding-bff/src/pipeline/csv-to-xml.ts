import { mkdir, writeFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import type { CsvRow } from './csv-parser';

export type GenerateOptions = {
    /** Where to write the catalog/pricebook/inventory XMLs. */
    outDir: string;
    /** Master catalog id — used as the catalog-id of the generated catalog.xml. */
    targetCatalogId: string;
    /** Currency-aware pricebook id (target). */
    pricebookId: string;
    /** Inventory list id (target). */
    inventoryListId: string;
    /** Default stock when CSV row has no stock value. */
    defaultStock: number;
    /**
     * Optional resolver mapping image URL → local file path that has ALREADY been downloaded.
     * The resulting catalog.xml uses basenames; the caller must place those files under
     * `imagesAbsoluteDir` so the validate stage picks them up later.
     */
    imageResolver?: (url: string) => string | null;
};

export type GenerateResult = {
    catalogXmlPath: string;
    pricebookXmlPath: string;
    inventoryXmlPath: string;
    productCount: number;
    categoryCount: number;
    pricebookCurrency: string;
};

const CATALOG_NS = 'http://www.demandware.com/xml/impex/catalog/2006-10-31';
const PRICEBOOK_NS = 'http://www.demandware.com/xml/impex/pricebook/2006-10-31';
const INVENTORY_NS = 'http://www.demandware.com/xml/impex/inventory/2007-05-31';

export async function generateXmlsFromCsv(
    rows: CsvRow[],
    options: GenerateOptions
): Promise<GenerateResult> {
    if (rows.length === 0) {
        throw new Error('No rows to generate XMLs from.');
    }
    await mkdir(options.outDir, { recursive: true });

    // ── currency check (must be uniform) ──
    const currencies = new Set(rows.map((r) => r.currency));
    if (currencies.size > 1) {
        throw new Error(
            `Mixed currencies in the same upload: ${[...currencies].join(', ')}. ` +
                `Split the rows into separate uploads (one per currency).`
        );
    }
    const currency = [...currencies][0]!;

    // ── unique categories ──
    const categories = new Map<string, string | null>();
    for (const row of rows) {
        for (const cat of row.categories) {
            // Keep first non-null name we see for each id
            const existing = categories.get(cat.id);
            if (existing === undefined) categories.set(cat.id, cat.name);
            else if (!existing && cat.name) categories.set(cat.id, cat.name);
        }
    }

    // ── catalog.xml ──
    const catalogXml = buildCatalogXml({
        targetCatalogId: options.targetCatalogId,
        rows,
        categories,
        imageResolver: options.imageResolver,
    });
    const catalogXmlPath = join(options.outDir, 'catalog.xml');
    await writeFile(catalogXmlPath, catalogXml, 'utf8');

    // ── pricebook.xml ──
    const pricebookXml = buildPricebookXml(rows, options.pricebookId, currency);
    await mkdir(join(options.outDir, 'pricebooks'), { recursive: true });
    const pricebookXmlPath = join(options.outDir, 'pricebooks', `${options.pricebookId}.xml`);
    await writeFile(pricebookXmlPath, pricebookXml, 'utf8');

    // ── inventory.xml ──
    const inventoryXml = buildInventoryXml(rows, options.inventoryListId, options.defaultStock);
    await mkdir(join(options.outDir, 'inventory-lists'), { recursive: true });
    const inventoryXmlPath = join(options.outDir, 'inventory-lists', `${options.inventoryListId}.xml`);
    await writeFile(inventoryXmlPath, inventoryXml, 'utf8');

    return {
        catalogXmlPath,
        pricebookXmlPath,
        inventoryXmlPath,
        productCount: rows.length,
        categoryCount: categories.size,
        pricebookCurrency: currency,
    };
}

function buildCatalogXml(args: {
    targetCatalogId: string;
    rows: CsvRow[];
    categories: Map<string, string | null>;
    imageResolver?: (url: string) => string | null;
}): string {
    const out: string[] = [];
    out.push('<?xml version="1.0" encoding="UTF-8"?>');
    out.push(`<catalog xmlns="${CATALOG_NS}" catalog-id="${esc(args.targetCatalogId)}">`);
    out.push('    <header>');
    out.push('        <image-settings>');
    out.push('            <internal-location base-path="/images"/>');
    out.push('            <view-types>');
    out.push('                <view-type>large</view-type>');
    out.push('                <view-type>medium</view-type>');
    out.push('                <view-type>small</view-type>');
    out.push('            </view-types>');
    out.push('        </image-settings>');
    out.push('    </header>');

    // Categories first (XSD order)
    for (const [id, name] of args.categories) {
        out.push(`    <category category-id="${esc(id)}">`);
        out.push(`        <display-name xml:lang="x-default">${esc(name ?? humanize(id))}</display-name>`);
        out.push('        <online-flag>true</online-flag>');
        out.push('        <parent>root</parent>');
        out.push('        <custom-attributes>');
        out.push('            <custom-attribute attribute-id="showInMenu">true</custom-attribute>');
        out.push('        </custom-attributes>');
        out.push('    </category>');
    }

    // Products — brand/manufacturer come from the CSV; we never inject defaults.
    for (const row of args.rows) {
        const brand = row.brand?.trim() ? row.brand.trim() : null;
        const imageBasename = row.imageUrl
            ? args.imageResolver?.(row.imageUrl) ?? null
            : null;

        out.push(`    <product product-id="${esc(row.id)}">`);
        out.push('        <ean/>');
        out.push('        <upc/>');
        out.push('        <unit>each</unit>');
        out.push('        <min-order-quantity>1</min-order-quantity>');
        out.push('        <step-quantity>1</step-quantity>');
        out.push(`        <display-name xml:lang="x-default">${esc(row.name)}</display-name>`);
        if (row.shortDescription) {
            out.push(`        <short-description xml:lang="x-default">${esc(row.shortDescription)}</short-description>`);
        }
        if (row.longDescription) {
            out.push(`        <long-description xml:lang="x-default">${esc(row.longDescription)}</long-description>`);
        }
        out.push('        <online-flag>true</online-flag>');
        out.push('        <available-flag>true</available-flag>');
        out.push('        <searchable-flag>true</searchable-flag>');
        if (imageBasename) {
            out.push('        <images>');
            out.push('            <image-group view-type="large">');
            out.push(`                <image path="${esc(basename(imageBasename))}"/>`);
            out.push('            </image-group>');
            out.push('            <image-group view-type="medium">');
            out.push(`                <image path="${esc(basename(imageBasename))}"/>`);
            out.push('            </image-group>');
            out.push('            <image-group view-type="small">');
            out.push(`                <image path="${esc(basename(imageBasename))}"/>`);
            out.push('            </image-group>');
            out.push('        </images>');
        }
        out.push('        <tax-class-id>standard</tax-class-id>');
        if (brand) {
            out.push(`        <brand>${esc(brand)}</brand>`);
            out.push(`        <manufacturer-name>${esc(brand)}</manufacturer-name>`);
        }
        out.push(`        <classification-category catalog-id="${esc(args.targetCatalogId)}">${esc(row.categories[0]!.id)}</classification-category>`);
        out.push('    </product>');
    }

    // Category assignments
    for (const row of args.rows) {
        for (const cat of row.categories) {
            out.push(`    <category-assignment category-id="${esc(cat.id)}" product-id="${esc(row.id)}"/>`);
        }
    }

    out.push('</catalog>');
    return out.join('\n') + '\n';
}

function buildPricebookXml(rows: CsvRow[], pricebookId: string, currency: string): string {
    const out: string[] = [];
    out.push('<?xml version="1.0" encoding="UTF-8"?>');
    out.push(`<pricebooks xmlns="${PRICEBOOK_NS}">`);
    out.push('    <pricebook>');
    out.push('        <header pricebook-id="' + esc(pricebookId) + '">');
    out.push(`            <currency>${esc(currency)}</currency>`);
    out.push(`            <display-name xml:lang="x-default">${esc(humanize(pricebookId))}</display-name>`);
    out.push('            <online-flag>true</online-flag>');
    out.push('        </header>');
    out.push('        <price-tables>');
    for (const row of rows) {
        out.push(`            <price-table product-id="${esc(row.id)}">`);
        out.push(`                <amount quantity="1">${row.price.toFixed(2)}</amount>`);
        out.push('            </price-table>');
    }
    out.push('        </price-tables>');
    out.push('    </pricebook>');
    out.push('</pricebooks>');
    return out.join('\n') + '\n';
}

function buildInventoryXml(rows: CsvRow[], listId: string, defaultStock: number): string {
    const ts = new Date().toISOString();
    const out: string[] = [];
    out.push('<?xml version="1.0" encoding="UTF-8"?>');
    out.push(`<inventory xmlns="${INVENTORY_NS}">`);
    out.push('    <inventory-list>');
    out.push(`        <header list-id="${esc(listId)}">`);
    out.push('            <default-instock>false</default-instock>');
    out.push(`            <description>${esc(humanize(listId))}</description>`);
    out.push('            <use-bundle-inventory-only>false</use-bundle-inventory-only>');
    out.push('            <on-order>false</on-order>');
    out.push('        </header>');
    out.push('        <records>');
    for (const row of rows) {
        const stock = row.stock ?? defaultStock;
        out.push(`            <record product-id="${esc(row.id)}">`);
        out.push(`                <allocation>${stock}</allocation>`);
        out.push(`                <allocation-timestamp>${ts}</allocation-timestamp>`);
        out.push('                <perpetual>false</perpetual>');
        out.push(`                <ats>${stock}</ats>`);
        out.push('                <on-order>0</on-order>');
        out.push('                <turnover>0</turnover>');
        out.push('            </record>');
    }
    out.push('        </records>');
    out.push('    </inventory-list>');
    out.push('</inventory>');
    return out.join('\n') + '\n';
}

function esc(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function humanize(slug: string): string {
    return slug
        .split(/[-_]/)
        .filter(Boolean)
        .map((p) => p[0]!.toUpperCase() + p.slice(1))
        .join(' ');
}
