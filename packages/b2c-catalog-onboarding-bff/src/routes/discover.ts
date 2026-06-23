import { Hono } from 'hono';
import { listCatalogs, listInventoryLists } from '@/b2c/data-api';
import { listAllUploads } from '@/lib/upload-index';
import { loadConfig } from '@/lib/config';

const config = loadConfig();

export const discoverRouter = new Hono();

/**
 * Surfaces the dropdown options for the upload form:
 *  - master catalogs (every non-storefront catalog the user can upload to)
 *  - storefront catalogs (the cross-publish target)
 *  - inventory lists (from B2C Data API)
 *  - pricebooks: Data API v23.2 doesn't expose listing — we return the
 *    project-known defaults plus any seen in previous uploads.
 *  - master catalogs known to the BFF (from past uploads): handy for "pick
 *    existing" mode in the form.
 */
discoverRouter.get('/discover', async (c) => {
    try {
        const [allCatalogs, inventoryLists, allUploads] = await Promise.all([
            listCatalogs(config),
            listInventoryLists(config),
            listAllUploads(),
        ]);

        const allCatalogOptions = allCatalogs.map((cat) => ({
            id: cat.id,
            name: cat.name?.default ?? cat.name?.['x-default'] ?? cat.id,
        }));

        const inventory = inventoryLists.map((l) => ({
            id: l.id,
            description: l.description ?? null,
        }));

        // Pricebooks we've seen across uploads (best guess) + project defaults.
        const seen = new Set<string>([config.defaultPricebookId]);
        for (const u of allUploads) {
            if (u.pricebookId) seen.add(u.pricebookId);
        }
        const pricebooks = [...seen].map((id) => ({ id }));

        // Master catalogs the BFF has seen (uploads + B2C catalogs that aren't the storefront).
        const knownById = new Map<string, { id: string; displayName: string | null; productCount: number }>();
        for (const cat of allCatalogs) {
            if (cat.id === config.storefrontCatalogId) continue;
            knownById.set(cat.id, {
                id: cat.id,
                displayName: cat.name?.default ?? cat.name?.['x-default'] ?? null,
                productCount: 0,
            });
        }
        for (const u of allUploads) {
            const ent = knownById.get(u.masterCatalogId) ?? {
                id: u.masterCatalogId,
                displayName: null,
                productCount: 0,
            };
            ent.productCount = Math.max(ent.productCount, u.transform?.productIds?.length ?? 0);
            knownById.set(u.masterCatalogId, ent);
        }
        const masterCatalogs = [...knownById.values()].sort((a, b) => a.id.localeCompare(b.id));

        return c.json({
            ok: true,
            defaults: {
                storefrontCatalogId: config.storefrontCatalogId,
                pricebookId: config.defaultPricebookId,
                inventoryListId: config.defaultInventoryListId,
            },
            options: {
                catalogs: allCatalogOptions,
                pricebooks,
                inventoryLists: inventory,
                masterCatalogs,
            },
        });
    } catch (err) {
        return c.json({ ok: false, error: String(err) }, 500);
    }
});
