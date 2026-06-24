import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { XMLBuilder, XMLParser } from 'fast-xml-parser';
import type { Config } from '@/lib/config';
import { getCategory } from '@/b2c/data-api';
import { downloadImages } from './image-downloader';

const CATALOG_NS = 'http://www.demandware.com/xml/impex/catalog/2006-10-31';

const xmlParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    parseAttributeValue: false,
    allowBooleanAttributes: true,
    preserveOrder: true,
    trimValues: false,
});
const xmlBuilder = new XMLBuilder({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    preserveOrder: true,
    suppressEmptyNode: false,
    format: true,
});

export type TransformResult = {
    /** Where the (possibly id-rewritten) master catalog.xml lives now. */
    masterCatalogXmlPath: string;
    /** Generated storefront delta — null if no new categories AND no products to publish. */
    storefrontDeltaXmlPath: string | null;
    targetCatalogId: string;
    /** Categories that already existed in storefront and that we'll just add assignments to. */
    reusedCategoryIds: string[];
    /** Categories defined by the upload that don't exist in storefront — we materialize them. */
    newCategoryIds: string[];
    /** Number of <category-assignment> entries we're publishing to the storefront. */
    assignmentsPublished: number;
    /** All product-ids declared by the master catalog (used to seed inventory). */
    productIds: string[];
};

/**
 * Transform stage:
 *   1. Rewrite the master catalog.xml's catalog-id to `targetCatalogId`.
 *   2. Read top-level categories of the storefront catalog and figure out which
 *      uploaded categories are new vs reusable.
 *   3. Emit a *delta* storefront catalog.xml that contains only what we need to
 *      add: new categories + product-category assignments. Existing categories
 *      are NOT touched — site-archive-import in MERGE mode means "add new +
 *      update changed", so omitting an existing category preserves it intact.
 *
 * Brand and manufacturer values from the source XML are respected — nothing is
 * forced or rewritten on products.
 */
export async function transformCatalogUpload(args: {
    config: Config;
    extractedRoot: string;
    catalogXmlRelativePath: string;
    targetCatalogId: string;
    /** Storefront catalog the delta is published to (the form-level override). */
    storefrontCatalogId: string;
    transformedRoot: string;
}): Promise<TransformResult> {
    const {
        config,
        extractedRoot,
        catalogXmlRelativePath,
        targetCatalogId,
        storefrontCatalogId,
        transformedRoot,
    } = args;

    // 1) Read + parse the source catalog
    const sourcePath = join(extractedRoot, catalogXmlRelativePath);
    const sourceXml = await readFile(sourcePath, 'utf8');
    const tree = xmlParser.parse(sourceXml) as PreservedNode[];

    const catalogNode = findNamed(tree, 'catalog');
    if (!catalogNode) {
        throw new Error('catalog.xml has no <catalog> root.');
    }

    // 1a) Rewrite catalog-id
    const catalogAttrs = (catalogNode[':@'] ??= {});
    catalogAttrs['@_catalog-id'] = targetCatalogId;
    catalogAttrs['@_xmlns'] = CATALOG_NS;

    // 1b) Scan categories + products + category-assignments declared in the source xml.
    const declaredCategoryIds = new Set<string>();
    const productIds = new Set<string>();
    const assignmentsByCategoryId = new Map<string, string[]>();
    for (const child of catalogNode.catalog as PreservedNode[]) {
        const name = nodeName(child);
        if (name === 'category') {
            const id = attrOf(child, '@_category-id');
            if (id) declaredCategoryIds.add(id);
        } else if (name === 'product') {
            const pid = attrOf(child, '@_product-id');
            if (pid) productIds.add(pid);
        } else if (name === 'category-assignment') {
            const catId = attrOf(child, '@_category-id');
            const productId = attrOf(child, '@_product-id');
            if (catId && productId) {
                if (!assignmentsByCategoryId.has(catId)) {
                    assignmentsByCategoryId.set(catId, []);
                }
                assignmentsByCategoryId.get(catId)!.push(productId);
            }
        }
    }

    // 1c) Resolve any remote image URLs referenced in <image path="https://..."/>
    //     entries: download to extractedRoot/static/default/images/, rewrite the
    //     path to the local basename so the standard repackager picks them up.
    const remoteImageUrls = collectRemoteImageUrls(catalogNode.catalog as PreservedNode[]);
    if (remoteImageUrls.size > 0) {
        const imagesDir = join(extractedRoot, 'static', 'default', 'images');
        const { urlToPath } = await downloadImages(remoteImageUrls, imagesDir);
        if (urlToPath.size > 0) {
            const urlToBasename = new Map<string, string>();
            for (const [url, p] of urlToPath) urlToBasename.set(url, p.split('/').pop()!);
            rewriteImagePaths(catalogNode.catalog as PreservedNode[], urlToBasename);
        }
    }

    // 2) Discover existing storefront top-level categories (depth 2).
    // If the catalog doesn't exist yet (new import) the Data API returns 403/404 —
    // treat that as an empty tree so all categories are materialised as new.
    let storefrontRoot: { id: string; categories?: Array<{ id: string; categories?: unknown[] }> };
    try {
        storefrontRoot = await getCategory(config, storefrontCatalogId, 'root', 2);
    } catch {
        storefrontRoot = { id: 'root', categories: [] };
    }
    const existingStorefrontIds = new Set<string>();
    walkCategoryTree(storefrontRoot, (id) => existingStorefrontIds.add(id));

    const reusedCategoryIds: string[] = [];
    const newCategoryIds: string[] = [];
    for (const id of declaredCategoryIds) {
        if (existingStorefrontIds.has(id)) reusedCategoryIds.push(id);
        else newCategoryIds.push(id);
    }

    // 3) Persist transformed master catalog.xml
    await mkdir(join(transformedRoot, 'catalogs', targetCatalogId), { recursive: true });
    const masterCatalogXmlPath = join(transformedRoot, 'catalogs', targetCatalogId, 'catalog.xml');
    await writeFile(masterCatalogXmlPath, withDeclaration(xmlBuilder.build(tree)), 'utf8');

    // 4) Build storefront delta (or enrich master in-place when catalogs are the same).
    let assignmentsPublished = 0;
    let storefrontDeltaXmlPath: string | null = null;

    for (const [, pids] of assignmentsByCategoryId) assignmentsPublished += pids.length;

    if (storefrontCatalogId === targetCatalogId) {
        // Single-catalog mode: master IS the storefront catalog. Patch showInMenu onto
        // new category nodes in the already-parsed tree and re-write the master.
        // Do NOT write a separate delta — that would overwrite the products in the master.
        // The master already carries <category>, <product>, and <category-assignment> elements.
        if (newCategoryIds.length > 0) {
            const sourceCatNodes = collectCategoryNodes(catalogNode.catalog as PreservedNode[]);
            for (const id of newCategoryIds) {
                const catNode = sourceCatNodes.get(id);
                if (!catNode) continue;
                const inner = (catNode.category as PreservedNode[]) ?? [];
                ensureParentRoot(inner);
                ensureShowInMenu(inner);
                catNode.category = inner;
            }
            await writeFile(masterCatalogXmlPath, withDeclaration(xmlBuilder.build(tree)), 'utf8');
        }
        storefrontDeltaXmlPath = null;
    } else if (newCategoryIds.length > 0 || assignmentsByCategoryId.size > 0) {
        const deltaTree = buildStorefrontDelta({
            storefrontCatalogId,
            newCategoryIds,
            sourceCategoryNodes: collectCategoryNodes(catalogNode.catalog as PreservedNode[]),
            assignmentsByCategoryId,
        });
        await mkdir(join(transformedRoot, 'catalogs', storefrontCatalogId), {
            recursive: true,
        });
        storefrontDeltaXmlPath = join(
            transformedRoot,
            'catalogs',
            storefrontCatalogId,
            'catalog.xml'
        );
        await writeFile(storefrontDeltaXmlPath, withDeclaration(xmlBuilder.build(deltaTree)), 'utf8');
    }

    return {
        masterCatalogXmlPath,
        storefrontDeltaXmlPath,
        targetCatalogId,
        reusedCategoryIds,
        newCategoryIds,
        assignmentsPublished,
        productIds: [...productIds],
    };
}

// ─── helpers ──────────────────────────────────────────────────────────────────

type PreservedNode = Record<string, unknown> & {
    ':@'?: Record<string, string>;
};

function nodeName(node: PreservedNode): string | null {
    for (const k of Object.keys(node)) {
        if (k !== ':@') return k;
    }
    return null;
}

function attrOf(node: PreservedNode, key: string): string | undefined {
    return node[':@']?.[key];
}

function findNamed(tree: PreservedNode[], name: string): PreservedNode | null {
    for (const node of tree) {
        if (nodeName(node) === name) return node;
    }
    return null;
}

function walkCategoryTree(
    cat: { id: string; categories?: Array<{ id: string; categories?: unknown[] }> },
    onId: (id: string) => void
): void {
    onId(cat.id);
    for (const child of cat.categories ?? []) {
        walkCategoryTree(child as Parameters<typeof walkCategoryTree>[0], onId);
    }
}

function collectCategoryNodes(children: PreservedNode[]): Map<string, PreservedNode> {
    const out = new Map<string, PreservedNode>();
    for (const child of children) {
        if (nodeName(child) === 'category') {
            const id = attrOf(child, '@_category-id');
            if (id) out.set(id, child);
        }
    }
    return out;
}

/**
 * Build a fresh preserve-order tree representing the storefront delta:
 *
 *   <catalog xmlns="…" catalog-id="<storefront>">
 *     <category category-id="<new-cat>">…copied from source…</category>
 *     <category-assignment category-id="<cat>" product-id="<sku>"/>
 *   </catalog>
 */
function buildStorefrontDelta(args: {
    storefrontCatalogId: string;
    newCategoryIds: string[];
    sourceCategoryNodes: Map<string, PreservedNode>;
    assignmentsByCategoryId: Map<string, string[]>;
}): PreservedNode[] {
    const {
        storefrontCatalogId,
        newCategoryIds,
        sourceCategoryNodes,
        assignmentsByCategoryId,
    } = args;

    const children: PreservedNode[] = [];

    // Materialize new categories: clone the source definition when present, else
    // emit a placeholder under root so MERGE creates them.
    for (const id of newCategoryIds) {
        const original = sourceCategoryNodes.get(id);
        if (!original) {
            children.push(buildPlaceholderCategoryNode(id));
            continue;
        }
        const cloned = clonePreservedNode(original);
        const innerChildren = (cloned.category as PreservedNode[]) ?? [];
        ensureParentRoot(innerChildren);
        ensureShowInMenu(innerChildren);
        cloned.category = innerChildren;
        children.push(cloned);
    }

    // Add assignments
    for (const [categoryId, pids] of assignmentsByCategoryId) {
        for (const productId of pids) {
            children.push({
                'category-assignment': [],
                ':@': {
                    '@_category-id': categoryId,
                    '@_product-id': productId,
                },
            } as unknown as PreservedNode);
        }
    }

    return [
        {
            '?xml': [{ '#text': '' }],
            ':@': { '@_version': '1.0', '@_encoding': 'UTF-8' },
        } as unknown as PreservedNode,
        {
            catalog: children,
            ':@': {
                '@_xmlns': CATALOG_NS,
                '@_catalog-id': storefrontCatalogId,
            },
        } as PreservedNode,
    ];
}

function clonePreservedNode(node: PreservedNode): PreservedNode {
    return JSON.parse(JSON.stringify(node)) as PreservedNode;
}

function buildPlaceholderCategoryNode(id: string): PreservedNode {
    const children: PreservedNode[] = [
        { 'display-name': [{ '#text': id }], ':@': { '@_xml:lang': 'x-default' } } as unknown as PreservedNode,
        { 'online-flag': [{ '#text': 'true' }] } as unknown as PreservedNode,
        { parent: [{ '#text': 'root' }] } as unknown as PreservedNode,
        buildShowInMenuNode(),
    ];
    return {
        category: children,
        ':@': { '@_category-id': id },
    } as PreservedNode;
}

function ensureParentRoot(innerChildren: PreservedNode[]): void {
    const hasParent = innerChildren.some((c) => nodeName(c) === 'parent');
    if (!hasParent) {
        innerChildren.push({ parent: [{ '#text': 'root' }] } as unknown as PreservedNode);
    }
}

/**
 * Categories on the storefront catalog must carry `showInMenu=true` for the
 * storefront navigation to surface them. We merge into an existing
 * <custom-attributes> block if present (XSD requires it at the end of the
 * category sequence), otherwise we append a fresh one.
 */
function ensureShowInMenu(innerChildren: PreservedNode[]): void {
    const customAttrsNode = innerChildren.find((c) => nodeName(c) === 'custom-attributes');
    if (!customAttrsNode) {
        innerChildren.push(buildShowInMenuNode());
        return;
    }
    const list = (customAttrsNode['custom-attributes'] as PreservedNode[]) ?? [];
    const existing = list.find(
        (n) => nodeName(n) === 'custom-attribute' && attrOf(n, '@_attribute-id') === 'showInMenu'
    );
    if (existing) {
        existing['custom-attribute'] = [{ '#text': 'true' } as unknown as PreservedNode];
    } else {
        list.push({
            'custom-attribute': [{ '#text': 'true' } as unknown as PreservedNode],
            ':@': { '@_attribute-id': 'showInMenu' },
        } as PreservedNode);
    }
    customAttrsNode['custom-attributes'] = list;
}

function buildShowInMenuNode(): PreservedNode {
    return {
        'custom-attributes': [
            {
                'custom-attribute': [{ '#text': 'true' } as unknown as PreservedNode],
                ':@': { '@_attribute-id': 'showInMenu' },
            } as PreservedNode,
        ],
    } as PreservedNode;
}

/**
 * Walk the catalog tree, finding every <image path="…"/> whose path is an
 * http(s) URL. Returns the unique set of URLs.
 */
function collectRemoteImageUrls(catalogChildren: PreservedNode[]): Set<string> {
    const urls = new Set<string>();
    visitImages(catalogChildren, (path) => {
        if (typeof path === 'string' && /^https?:\/\//i.test(path)) urls.add(path);
    });
    return urls;
}

/**
 * In-place rewrite: every <image path="<url>"/> whose URL is in `urlToBasename`
 * gets its path replaced by the local basename.
 */
function rewriteImagePaths(
    catalogChildren: PreservedNode[],
    urlToBasename: Map<string, string>
): void {
    visitImages(catalogChildren, (path, setter) => {
        if (typeof path !== 'string') return;
        const replacement = urlToBasename.get(path);
        if (replacement) setter(replacement);
    });
}

/**
 * Recursive walker that visits every `<image path="…"/>` node anywhere under
 * the catalog tree (handles plain <image> as well as <images><image-group><image>).
 *
 * The visitor receives the current path and a setter to mutate it.
 */
function visitImages(
    nodes: PreservedNode[] | undefined,
    visit: (path: string | undefined, setter: (next: string) => void) => void
): void {
    if (!nodes) return;
    for (const node of nodes) {
        const name = nodeName(node);
        if (name === 'image') {
            const attrs = (node[':@'] ??= {});
            const current = attrs['@_path'];
            visit(current, (next) => {
                attrs['@_path'] = next;
            });
        }
        // Recurse into containers that may carry nested <image> entries.
        for (const k of Object.keys(node)) {
            if (k === ':@') continue;
            const child = (node as Record<string, unknown>)[k];
            if (Array.isArray(child)) visitImages(child as PreservedNode[], visit);
        }
    }
}

function withDeclaration(xml: string): string {
    if (xml.startsWith('<?xml')) return xml;
    return `<?xml version="1.0" encoding="UTF-8"?>\n${xml}`;
}
