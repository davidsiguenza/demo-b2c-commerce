import { readFile } from 'node:fs/promises';
import { XMLParser } from 'fast-xml-parser';
import type { ExtractedFile } from './extract';

export type ValidationResult = {
    ok: boolean;
    errors: string[];
    targetCatalogId?: string;
    productCount?: number;
    categoryIds?: string[];
    /** Files we recognized; not necessarily everything in the zip. */
    recognized: {
        catalogXml?: string;
        pricebookXmls: string[];
        inventoryXmls: string[];
        /** Image asset relative paths inside the upload (any file under a `static/...images/`-style dir). */
        imagePaths: Array<{ relativePath: string; basename: string }>;
    };
};

const REQUIRED_CATALOG_NS = 'http://www.demandware.com/xml/impex/catalog/2006-10-31';

const xmlParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    parseAttributeValue: false,
    allowBooleanAttributes: true,
    trimValues: true,
});

/**
 * Validate the extracted catalog upload.
 *
 * Lightweight: we don't run XSD validation (would require external schemas + a
 * libxml binding). Instead we check structural invariants that B2C cares about:
 *   1. exactly one catalog.xml in the upload
 *   2. catalog.xml uses the impex/catalog namespace
 *   3. it contains a <catalog catalog-id="…"> root
 *   4. at least one <product>
 *   5. inventory + pricebook xmls (if present) use their respective namespaces
 *
 * The site-archive-import job in B2C does its own strict XSD validation, so the
 * BFF stays pragmatic here and surfaces clearer errors before the upload leaves.
 */
export async function validateUpload(files: ExtractedFile[]): Promise<ValidationResult> {
    const errors: string[] = [];
    const recognized: ValidationResult['recognized'] = {
        pricebookXmls: [],
        inventoryXmls: [],
        imagePaths: [],
    };

    const catalogCandidates = files.filter((f) => /(^|\/)catalog\.xml$/i.test(f.relativePath));
    const pricebookCandidates = files.filter((f) =>
        /(^|\/)pricebooks?\//i.test(f.relativePath) && f.relativePath.endsWith('.xml')
    );
    const inventoryCandidates = files.filter((f) =>
        /(^|\/)(inventory|inventory-lists?)\//i.test(f.relativePath) && f.relativePath.endsWith('.xml')
    );
    // Images: anything that lives inside a `static/.../images/` path with an image extension,
    // or a top-level `images/` folder. Keeps the basename for catalog.xml <image path="…"/> resolution.
    const IMAGE_EXT = /\.(jpe?g|png|gif|webp|svg|avif)$/i;
    const imageCandidates = files.filter(
        (f) =>
            IMAGE_EXT.test(f.relativePath) &&
            (/(^|\/)static\//i.test(f.relativePath) || /(^|\/)images?\//i.test(f.relativePath))
    );
    for (const img of imageCandidates) {
        const parts = img.relativePath.split('/');
        recognized.imagePaths.push({
            relativePath: img.relativePath,
            basename: parts[parts.length - 1] ?? img.relativePath,
        });
    }

    if (catalogCandidates.length === 0) {
        errors.push('No catalog.xml found in the upload.');
        return { ok: false, errors, recognized };
    }
    if (catalogCandidates.length > 1) {
        errors.push(
            `Expected exactly one catalog.xml, found ${catalogCandidates.length}: ${catalogCandidates
                .map((f) => f.relativePath)
                .join(', ')}`
        );
    }

    const catalogFile = catalogCandidates[0];
    if (!catalogFile) {
        return { ok: false, errors, recognized };
    }
    recognized.catalogXml = catalogFile.relativePath;

    let targetCatalogId: string | undefined;
    let productCount = 0;
    const categoryIds: string[] = [];

    try {
        const xml = await readFile(catalogFile.absolutePath, 'utf8');
        if (!xml.includes(REQUIRED_CATALOG_NS)) {
            errors.push(`catalog.xml missing required namespace ${REQUIRED_CATALOG_NS}`);
        }
        const parsed = xmlParser.parse(xml) as ParsedCatalog;
        const root = parsed.catalog;
        if (!root) {
            errors.push('catalog.xml has no <catalog> root element.');
        } else {
            targetCatalogId = root['@_catalog-id'];
            if (!targetCatalogId) {
                errors.push('<catalog> is missing required attribute catalog-id.');
            }
            const products = arrayify(root.product);
            productCount = products.length;
            if (productCount === 0) {
                errors.push('catalog.xml contains no <product> entries.');
            }
            const cats = arrayify(root.category);
            for (const cat of cats) {
                const id = cat['@_category-id'];
                if (id) categoryIds.push(id);
            }
        }
    } catch (err) {
        errors.push(`Failed to parse catalog.xml: ${(err as Error).message}`);
    }

    for (const f of pricebookCandidates) {
        const xml = await readFile(f.absolutePath, 'utf8');
        if (!xml.includes('http://www.demandware.com/xml/impex/pricebook/')) {
            errors.push(`${f.relativePath}: missing pricebook namespace.`);
        } else {
            recognized.pricebookXmls.push(f.relativePath);
        }
    }
    for (const f of inventoryCandidates) {
        const xml = await readFile(f.absolutePath, 'utf8');
        if (!xml.includes('http://www.demandware.com/xml/impex/inventory/')) {
            errors.push(`${f.relativePath}: missing inventory namespace.`);
        } else {
            recognized.inventoryXmls.push(f.relativePath);
        }
    }

    const ok = errors.length === 0;
    return {
        ok,
        errors,
        targetCatalogId,
        productCount,
        categoryIds: categoryIds.length ? categoryIds : undefined,
        recognized,
    };
}

type ParsedCatalog = {
    catalog?: {
        '@_catalog-id'?: string;
        product?: ParsedNode | ParsedNode[];
        category?: ParsedCategory | ParsedCategory[];
    };
};

type ParsedNode = Record<string, unknown>;
type ParsedCategory = ParsedNode & { '@_category-id'?: string };

function arrayify<T>(value: T | T[] | undefined): T[] {
    if (value === undefined || value === null) return [];
    return Array.isArray(value) ? value : [value];
}
