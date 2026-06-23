/**
 * Version drift audit for sfn-demo-toolkit.
 *
 * Inspects a target SFN repo and reports whether the toolkit's patch bundle
 * for the matching SFN version applies cleanly. Returns:
 *   { ok: boolean, runtimeVersion, manifestVersion, anchors: [{path, op, found, reason}] }
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

export function readRuntimeVersion(targetRepo) {
    const pkgPath = resolve(targetRepo, 'package.json');
    if (!existsSync(pkgPath)) {
        throw new Error(`Target is not a Node project (no package.json): ${targetRepo}`);
    }
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    const v = deps['@salesforce/storefront-next-runtime'];
    if (!v) {
        throw new Error('Target does not depend on @salesforce/storefront-next-runtime — is this a SFN project?');
    }
    return v.replace(/^[\^~]/, '');
}

export function isVersionSupported(runtimeVersion, supportedList) {
    if (supportedList.includes(runtimeVersion)) return true;
    const major = runtimeVersion.split('.').slice(0, 2).join('.');
    return supportedList.some((v) => v.startsWith(`${major}.`));
}

export function auditAnchors(targetRepo, manifest) {
    const results = [];
    for (const patch of manifest.patchedFiles ?? []) {
        const filePath = resolve(targetRepo, patch.path);
        if (!existsSync(filePath)) {
            results.push({ path: patch.path, op: patch.op, found: false, reason: 'file does not exist' });
            continue;
        }
        const content = readFileSync(filePath, 'utf8');

        if (patch.op === 'merge-json') {
            try {
                JSON.parse(content);
                results.push({ path: patch.path, op: patch.op, found: true });
            } catch (e) {
                results.push({ path: patch.path, op: patch.op, found: false, reason: `not valid JSON: ${e.message}` });
            }
            continue;
        }

        if (patch.op === 'append-if-missing') {
            results.push({ path: patch.path, op: patch.op, found: true });
            continue;
        }

        if (patch.op === 'wrap-anchor-block') {
            const open = new RegExp(patch.openAnchor);
            const close = new RegExp(patch.closeAnchor);
            const openMatch = content.match(open);
            const closeMatch = content.match(close);
            if (!openMatch) {
                results.push({ path: patch.path, op: patch.op, found: false, reason: `openAnchor not found: ${patch.openAnchor}` });
            } else if (!closeMatch) {
                results.push({ path: patch.path, op: patch.op, found: false, reason: `closeAnchor not found: ${patch.closeAnchor}` });
            } else {
                results.push({ path: patch.path, op: patch.op, found: true });
            }
            continue;
        }

        const anchor = patch.anchor;
        if (!anchor) {
            results.push({ path: patch.path, op: patch.op, found: false, reason: 'anchor missing in manifest' });
            continue;
        }
        const re = new RegExp(anchor);
        const match = content.match(re);
        if (!match) {
            results.push({ path: patch.path, op: patch.op, found: false, reason: `anchor not found: ${anchor}` });
        } else {
            results.push({ path: patch.path, op: patch.op, found: true });
        }
    }
    return results;
}

export function summarizeAudit(results) {
    const failed = results.filter((r) => !r.found);
    return { ok: failed.length === 0, total: results.length, failed: failed.length, results };
}
