import { AsyncLocalStorage } from 'node:async_hooks';
import { readUpload, updateUpload } from './upload-store';

export type ApiCall = {
    /** Monotonic id, useful so the UI keeps insertion order even on reload. */
    seq: number;
    /** Display label — "OCAPI Data", "Account Manager OAuth", "WebDAV". */
    api: string;
    /** Free-form short description shown in the panel header. */
    label: string;
    method: string;
    url: string;
    /** Headers as captured BEFORE redaction. We redact here. */
    requestHeaders?: Record<string, string>;
    /** Best-effort JSON or string body. Binary streams are summarized. */
    requestBody?: unknown;
    status?: number;
    responseHeaders?: Record<string, string>;
    responseBody?: unknown;
    /** Wall-clock duration in ms. */
    durationMs?: number;
    /** Populated when the call threw. */
    error?: string;
    startedAt: string;
    endedAt?: string;
};

type TraceContext = {
    /** When set, every recorded call is persisted into the upload's record.json. */
    uploadId?: string;
    /** Mutable in-memory mirror so we don't have to re-read record.json
     *  every time we append. Persistence is fire-and-forget via persistTrace(). */
    calls: ApiCall[];
    counter: { n: number };
};

const als = new AsyncLocalStorage<TraceContext>();

/** Run `fn` with a trace context bound to this upload. All API calls made
 *  inside this async chain will be captured into the upload's record. */
export async function withApiTrace<T>(uploadId: string, fn: () => Promise<T>): Promise<T> {
    const ctx: TraceContext = { uploadId, calls: [], counter: { n: 0 } };
    return als.run(ctx, fn);
}

/** Run `fn` and return both its result and the API calls it made — without
 *  persisting anything. Used by request-scoped routes (e.g. live edit) that
 *  want to show the trace in the response payload. */
export async function captureApiCalls<T>(
    fn: () => Promise<T>
): Promise<{ result: T; calls: ApiCall[] }> {
    const ctx: TraceContext = { calls: [], counter: { n: 0 } };
    const result = await als.run(ctx, fn);
    return { result, calls: ctx.calls.slice() };
}

/** Record an API call. Safe to call outside a trace context — becomes a no-op. */
export async function recordApiCall(
    partial: Omit<ApiCall, 'seq' | 'startedAt'> & { startedAt?: string }
): Promise<void> {
    const ctx = als.getStore();
    if (!ctx) return;
    const seq = ++ctx.counter.n;
    const call: ApiCall = {
        seq,
        startedAt: partial.startedAt ?? new Date().toISOString(),
        endedAt: partial.endedAt ?? new Date().toISOString(),
        ...partial,
    };
    ctx.calls.push(call);
    if (ctx.uploadId) await persistTrace(ctx, ctx.uploadId);
}

async function persistTrace(ctx: TraceContext, uploadId: string): Promise<void> {
    try {
        const current = await readUpload(uploadId);
        if (!current) return;
        await updateUpload(uploadId, { apiCalls: ctx.calls.slice() });
    } catch {
        // tracing must never break the pipeline — swallow.
    }
}

/** Strip Authorization, Cookie and any *-secret/-password header values. */
export function redactHeaders(h: Headers | Record<string, string> | undefined): Record<string, string> {
    if (!h) return {};
    const out: Record<string, string> = {};
    const entries = h instanceof Headers ? Array.from(h.entries()) : Object.entries(h);
    for (const [k, v] of entries) {
        const lower = k.toLowerCase();
        if (lower === 'authorization' || lower === 'cookie' || lower.includes('secret') || lower.includes('password')) {
            out[k] = redactValue(v);
        } else {
            out[k] = v;
        }
    }
    return out;
}

function redactValue(v: string): string {
    if (!v) return '';
    if (v.length <= 12) return '***';
    return `${v.slice(0, 6)}…${v.slice(-4)} (${v.length} chars, redacted)`;
}

/** Truncate a body to keep record.json reasonable. */
export function truncateBody(body: unknown, maxBytes = 8 * 1024): unknown {
    if (body == null) return body;
    if (typeof body === 'string') {
        if (body.length <= maxBytes) return body;
        return body.slice(0, maxBytes) + `\n…[truncated, ${body.length - maxBytes} more chars]`;
    }
    if (typeof body === 'object') {
        try {
            const json = JSON.stringify(body);
            if (json.length <= maxBytes) return body;
            return json.slice(0, maxBytes) + `\n…[truncated, ${json.length - maxBytes} more chars]`;
        } catch {
            return '[unserializable]';
        }
    }
    return body;
}
