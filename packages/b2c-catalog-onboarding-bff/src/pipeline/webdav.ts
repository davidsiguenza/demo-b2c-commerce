import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import type { Config } from '@/lib/config';
import { recordApiCall, redactHeaders, truncateBody } from '@/lib/api-trace';

export type WebdavUploadResult = {
    url: string;
    httpStatus: number;
    bytes: number;
};

const IMPEX_PREFIX = '/on/demandware.servlet/webdav/Sites/Impex';

/**
 * Upload a file to /Impex/src/instance/<remoteName>.
 *
 * B2C's WebDAV expects PUT with body. Most clients chunk it; node fetch's
 * undici will stream a Readable just fine.
 */
export async function uploadToImpex(args: {
    config: Config;
    localPath: string;
    /** e.g. `catalog-abc123.zip` */
    remoteName: string;
}): Promise<WebdavUploadResult> {
    const { config, localPath, remoteName } = args;
    const stats = await stat(localPath);

    const url = `https://${config.b2cInstanceHost}${IMPEX_PREFIX}/src/instance/${encodeURIComponent(
        remoteName
    )}`;
    const auth = Buffer.from(`${config.webdavUser}:${config.webdavPassword}`).toString('base64');

    const stream = createReadStream(localPath);
    const requestHeaders = {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/zip',
        'Content-Length': String(stats.size),
    };

    const startedAt = new Date().toISOString();
    const t0 = Date.now();
    const res = await fetch(url, {
        method: 'PUT',
        headers: requestHeaders,
        body: Readable.toWeb(stream) as ReadableStream,
        duplex: 'half',
    } as RequestInit & { duplex: 'half' });

    const responseText = await res.text();

    await recordApiCall({
        api: 'WebDAV (Impex)',
        label: `PUT /Sites/Impex/src/instance/${remoteName}`,
        method: 'PUT',
        url,
        requestHeaders: redactHeaders(requestHeaders),
        requestBody: `[binary zip stream — ${stats.size} bytes from ${localPath}]`,
        status: res.status,
        responseHeaders: redactHeaders(res.headers),
        responseBody: truncateBody(responseText || '[empty body]'),
        durationMs: Date.now() - t0,
        startedAt,
        endedAt: new Date().toISOString(),
    });

    if (!res.ok) {
        throw new Error(
            `WebDAV PUT ${remoteName} failed: HTTP ${res.status} ${res.statusText} ${responseText.slice(0, 300)}`
        );
    }

    return { url, httpStatus: res.status, bytes: stats.size };
}
