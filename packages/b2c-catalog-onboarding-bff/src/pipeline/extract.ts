import { open as openZip, type Entry } from 'yauzl-promise';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, sep } from 'node:path';
import { Readable } from 'node:stream';

export type ExtractedFile = { relativePath: string; bytes: number; absolutePath: string };

/**
 * Safely extract a zip into `destDir`. Rejects entries that escape the
 * destination (zip slip). Returns a manifest of every regular file written.
 */
export async function extractZip(
    archivePath: string,
    destDir: string
): Promise<ExtractedFile[]> {
    const zip = await openZip(archivePath);
    const files: ExtractedFile[] = [];
    try {
        for await (const entry of zip as AsyncIterable<Entry>) {
            const sanitized = sanitizeEntryName(entry.filename);
            if (sanitized === null) {
                throw new Error(`Unsafe zip entry path rejected: ${entry.filename}`);
            }
            // Directory entries
            if (sanitized.endsWith('/') || sanitized === '') {
                continue;
            }
            const absolute = join(destDir, sanitized.split('/').join(sep));
            await mkdir(dirname(absolute), { recursive: true });

            const stream = await entry.openReadStream();
            const chunks: Buffer[] = [];
            for await (const chunk of stream as AsyncIterable<Buffer>) {
                chunks.push(chunk);
            }
            const buf = Buffer.concat(chunks);
            await writeFile(absolute, buf);
            files.push({ relativePath: sanitized, bytes: buf.length, absolutePath: absolute });
        }
    } finally {
        await zip.close();
    }
    return files;
}

/** Reject absolute paths and `..` segments; normalize separators to `/`. */
function sanitizeEntryName(name: string): string | null {
    const cleaned = name.replace(/\\/g, '/');
    if (cleaned.startsWith('/')) return null;
    const normalized = normalize(cleaned).split(sep).join('/');
    if (normalized.split('/').some((part) => part === '..')) return null;
    return normalized;
}

/** Convenience helper to allow a Buffer / Uint8Array to be pumped through. */
export function bufferToStream(buf: Buffer): Readable {
    return Readable.from(buf);
}
