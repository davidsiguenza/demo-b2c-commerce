import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ApiCall } from './api-trace';

const UPLOADS_DIR = join(process.cwd(), 'uploads');

export type UploadStatus =
    | 'received'
    | 'extracting'
    | 'validating'
    | 'invalid'
    | 'previewed'
    | 'cancelled'
    | 'transforming'
    | 'uploading'
    | 'importing'
    | 'completed'
    | 'failed';

export type UploadRecord = {
    id: string;
    /** Free-form id of the master catalog this upload publishes to. Auto-created on import if missing. */
    masterCatalogId: string;
    /** Same value as masterCatalogId — kept for downstream rewrite/repackage clarity. */
    targetCatalogId: string;
    /** Effective storefront catalog id this upload publishes to. */
    storefrontCatalogId: string;
    /** Effective pricebook id (any source pricebook XML gets rewritten to this). */
    pricebookId: string;
    /** Effective inventory list id (any source inventory XML gets rewritten to this). */
    inventoryListId: string;
    receivedAt: string;
    sourceFilename: string;
    sourceBytes: number;
    status: UploadStatus;
    /** Free-form steps with timestamps so the client can render a timeline. */
    events: Array<{ at: string; status: UploadStatus; message?: string }>;
    /** Populated after extraction. */
    extracted?: {
        files: Array<{ relativePath: string; bytes: number }>;
        catalogXml?: string;
        pricebookXmls?: string[];
        inventoryXmls?: string[];
        imagePaths?: string[];
    };
    /** Populated after validation. */
    validation?: {
        ok: boolean;
        errors: string[];
        targetCatalogId?: string;
        productCount?: number;
        categoryIds?: string[];
    };
    /** Populated after preview parse. Free-form JSON; UI renders it. */
    preview?: unknown;
    /** Populated after transform. */
    transform?: {
        masterCatalogXmlPath: string;
        storefrontDeltaXmlPath: string | null;
        reusedCategoryIds: string[];
        newCategoryIds: string[];
        assignmentsPublished: number;
        productIds: string[];
    };
    /** Populated after WebDAV upload. */
    webdav?: {
        archiveName: string;
        remoteName: string;
        url: string;
        bytes: number;
    };
    /** Populated after we trigger the import job. */
    job?: {
        jobId: string;
        executionId: string;
        status?: string;
        startTime?: string;
        endTime?: string;
        logFileName?: string;
    };
    /**
     * Populated after we fire-and-forget the SearchReindex job. We don't poll
     * its status — the storefront's delta-index will eventually converge — so
     * we just record what we triggered for traceability.
     */
    reindex?: {
        triggered: boolean;
        jobId?: string;
        executionId?: string;
        error?: string;
    };
    /**
     * Trace of every external API call made while this upload's pipeline ran.
     * Populated by `withApiTrace()` in lib/api-trace.ts. Used by the admin UI
     * to show what's actually being called against SFCC during a demo.
     */
    apiCalls?: ApiCall[];
    error?: string;
};

export async function createUpload(args: {
    masterCatalogId: string;
    storefrontCatalogId: string;
    pricebookId: string;
    inventoryListId: string;
    sourceFilename: string;
    sourceBytes: number;
}): Promise<UploadRecord> {
    const id = randomUUID();
    const dir = uploadDir(id);
    await mkdir(dir, { recursive: true });
    await mkdir(join(dir, 'extracted'), { recursive: true });

    const record: UploadRecord = {
        id,
        masterCatalogId: args.masterCatalogId,
        targetCatalogId: args.masterCatalogId,
        storefrontCatalogId: args.storefrontCatalogId,
        pricebookId: args.pricebookId,
        inventoryListId: args.inventoryListId,
        receivedAt: new Date().toISOString(),
        sourceFilename: args.sourceFilename,
        sourceBytes: args.sourceBytes,
        status: 'received',
        events: [{ at: new Date().toISOString(), status: 'received' }],
    };
    await persist(record);
    return record;
}

export async function updateUpload(
    id: string,
    patch: Partial<UploadRecord>,
    statusEvent?: { status: UploadStatus; message?: string }
): Promise<UploadRecord> {
    const current = await readUpload(id);
    if (!current) {
        throw new Error(`Upload ${id} not found`);
    }
    const next: UploadRecord = { ...current, ...patch };
    if (statusEvent) {
        next.status = statusEvent.status;
        next.events = [
            ...current.events,
            {
                at: new Date().toISOString(),
                status: statusEvent.status,
                message: statusEvent.message,
            },
        ];
    }
    await persist(next);
    return next;
}

export async function readUpload(id: string): Promise<UploadRecord | null> {
    const path = join(uploadDir(id), 'record.json');
    if (!existsSync(path)) return null;
    const raw = await readFile(path, 'utf8');
    return JSON.parse(raw) as UploadRecord;
}

export function uploadDir(id: string): string {
    return join(UPLOADS_DIR, id);
}

export function extractedDir(id: string): string {
    return join(uploadDir(id), 'extracted');
}

export function sourceArchivePath(id: string): string {
    return join(uploadDir(id), 'source.zip');
}

async function persist(record: UploadRecord): Promise<void> {
    const path = join(uploadDir(record.id), 'record.json');
    await writeFile(path, JSON.stringify(record, null, 2), 'utf8');
}
