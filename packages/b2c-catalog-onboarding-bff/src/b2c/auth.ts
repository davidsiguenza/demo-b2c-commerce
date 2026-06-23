import type { Config } from '@/lib/config';
import { recordApiCall, redactHeaders, truncateBody } from '@/lib/api-trace';

type CachedToken = {
    accessToken: string;
    expiresAt: number;
};

let cache: CachedToken | null = null;
const SAFETY_MARGIN_MS = 60_000;
const AM_TOKEN_URL = 'https://account.demandware.com/dwsso/oauth2/access_token';

export async function getAccessToken(config: Config): Promise<string> {
    const now = Date.now();
    if (cache && cache.expiresAt - SAFETY_MARGIN_MS > now) {
        return cache.accessToken;
    }

    const basic = Buffer.from(`${config.amClientId}:${config.amClientSecret}`).toString('base64');
    const requestHeaders = {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
    };
    const requestBody = 'grant_type=client_credentials';

    const startedAt = new Date().toISOString();
    const t0 = Date.now();
    const res = await fetch(AM_TOKEN_URL, {
        method: 'POST',
        headers: requestHeaders,
        body: requestBody,
    });
    const text = await res.text();

    await recordApiCall({
        api: 'Account Manager OAuth2',
        label: 'POST /dwsso/oauth2/access_token (client_credentials)',
        method: 'POST',
        url: AM_TOKEN_URL,
        requestHeaders: redactHeaders(requestHeaders),
        requestBody,
        status: res.status,
        responseHeaders: redactHeaders(res.headers),
        responseBody: truncateBody(redactTokenResponse(text)),
        durationMs: Date.now() - t0,
        startedAt,
        endedAt: new Date().toISOString(),
    });

    if (!res.ok) {
        throw new Error(`AM auth failed: HTTP ${res.status} ${text}`);
    }

    const json = JSON.parse(text) as { access_token: string; expires_in: number };
    cache = {
        accessToken: json.access_token,
        expiresAt: now + json.expires_in * 1000,
    };
    return json.access_token;
}

/** Don't put the bearer in the trace — show its shape so demos look real. */
function redactTokenResponse(text: string): unknown {
    try {
        const j = JSON.parse(text) as { access_token?: string };
        if (j.access_token) {
            const t = j.access_token;
            return { ...j, access_token: `${t.slice(0, 6)}…${t.slice(-4)} (redacted)` };
        }
        return j;
    } catch {
        return text;
    }
}
