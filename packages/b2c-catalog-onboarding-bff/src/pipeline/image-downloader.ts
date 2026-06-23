import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { extname, join } from 'node:path';

export type DownloadResult = {
    /** Map from URL to local file path that was written. */
    urlToPath: Map<string, string>;
    /** Map from URL to error message, when fetch failed. */
    failures: Map<string, string>;
};

const ALLOWED_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.svg']);
const MAX_BYTES_PER_IMAGE = 10 * 1024 * 1024; // 10 MB
const FETCH_TIMEOUT_MS = 15_000;

/**
 * Download every URL into `targetDir`. Filenames are derived from a hash of the URL
 * (so we don't collide and don't need to deal with weird remote names).
 *
 * Returns the path each URL was saved to. Failures are surfaced separately so the
 * caller can decide whether to abort or continue without those images.
 */
export async function downloadImages(
    urls: Set<string>,
    targetDir: string
): Promise<DownloadResult> {
    if (urls.size === 0) {
        return { urlToPath: new Map(), failures: new Map() };
    }
    await mkdir(targetDir, { recursive: true });

    const urlToPath = new Map<string, string>();
    const failures = new Map<string, string>();

    // Run with limited concurrency (5 simultaneous fetches)
    const queue = [...urls];
    const concurrency = 5;
    const workers: Promise<void>[] = [];
    for (let i = 0; i < concurrency; i++) {
        workers.push(
            (async () => {
                while (queue.length > 0) {
                    const url = queue.shift();
                    if (!url) continue;
                    try {
                        const localPath = await downloadOne(url, targetDir);
                        urlToPath.set(url, localPath);
                    } catch (err) {
                        failures.set(url, (err as Error).message);
                    }
                }
            })()
        );
    }
    await Promise.all(workers);
    return { urlToPath, failures };
}

async function downloadOne(url: string, dir: string): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
        const contentType = res.headers.get('content-type') || '';
        const ext = extensionFor(url, contentType);
        if (!ALLOWED_EXT.has(ext)) {
            throw new Error(`Unsupported image type "${contentType || ext}"`);
        }
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > MAX_BYTES_PER_IMAGE) {
            throw new Error(`Image too large (${buf.length} bytes, max ${MAX_BYTES_PER_IMAGE})`);
        }
        const hash = createHash('sha1').update(url).digest('hex').slice(0, 12);
        const filename = `${hash}${ext}`;
        const local = join(dir, filename);
        await writeFile(local, buf);
        return local;
    } finally {
        clearTimeout(timer);
    }
}

function extensionFor(url: string, contentType: string): string {
    const fromCT = contentType.split(';')[0]?.trim().toLowerCase();
    switch (fromCT) {
        case 'image/jpeg':
            return '.jpg';
        case 'image/png':
            return '.png';
        case 'image/gif':
            return '.gif';
        case 'image/webp':
            return '.webp';
        case 'image/avif':
            return '.avif';
        case 'image/svg+xml':
            return '.svg';
    }
    const u = url.split('?')[0]!;
    const ext = extname(u).toLowerCase();
    if (ALLOWED_EXT.has(ext)) return ext;
    return '';
}
