import { Hono } from 'hono';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
    createUpload,
    extractedDir,
    readUpload,
    sourceArchivePath,
    updateUpload,
    uploadDir,
    type UploadRecord,
} from '@/lib/upload-store';
import { extractZip } from '@/pipeline/extract';
import { validateUpload } from '@/pipeline/validate';
import { buildPreview } from '@/pipeline/preview-parser';
import { parseSellerCsv } from '@/pipeline/csv-parser';
import { generateXmlsFromCsv } from '@/pipeline/csv-to-xml';
import { downloadImages } from '@/pipeline/image-downloader';
import { transformCatalogUpload } from '@/pipeline/transform';
import { rewritePricebookId, rewriteInventoryListId } from '@/pipeline/rewrite-ids';
import { generateDefaultInventoryIfMissing } from '@/pipeline/inventory';
import {
    buildArchiveName,
    repackageAsSiteArchive,
    repackagedZipPath,
} from '@/pipeline/repackage';
import { uploadToImpex } from '@/pipeline/webdav';
import {
    getJobExecution,
    siteArchiveJobId,
    triggerSearchReindex,
    triggerSiteArchiveImport,
} from '@/b2c/jobs';
import { loadConfig } from '@/lib/config';
import { withApiTrace } from '@/lib/api-trace';

const config = loadConfig();

export const uploadsRouter = new Hono();

const MAX_BYTES = 250 * 1024 * 1024; // 250 MB

/**
 * Master catalog id validator. SFCC catalog ids accept letters, digits,
 * underscore and hyphen. We bound the length to a sane 1-100 so a typo
 * doesn't sneak a 4 KB id into the catalog tree.
 */
const MASTER_CATALOG_ID_RE = /^[A-Za-z0-9_-]{1,100}$/;

uploadsRouter.post('/catalogs/:masterCatalogId/uploads', async (c) => {
    const masterCatalogId = c.req.param('masterCatalogId');
    if (!MASTER_CATALOG_ID_RE.test(masterCatalogId)) {
        return c.json(
            { ok: false, error: `Invalid masterCatalogId. Expected ${MASTER_CATALOG_ID_RE}` },
            400
        );
    }

    const form = await c.req.formData().catch(() => null);
    if (!form) {
        return c.json({ ok: false, error: 'Body must be multipart/form-data with a `file` field' }, 400);
    }

    const file = form.get('file');
    if (!(file instanceof File)) {
        return c.json({ ok: false, error: 'Missing `file` field of type file' }, 400);
    }
    if (file.size > MAX_BYTES) {
        return c.json(
            { ok: false, error: `File too large (${file.size} bytes, max ${MAX_BYTES})` },
            413
        );
    }
    if (!/\.zip$/i.test(file.name)) {
        return c.json({ ok: false, error: 'Only .zip uploads are accepted' }, 415);
    }

    const overrideOr = (key: string, fallback: string) => {
        const v = form.get(key);
        return typeof v === 'string' && v.trim().length > 0 ? v.trim() : fallback;
    };
    const storefrontCatalogId = overrideOr('storefrontCatalogId', config.storefrontCatalogId);
    const pricebookId = overrideOr('pricebookId', config.defaultPricebookId);
    const inventoryListId = overrideOr('inventoryListId', config.defaultInventoryListId);

    const record = await createUpload({
        masterCatalogId,
        storefrontCatalogId,
        pricebookId,
        inventoryListId,
        sourceFilename: file.name,
        sourceBytes: file.size,
    });
    const archivePath = sourceArchivePath(record.id);
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(archivePath, buffer);

    // Phase 1: extract + validate + parse for preview. Returns once the
    // upload is in `previewed` (or `invalid`/`failed`) state.
    void withApiTrace(record.id, () => runPreviewPhase(record.id)).catch((err) => {
        console.error(`preview phase failed for ${record.id}`, err);
    });

    return c.json(
        {
            ok: true,
            uploadId: record.id,
            masterCatalogId,
            targetCatalogId: record.targetCatalogId,
            storefrontCatalogId,
            pricebookId,
            inventoryListId,
            previewUrl: `/api/uploads/${record.id}/preview`,
            statusUrl: `/api/uploads/${record.id}`,
        },
        202
    );
});

/** GET /api/uploads/:uploadId/preview — product list ready for review. */
uploadsRouter.get('/uploads/:uploadId/preview', async (c) => {
    const id = c.req.param('uploadId');
    const record = await readUpload(id);
    if (!record) return c.json({ ok: false, error: 'Upload not found' }, 404);
    if (!record.preview) {
        return c.json(
            { ok: false, error: `Preview not ready (status=${record.status})`, status: record.status },
            409
        );
    }
    return c.json({
        ok: true,
        uploadId: id,
        status: record.status,
        catalog: {
            masterCatalogId: record.masterCatalogId,
            targetCatalogId: record.targetCatalogId,
        },
        targets: {
            storefrontCatalogId: record.storefrontCatalogId,
            pricebookId: record.pricebookId,
            inventoryListId: record.inventoryListId,
        },
        preview: record.preview,
    });
});

/** POST /api/uploads/:uploadId/commit — confirms and runs the rest of the pipeline. */
uploadsRouter.post('/uploads/:uploadId/commit', async (c) => {
    const id = c.req.param('uploadId');
    const record = await readUpload(id);
    if (!record) return c.json({ ok: false, error: 'Upload not found' }, 404);
    if (record.status !== 'previewed') {
        return c.json(
            { ok: false, error: `Cannot commit upload in status=${record.status}` },
            409
        );
    }
    void withApiTrace(id, () => runCommitPhase(id)).catch((err) => {
        console.error(`commit phase failed for ${id}`, err);
    });
    return c.json({ ok: true, uploadId: id, statusUrl: `/api/uploads/${id}` }, 202);
});

/** DELETE /api/uploads/:uploadId — cancel and wipe a previewed/invalid upload. */
uploadsRouter.delete('/uploads/:uploadId', async (c) => {
    const id = c.req.param('uploadId');
    const record = await readUpload(id);
    if (!record) return c.json({ ok: false, error: 'Upload not found' }, 404);
    // Only allow cancel from non-terminal-or-running states
    if (['importing', 'completed', 'failed', 'cancelled'].includes(record.status)) {
        return c.json(
            { ok: false, error: `Cannot cancel an upload in status=${record.status}` },
            409
        );
    }
    await updateUpload(
        id,
        {},
        { status: 'cancelled', message: 'Upload cancelled by user.' }
    );
    const dir = uploadDir(id);
    if (existsSync(dir)) {
        await rm(dir, { recursive: true, force: true });
    }
    return c.json({ ok: true, uploadId: id, status: 'cancelled' });
});

/** GET /api/csv-template — downloadable CSV starter template. */
uploadsRouter.get('/csv-template', (c) => {
    const csv = [
        'id,name,price,category,currency,stock,brand,short_description,long_description,image_url,category_name',
        'sample-001,Sample Product,29.99,demo-category,USD,50,Acme,A short description,A longer description with more detail.,https://via.placeholder.com/400x400.png,Demo Category',
        'sample-002,Another Product,49.95,demo-category|featured,USD,,Acme,,,,',
    ].join('\n');
    return new Response(csv, {
        headers: {
            'Content-Type': 'text/csv',
            'Content-Disposition': 'attachment; filename="catalog-template.csv"',
        },
    });
});

/** POST /api/catalogs/:masterCatalogId/uploads/csv — flat CSV path. */
uploadsRouter.post('/catalogs/:masterCatalogId/uploads/csv', async (c) => {
    const masterCatalogId = c.req.param('masterCatalogId');
    if (!MASTER_CATALOG_ID_RE.test(masterCatalogId)) {
        return c.json(
            { ok: false, error: `Invalid masterCatalogId. Expected ${MASTER_CATALOG_ID_RE}` },
            400
        );
    }

    const form = await c.req.formData().catch(() => null);
    if (!form) {
        return c.json({ ok: false, error: 'Body must be multipart/form-data with a `file` field' }, 400);
    }

    const file = form.get('file');
    if (!(file instanceof File)) {
        return c.json({ ok: false, error: 'Missing `file` field of type file' }, 400);
    }
    if (file.size > MAX_BYTES) {
        return c.json({ ok: false, error: `File too large (${file.size} bytes, max ${MAX_BYTES})` }, 413);
    }
    if (!/\.csv$/i.test(file.name)) {
        return c.json({ ok: false, error: 'Only .csv uploads are accepted on this endpoint' }, 415);
    }

    const csvText = await file.text();
    const parsed = parseSellerCsv(csvText);
    if (!parsed.ok) {
        return c.json(
            {
                ok: false,
                error: 'CSV validation failed',
                csvErrors: parsed.errors,
            },
            400
        );
    }

    const overrideOr = (key: string, fallback: string) => {
        const v = form.get(key);
        return typeof v === 'string' && v.trim().length > 0 ? v.trim() : fallback;
    };
    const storefrontCatalogId = overrideOr('storefrontCatalogId', config.storefrontCatalogId);
    const pricebookId = overrideOr('pricebookId', config.defaultPricebookId);
    const inventoryListId = overrideOr('inventoryListId', config.defaultInventoryListId);

    const record = await createUpload({
        masterCatalogId,
        storefrontCatalogId,
        pricebookId,
        inventoryListId,
        sourceFilename: file.name,
        sourceBytes: file.size,
    });

    // Keep the source CSV on disk for traceability
    await writeFile(sourceArchivePath(record.id).replace(/\.zip$/, '.csv'), csvText, 'utf8');

    void withApiTrace(record.id, () =>
        runCsvPreviewPhase(record.id, parsed.rows)
    ).catch((err) => {
        console.error(`csv preview phase failed for ${record.id}`, err);
    });

    return c.json(
        {
            ok: true,
            uploadId: record.id,
            masterCatalogId,
            targetCatalogId: record.targetCatalogId,
            storefrontCatalogId,
            pricebookId,
            inventoryListId,
            previewUrl: `/api/uploads/${record.id}/preview`,
            statusUrl: `/api/uploads/${record.id}`,
        },
        202
    );
});

uploadsRouter.get('/uploads/:uploadId', async (c) => {
    const id = c.req.param('uploadId');
    const record = await readUpload(id);
    if (!record) {
        return c.json({ ok: false, error: 'Upload not found' }, 404);
    }
    return c.json({ ok: true, upload: record });
});

/**
 * Phase 1 (CSV variant): generate the catalog/pricebook/inventory XMLs from
 * the parsed CSV rows directly into `extracted/`, then hand off to the regular
 * preview pipeline so we don't duplicate validation/preview logic.
 */
async function runCsvPreviewPhase(
    uploadId: string,
    rows: import('@/pipeline/csv-parser').CsvRow[]
): Promise<void> {
    let record = await readUpload(uploadId);
    if (!record) return;

    const extractedRoot = extractedDir(uploadId);
    await mkdir(extractedRoot, { recursive: true });
    const imagesDir = join(extractedRoot, 'static', 'default', 'images');

    // 1) Download images (best-effort)
    const allUrls = new Set<string>();
    for (const r of rows) if (r.imageUrl) allUrls.add(r.imageUrl);
    let urlToBasename = new Map<string, string>();
    if (allUrls.size > 0) {
        await updateUpload(
            uploadId,
            {},
            { status: 'extracting', message: `Downloading ${allUrls.size} image(s)…` }
        );
        try {
            const { urlToPath, failures } = await downloadImages(allUrls, imagesDir);
            for (const [url, p] of urlToPath) {
                urlToBasename.set(url, p.split('/').pop()!);
            }
            if (failures.size > 0) {
                await updateUpload(
                    uploadId,
                    {},
                    {
                        status: 'extracting',
                        message:
                            `Downloaded ${urlToPath.size}/${allUrls.size} image(s); ` +
                            `${failures.size} failed.`,
                    }
                );
            } else {
                await updateUpload(
                    uploadId,
                    {},
                    { status: 'extracting', message: `Downloaded ${urlToPath.size} image(s).` }
                );
            }
        } catch (err) {
            await updateUpload(
                uploadId,
                { error: (err as Error).message },
                { status: 'failed', message: 'image-download: ' + (err as Error).message }
            );
            return;
        }
    }

    // 2) Generate the 3 XMLs straight into `extracted/`
    try {
        await generateXmlsFromCsv(rows, {
            outDir: extractedRoot,
            targetCatalogId: record.targetCatalogId,
            pricebookId: record.pricebookId,
            inventoryListId: record.inventoryListId,
            defaultStock: config.defaultInventoryUnits,
            imageResolver: (url) => urlToBasename.get(url) ?? null,
        });
        await updateUpload(
            uploadId,
            {},
            {
                status: 'extracting',
                message: `Synthesized catalog/pricebook/inventory XMLs from ${rows.length} CSV rows.`,
            }
        );
    } catch (err) {
        await updateUpload(
            uploadId,
            { error: (err as Error).message },
            { status: 'failed', message: 'csv-generate: ' + (err as Error).message }
        );
        return;
    }

    // 3) Re-scan the extracted dir as if it had come from a zip, so validation
    //    + preview-parser run identical to the zip path.
    const filesManifest = await walkExtracted(extractedRoot);
    const validation = await validateUpload(filesManifest);

    record = await updateUpload(uploadId, {
        extracted: {
            files: filesManifest.map((f) => ({ relativePath: f.relativePath, bytes: f.bytes })),
            catalogXml: validation.recognized.catalogXml,
            pricebookXmls: validation.recognized.pricebookXmls,
            inventoryXmls: validation.recognized.inventoryXmls,
            imagePaths: validation.recognized.imagePaths.map((i) => i.relativePath),
        },
        validation: {
            ok: validation.ok,
            errors: validation.errors,
            targetCatalogId: validation.targetCatalogId,
            productCount: validation.productCount,
            categoryIds: validation.categoryIds,
        },
    });

    if (!validation.ok) {
        await updateUpload(
            uploadId,
            {},
            { status: 'invalid', message: `Validation failed after CSV synth: ${validation.errors.join('; ')}` }
        );
        return;
    }

    // 4) Build preview, mark `previewed`
    try {
        const preview = await buildPreview({
            extractedRoot,
            catalogXmlRelativePath: validation.recognized.catalogXml!,
            pricebookXmlRelativePaths: validation.recognized.pricebookXmls,
            inventoryXmlRelativePaths: validation.recognized.inventoryXmls,
        });
        await updateUpload(
            uploadId,
            { preview },
            {
                status: 'previewed',
                message:
                    `Preview ready: ${preview.summary.productCount} products, ` +
                    `${preview.summary.pricebookEntryCount} prices, ` +
                    `${preview.summary.inventoryRecordCount} stock records.`,
            }
        );
    } catch (err) {
        await updateUpload(
            uploadId,
            { error: (err as Error).message },
            { status: 'failed', message: 'preview: ' + (err as Error).message }
        );
    }
}

/** Build the same `ExtractedFile[]` manifest the zip extractor produces. */
async function walkExtracted(root: string) {
    const { readdir, stat } = await import('node:fs/promises');
    const out: Array<{ relativePath: string; bytes: number; absolutePath: string }> = [];
    async function walk(dir: string, prefix: string) {
        const entries = await readdir(dir, { withFileTypes: true });
        for (const e of entries) {
            const abs = join(dir, e.name);
            const rel = prefix ? `${prefix}/${e.name}` : e.name;
            if (e.isDirectory()) await walk(abs, rel);
            else if (e.isFile()) {
                const s = await stat(abs);
                out.push({ relativePath: rel, bytes: s.size, absolutePath: abs });
            }
        }
    }
    await walk(root, '');
    return out;
}

/**
 * Phase 1: extract → validate → parse preview.
 * Leaves the upload in `previewed` state (or `invalid`/`failed`).
 * The user must then POST /api/uploads/:id/commit to continue.
 */
async function runPreviewPhase(uploadId: string): Promise<void> {
    let record = await readUpload(uploadId);
    if (!record) return;

    // ---- Extract ----
    record = await updateUpload(uploadId, {}, { status: 'extracting' });
    let extracted;
    try {
        extracted = await extractZip(sourceArchivePath(uploadId), extractedDir(uploadId));
    } catch (err) {
        await updateUpload(
            uploadId,
            { error: (err as Error).message },
            { status: 'failed', message: 'extract: ' + (err as Error).message }
        );
        return;
    }

    record = await updateUpload(uploadId, {
        extracted: {
            files: extracted.map((f) => ({ relativePath: f.relativePath, bytes: f.bytes })),
        },
    });

    // ---- Validate ----
    record = await updateUpload(uploadId, {}, { status: 'validating' });
    const validation = await validateUpload(extracted);

    record = await updateUpload(uploadId, {
        extracted: {
            files: extracted.map((f) => ({ relativePath: f.relativePath, bytes: f.bytes })),
            catalogXml: validation.recognized.catalogXml,
            pricebookXmls: validation.recognized.pricebookXmls,
            inventoryXmls: validation.recognized.inventoryXmls,
            imagePaths: validation.recognized.imagePaths.map((i) => i.relativePath),
        },
        validation: {
            ok: validation.ok,
            errors: validation.errors,
            targetCatalogId: validation.targetCatalogId,
            productCount: validation.productCount,
            categoryIds: validation.categoryIds,
        },
    });

    if (!validation.ok) {
        await updateUpload(
            uploadId,
            {},
            {
                status: 'invalid',
                message: `Validation failed: ${validation.errors.length} error(s)`,
            }
        );
        return;
    }

    // ---- Build preview payload ----
    try {
        const preview = await buildPreview({
            extractedRoot: extractedDir(uploadId),
            catalogXmlRelativePath: validation.recognized.catalogXml!,
            pricebookXmlRelativePaths: validation.recognized.pricebookXmls,
            inventoryXmlRelativePaths: validation.recognized.inventoryXmls,
        });
        await updateUpload(
            uploadId,
            { preview },
            {
                status: 'previewed',
                message:
                    `Preview ready: ${preview.summary.productCount} products, ` +
                    `${preview.summary.pricebookEntryCount} prices, ` +
                    `${preview.summary.inventoryRecordCount} stock records, ` +
                    `${preview.summary.categoryIds.length} categories.`,
            }
        );
    } catch (err) {
        await updateUpload(
            uploadId,
            { error: (err as Error).message },
            { status: 'failed', message: 'preview: ' + (err as Error).message }
        );
    }
}

/**
 * Phase 2: transform → rewrite ids → repackage → webdav → trigger job → poll.
 * Run once the user confirms the preview.
 */
async function runCommitPhase(uploadId: string): Promise<void> {
    let record = await readUpload(uploadId);
    if (!record) return;
    const validation = record.validation;
    if (!validation || !validation.ok || !record.extracted?.catalogXml) {
        await updateUpload(
            uploadId,
            { error: 'Cannot commit: missing valid preview state.' },
            { status: 'failed', message: 'commit: invalid state' }
        );
        return;
    }

    // ---- Transform ----
    record = await updateUpload(uploadId, {}, { status: 'transforming' });
    const transformedRoot = join(uploadDir(uploadId), 'transformed');
    await mkdir(transformedRoot, { recursive: true });

    let transform;
    try {
        transform = await transformCatalogUpload({
            config,
            extractedRoot: extractedDir(uploadId),
            catalogXmlRelativePath: record.extracted!.catalogXml!,
            targetCatalogId: record.targetCatalogId,
            storefrontCatalogId: record.storefrontCatalogId,
            transformedRoot,
        });

        record = await updateUpload(
            uploadId,
            {
                transform: {
                    masterCatalogXmlPath: transform.masterCatalogXmlPath,
                    storefrontDeltaXmlPath: transform.storefrontDeltaXmlPath,
                    reusedCategoryIds: transform.reusedCategoryIds,
                    newCategoryIds: transform.newCategoryIds,
                    assignmentsPublished: transform.assignmentsPublished,
                    productIds: transform.productIds,
                },
            },
            {
                status: 'transforming',
                message:
                    `Transform OK. Reused: [${transform.reusedCategoryIds.join(', ') || '∅'}]. ` +
                    `New: [${transform.newCategoryIds.join(', ') || '∅'}]. ` +
                    `Assignments: ${transform.assignmentsPublished}.`,
            }
        );
    } catch (err) {
        await updateUpload(
            uploadId,
            { error: (err as Error).message },
            { status: 'failed', message: 'transform: ' + (err as Error).message }
        );
        return;
    }

    // ---- Repackage ----
    const archiveName = buildArchiveName(uploadId);
    const outputZipPath = repackagedZipPath(uploadDir(uploadId), archiveName);

    const pricebookAbsolutes = (record.extracted?.pricebookXmls ?? []).map((rel) =>
        join(extractedDir(uploadId), rel)
    );
    const inventoryAbsolutes = (record.extracted?.inventoryXmls ?? []).map((rel) =>
        join(extractedDir(uploadId), rel)
    );

    // Rewrite pricebook-id / list-id in place so source files line up with the
    // ids configured for this upload. This is what makes inventory actually
    // visible to the site (must match the pricebook/inventory list assigned
    // to the storefront).
    try {
        for (const p of pricebookAbsolutes) await rewritePricebookId(p, record.pricebookId);
        for (const p of inventoryAbsolutes) await rewriteInventoryListId(p, record.inventoryListId);
        if (pricebookAbsolutes.length || inventoryAbsolutes.length) {
            await updateUpload(
                uploadId,
                {},
                {
                    status: 'transforming',
                    message: `Rewrote pricebook-id → ${record.pricebookId}, list-id → ${record.inventoryListId}.`,
                }
            );
        }
    } catch (err) {
        await updateUpload(
            uploadId,
            { error: (err as Error).message },
            { status: 'failed', message: 'rewrite-ids: ' + (err as Error).message }
        );
        return;
    }

    // ---- Auto-generate inventory if the source upload didn't provide any ----
    try {
        const generatedInventoryPath = await generateDefaultInventoryIfMissing({
            transformedRoot,
            inventoryListId: record.inventoryListId,
            productIds: transform.productIds,
            defaultUnits: config.defaultInventoryUnits,
            sourceProvidedInventory: inventoryAbsolutes.length > 0,
        });
        if (generatedInventoryPath) {
            inventoryAbsolutes.push(generatedInventoryPath);
            await updateUpload(
                uploadId,
                {},
                {
                    status: 'transforming',
                    message:
                        `Generated default inventory (${transform.productIds.length} products × ` +
                        `${config.defaultInventoryUnits} units) into ${config.defaultInventoryListId}.`,
                }
            );
        }
    } catch (err) {
        await updateUpload(
            uploadId,
            { error: (err as Error).message },
            { status: 'failed', message: 'inventory: ' + (err as Error).message }
        );
        return;
    }

    // Scan the live filesystem for product images (transform may have
    // downloaded URL-referenced images after the initial extracted manifest
    // was persisted).
    const imagesDirAbs = join(extractedDir(uploadId), 'static', 'default', 'images');
    let imageAbsolutes: Array<{ absolutePath: string; relativePath: string }> = [];
    try {
        const { readdir } = await import('node:fs/promises');
        const entries = await readdir(imagesDirAbs, { withFileTypes: true });
        imageAbsolutes = entries
            .filter((e) => e.isFile())
            .map((e) => ({
                absolutePath: join(imagesDirAbs, e.name),
                relativePath: e.name,
            }));
    } catch {
        // dir doesn't exist — no images
    }

    let repackage;
    try {
        repackage = await repackageAsSiteArchive({
            archiveName,
            outputZipPath,
            masterCatalogXmlPath: transform.masterCatalogXmlPath,
            targetCatalogId: record.targetCatalogId,
            storefrontDeltaXmlPath: transform.storefrontDeltaXmlPath,
            storefrontCatalogId: record.storefrontCatalogId,
            pricebookAbsolutePaths: pricebookAbsolutes,
            inventoryAbsolutePaths: inventoryAbsolutes,
            imageAbsolutePaths: imageAbsolutes,
        });
        await updateUpload(
            uploadId,
            {},
            {
                status: 'transforming',
                message: `Repackaged ${repackage.entries.length} files into ${repackage.bytes} bytes.`,
            }
        );
    } catch (err) {
        await updateUpload(
            uploadId,
            { error: (err as Error).message },
            { status: 'failed', message: 'repackage: ' + (err as Error).message }
        );
        return;
    }

    // ---- WebDAV upload ----
    record = await updateUpload(uploadId, {}, { status: 'uploading' });
    const remoteName = `${archiveName}.zip`;
    let webdav;
    try {
        webdav = await uploadToImpex({
            config,
            localPath: repackage.zipPath,
            remoteName,
        });
        record = await updateUpload(
            uploadId,
            {
                webdav: {
                    archiveName,
                    remoteName,
                    url: webdav.url,
                    bytes: webdav.bytes,
                },
            },
            {
                status: 'uploading',
                message: `Uploaded ${webdav.bytes} bytes to ${webdav.url} (HTTP ${webdav.httpStatus}).`,
            }
        );
    } catch (err) {
        await updateUpload(
            uploadId,
            { error: (err as Error).message },
            { status: 'failed', message: 'webdav: ' + (err as Error).message }
        );
        return;
    }

    // ---- Trigger import job ----
    record = await updateUpload(uploadId, {}, { status: 'importing' });
    let execution;
    try {
        execution = await triggerSiteArchiveImport(config, remoteName, 'merge');
        record = await updateUpload(
            uploadId,
            {
                job: {
                    jobId: siteArchiveJobId,
                    executionId: execution.id,
                    status: execution.status ?? execution.execution_status,
                    startTime: execution.start_time,
                    logFileName: execution.log_file_name,
                },
            },
            {
                status: 'importing',
                message: `Triggered ${siteArchiveJobId} execution ${execution.id} (status=${
                    execution.status ?? execution.execution_status
                }).`,
            }
        );
    } catch (err) {
        await updateUpload(
            uploadId,
            { error: (err as Error).message },
            { status: 'failed', message: 'job-trigger: ' + (err as Error).message }
        );
        return;
    }

    // ---- Poll ----
    void pollExecution(uploadId, execution.id).catch((err) => {
        console.error(`poll failed for upload ${uploadId}`, err);
    });
}

/**
 * Poll the job execution every few seconds until it reports a terminal state.
 * Updates the upload record with final status.
 */
async function pollExecution(uploadId: string, executionId: string): Promise<void> {
    const TERMINAL = new Set(['OK', 'FINISHED', 'ERROR', 'CANCELLED', 'ABORTED']);
    const POLL_INTERVAL_MS = 4_000;
    const MAX_ATTEMPTS = 90; // 6 minutes

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        await delay(POLL_INTERVAL_MS);
        let exec;
        try {
            exec = await getJobExecution(loadConfig(), siteArchiveJobId, executionId);
        } catch (err) {
            await updateUpload(
                uploadId,
                {},
                { status: 'importing', message: `poll #${attempt}: ${(err as Error).message}` }
            );
            continue;
        }
        const status = exec.status ?? exec.execution_status ?? 'unknown';
        const upper = String(status).toUpperCase();

        await updateUpload(
            uploadId,
            {
                job: {
                    jobId: siteArchiveJobId,
                    executionId,
                    status: upper,
                    startTime: exec.start_time,
                    endTime: exec.end_time,
                    logFileName: exec.log_file_name,
                },
            },
            { status: 'importing', message: `poll #${attempt}: status=${upper}` }
        );

        if (TERMINAL.has(upper)) {
            const importOk = upper === 'OK' || upper === 'FINISHED';

            // Fire-and-forget SearchReindex on success — without this the
            // newly-imported products won't appear on the storefront until
            // SFCC's scheduled delta-index runs (5-15min). We don't poll the
            // reindex; we just record what we triggered for traceability.
            let reindex: NonNullable<UploadRecord['reindex']> = { triggered: false };
            if (importOk && config.reindexJobId) {
                try {
                    const exec = await triggerSearchReindex(loadConfig(), config.reindexJobId);
                    reindex = {
                        triggered: true,
                        jobId: config.reindexJobId,
                        executionId: exec.id,
                    };
                } catch (err) {
                    reindex = {
                        triggered: false,
                        jobId: config.reindexJobId,
                        error: (err as Error).message,
                    };
                }
            }

            const finalStatus = importOk ? 'completed' : 'failed';
            const reindexNote = reindex.triggered
                ? ` Reindex triggered (${reindex.jobId}, exec=${reindex.executionId}).`
                : reindex.error
                ? ` Reindex trigger FAILED (${reindex.jobId}): ${reindex.error}.`
                : '';
            await updateUpload(
                uploadId,
                { reindex },
                {
                    status: finalStatus,
                    message: `Job ${executionId} terminal status=${upper}.${reindexNote}`,
                }
            );
            return;
        }
    }
    await updateUpload(
        uploadId,
        { error: 'Polling timed out after 6 minutes' },
        { status: 'failed', message: 'poll: timeout' }
    );
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
