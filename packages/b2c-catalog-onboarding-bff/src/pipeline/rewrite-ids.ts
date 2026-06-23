import { readFile, writeFile } from 'node:fs/promises';

/**
 * Rewrite the pricebook-id inside a pricebook XML to the target id, in-place.
 * Idempotent: if it already matches, no-op.
 */
export async function rewritePricebookId(absolutePath: string, targetId: string): Promise<void> {
    const xml = await readFile(absolutePath, 'utf8');
    const next = xml.replace(/(<header[^>]*?\bpricebook-id=)"[^"]*"/g, `$1"${targetId}"`);
    if (next !== xml) {
        await writeFile(absolutePath, next, 'utf8');
    }
}

/**
 * Rewrite the list-id inside an inventory XML to the target id, in-place.
 */
export async function rewriteInventoryListId(absolutePath: string, targetId: string): Promise<void> {
    const xml = await readFile(absolutePath, 'utf8');
    const next = xml.replace(/(<header[^>]*?\blist-id=)"[^"]*"/g, `$1"${targetId}"`);
    if (next !== xml) {
        await writeFile(absolutePath, next, 'utf8');
    }
}
