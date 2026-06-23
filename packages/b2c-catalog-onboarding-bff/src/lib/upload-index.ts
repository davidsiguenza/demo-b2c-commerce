import { readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readUpload, type UploadRecord } from './upload-store';

const UPLOADS_DIR = join(process.cwd(), 'uploads');

/**
 * Walks the on-disk upload store and returns every persisted record.
 * For now we keep it simple: the store is small (one folder per upload) and
 * we don't need a real index. If volumes grow we'd swap this for sqlite.
 */
export async function listAllUploads(): Promise<UploadRecord[]> {
    if (!existsSync(UPLOADS_DIR)) return [];
    const entries = await readdir(UPLOADS_DIR, { withFileTypes: true });
    const ids = entries.filter((e) => e.isDirectory()).map((e) => e.name);
    const records = await Promise.all(ids.map((id) => readUpload(id)));
    return records.filter((r): r is UploadRecord => r !== null);
}

export async function uploadsForCatalog(masterCatalogId: string): Promise<UploadRecord[]> {
    const all = await listAllUploads();
    return all.filter((u) => u.masterCatalogId === masterCatalogId);
}
