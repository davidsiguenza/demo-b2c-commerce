import { createRequire } from 'node:module';
import { createWriteStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';

type ZipArchiveCtor = new (options?: { zlib?: { level: number } }) => {
    pipe(dest: NodeJS.WritableStream): unknown;
    file(path: string, options: { name: string }): unknown;
    finalize(): Promise<void>;
    on(event: 'warning', cb: (err: { code?: string }) => void): unknown;
    on(event: 'error', cb: (err: Error) => void): unknown;
};

const require = createRequire(import.meta.url);
const { ZipArchive } = require('archiver') as { ZipArchive: ZipArchiveCtor };

export type RepackageInput = {
    /** Logical archive name; becomes the top-level folder inside the zip. */
    archiveName: string;
    /** Where the repackaged zip should be written. */
    outputZipPath: string;
    /** Path to the master catalog's transformed catalog.xml (catalog-id already rewritten). */
    masterCatalogXmlPath: string;
    targetCatalogId: string;
    /** Storefront delta catalog.xml (new categories + assignments). May be null. */
    storefrontDeltaXmlPath: string | null;
    storefrontCatalogId: string;
    /** Original pricebook XML files (absolute paths) — copied as-is. */
    pricebookAbsolutePaths: string[];
    /** Original inventory XML files (absolute paths) — copied as-is. */
    inventoryAbsolutePaths: string[];
    /**
     * Optional product images (absolute paths). Copied to
     * `<archive>/catalogs/<targetCatalogId>/static/default/images/` so
     * site-archive-import wires them onto products via the catalog.xml
     * `<image path="…"/>` entries.
     */
    imageAbsolutePaths?: Array<{ absolutePath: string; relativePath: string }>;
};

export type RepackageResult = {
    zipPath: string;
    bytes: number;
    /** Folder name used inside the zip (matches `archive_name` for site-archive-import). */
    archiveName: string;
    entries: string[];
};

/**
 * Build a B2C site-archive style zip:
 *
 *   <archiveName>/
 *     catalogs/
 *       <targetCatalogId>/catalog.xml
 *       <storefrontCatalogId>/catalog.xml   (delta, optional)
 *     pricebooks/<...>.xml
 *     inventory-lists/<...>.xml
 *
 * The zip is consumed by the built-in `sfcc-site-archive-import` job.
 */
export async function repackageAsSiteArchive(input: RepackageInput): Promise<RepackageResult> {
    const entries: string[] = [];
    await new Promise<void>((resolve, reject) => {
        const out = createWriteStream(input.outputZipPath);
        const archive = new ZipArchive({ zlib: { level: 6 } });
        out.on('close', resolve);
        out.on('error', reject);
        archive.on('warning', (err: { code?: string }) => {
            if (err.code === 'ENOENT') return;
            reject(err);
        });
        archive.on('error', reject);
        archive.pipe(out);

        const root = input.archiveName;

        const masterEntry = `${root}/catalogs/${input.targetCatalogId}/catalog.xml`;
        archive.file(input.masterCatalogXmlPath, { name: masterEntry });
        entries.push(masterEntry);

        if (input.storefrontDeltaXmlPath) {
            const storefrontEntry = `${root}/catalogs/${input.storefrontCatalogId}/catalog.xml`;
            archive.file(input.storefrontDeltaXmlPath, { name: storefrontEntry });
            entries.push(storefrontEntry);
        }

        for (const p of input.pricebookAbsolutePaths) {
            const name = `${root}/pricebooks/${basename(p)}`;
            archive.file(p, { name });
            entries.push(name);
        }
        for (const p of input.inventoryAbsolutePaths) {
            const name = `${root}/inventory-lists/${basename(p)}`;
            archive.file(p, { name });
            entries.push(name);
        }

        // Static product images, nested under the master catalog folder so the
        // import job applies image-settings.internal-location ("/images")
        // consistently regardless of where they came from in the source upload.
        for (const img of input.imageAbsolutePaths ?? []) {
            const name = `${root}/catalogs/${input.targetCatalogId}/static/default/images/${img.relativePath}`;
            archive.file(img.absolutePath, { name });
            entries.push(name);
        }

        void archive.finalize();
    });

    const stats = await stat(input.outputZipPath);
    return {
        zipPath: input.outputZipPath,
        bytes: stats.size,
        archiveName: input.archiveName,
        entries,
    };
}

function basename(p: string): string {
    return p.split(/[\\/]/).pop() ?? p;
}

/** Suggest a deterministic archive name derived from upload id. */
export function buildArchiveName(uploadId: string): string {
    return `catalog-upload-${uploadId}`;
}

/** Compute the absolute repackage output path inside an upload dir. */
export function repackagedZipPath(uploadDirPath: string, archiveName: string): string {
    return join(uploadDirPath, `${archiveName}.zip`);
}
