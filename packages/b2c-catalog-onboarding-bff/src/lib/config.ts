import { z } from 'zod';

const ConfigSchema = z.object({
    b2cInstanceHost: z.string(),
    b2cTenant: z.string(),
    b2cOrgId: z.string(),
    b2cShortCode: z.string(),

    storefrontCatalogId: z.string(),
    defaultPricebookId: z.string(),
    defaultInventoryListId: z.string(),
    /** Units stocked per product when the source upload doesn't supply an inventory XML. */
    defaultInventoryUnits: z.number().int().min(0).default(10),

    amClientId: z.string(),
    amClientSecret: z.string(),

    webdavUser: z.string(),
    webdavPassword: z.string(),

    /**
     * Job ID (per-sandbox) for the SearchReindex job. When set, batch product
     * edits trigger this job after the PATCH calls so the storefront sees
     * changes within ~30s. When unset, edits land in B2C immediately but the
     * search index waits for the next scheduled delta-index pass (5-15 min).
     */
    reindexJobId: z.string().optional(),

    port: z.number().default(3001),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(): Config {
    return ConfigSchema.parse({
        b2cInstanceHost: process.env.B2C_INSTANCE_HOST,
        b2cTenant: process.env.B2C_TENANT,
        b2cOrgId: process.env.B2C_ORG_ID,
        b2cShortCode: process.env.B2C_SHORT_CODE,

        storefrontCatalogId: process.env.STOREFRONT_CATALOG_ID,
        defaultPricebookId: process.env.DEFAULT_PRICEBOOK_ID,
        defaultInventoryListId: process.env.DEFAULT_INVENTORY_LIST_ID,
        defaultInventoryUnits: process.env.DEFAULT_INVENTORY_UNITS
            ? Number(process.env.DEFAULT_INVENTORY_UNITS)
            : undefined,

        amClientId: process.env.AM_CLIENT_ID,
        amClientSecret: process.env.AM_CLIENT_SECRET,

        webdavUser: process.env.WEBDAV_USER,
        webdavPassword: process.env.WEBDAV_PASSWORD,

        reindexJobId: process.env.REINDEX_JOB_ID || undefined,

        port: process.env.PORT ? Number(process.env.PORT) : undefined,
    });
}
