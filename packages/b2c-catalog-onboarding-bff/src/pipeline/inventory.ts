import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const INVENTORY_NS = 'http://www.demandware.com/xml/impex/inventory/2007-05-31';

/**
 * Generate a minimal inventory XML stocking each productId in the configured
 * default inventory list with `defaultUnits` units. We only emit this when the
 * source upload didn't already include an inventory file — otherwise we'd
 * stomp their stock numbers.
 *
 * Returns the path of the generated XML, or null if nothing to do.
 */
export async function generateDefaultInventoryIfMissing(args: {
    transformedRoot: string;
    inventoryListId: string;
    productIds: string[];
    defaultUnits: number;
    /** If true, skip generation (the source upload already provided inventory). */
    sourceProvidedInventory: boolean;
}): Promise<string | null> {
    const {
        transformedRoot,
        inventoryListId,
        productIds,
        defaultUnits,
        sourceProvidedInventory,
    } = args;

    if (sourceProvidedInventory || productIds.length === 0) {
        return null;
    }

    const records = productIds
        .map(
            (pid) =>
                `        <record product-id="${escapeXml(pid)}">
            <allocation>${defaultUnits}</allocation>
            <allocation-timestamp>${new Date().toISOString()}</allocation-timestamp>
            <perpetual>false</perpetual>
            <ats>${defaultUnits}</ats>
            <on-order>0</on-order>
            <turnover>0</turnover>
        </record>`
        )
        .join('\n');

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<inventory xmlns="${INVENTORY_NS}">
    <inventory-list>
        <header list-id="${escapeXml(inventoryListId)}">
            <default-instock>false</default-instock>
            <description>B2C Catalog Uploader auto-generated stock</description>
            <use-bundle-inventory-only>false</use-bundle-inventory-only>
            <on-order>false</on-order>
        </header>
        <records>
${records}
        </records>
    </inventory-list>
</inventory>
`;

    const dir = join(transformedRoot, 'inventory-lists');
    await mkdir(dir, { recursive: true });
    const path = join(dir, `${inventoryListId}.xml`);
    await writeFile(path, xml, 'utf8');
    return path;
}

function escapeXml(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}
