/**
 * Apply a v0.X patch manifest onto a target SFN repo.
 *
 * Operations supported:
 *   - merge-json: deep-merge `merge` object into target JSON file
 *   - insert-after-anchor: insert text after the first regex anchor match
 *   - replace-anchor: replace anchor regex match with `replacement`
 *   - wrap-anchor-block: insert openInsert before openAnchor, closeInsert after closeAnchor
 *   - append-if-missing: append text if `marker` substring is not already present
 *   - addedDirs / addedFiles: copy from patches dir into target
 */
import {
    readFileSync,
    writeFileSync,
    existsSync,
    mkdirSync,
    cpSync,
    chmodSync,
    statSync,
} from 'node:fs';
import { resolve, dirname } from 'node:path';

function deepMerge(target, source) {
    if (Array.isArray(source)) return source;
    if (source && typeof source === 'object') {
        const out = { ...(target && typeof target === 'object' ? target : {}) };
        for (const k of Object.keys(source)) {
            out[k] = deepMerge(out[k], source[k]);
        }
        return out;
    }
    return source;
}

function ensureDir(filePath) {
    const dir = dirname(filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function applyPatchedFile(targetRepo, patch) {
    const filePath = resolve(targetRepo, patch.path);

    if (patch.op === 'merge-json') {
        const original = JSON.parse(readFileSync(filePath, 'utf8'));
        const merged = deepMerge(original, patch.merge);
        writeFileSync(filePath, `${JSON.stringify(merged, null, 4)}\n`);
        return { applied: true };
    }

    const content = readFileSync(filePath, 'utf8');

    if (patch.op === 'append-if-missing') {
        if (content.includes(patch.marker)) return { applied: false, reason: 'already present' };
        writeFileSync(filePath, content + patch.append);
        return { applied: true };
    }

    if (patch.op === 'insert-after-anchor') {
        const re = new RegExp(patch.anchor);
        if (!re.test(content)) throw new Error(`anchor not found in ${patch.path}: ${patch.anchor}`);
        if (content.includes(patch.insert)) return { applied: false, reason: 'insert already present' };
        const next = content.replace(re, (m) => `${m}${patch.insert}`);
        writeFileSync(filePath, next);
        return { applied: true };
    }

    if (patch.op === 'replace-anchor') {
        const flags = patch.all ? 'g' : '';
        const re = new RegExp(patch.anchor, flags);
        if (!re.test(content)) {
            // idempotent: maybe already replaced
            if (content.includes(patch.replacement)) return { applied: false, reason: 'replacement already present' };
            throw new Error(`anchor not found in ${patch.path}: ${patch.anchor}`);
        }
        // RegExp lastIndex resets on a fresh regex, but be safe.
        const reForReplace = new RegExp(patch.anchor, flags);
        const next = content.replace(reForReplace, () => patch.replacement);
        writeFileSync(filePath, next);
        return { applied: true };
    }

    if (patch.op === 'wrap-anchor-block') {
        const openRe = new RegExp(patch.openAnchor);
        const closeRe = new RegExp(patch.closeAnchor);
        const openMatch = content.match(openRe);
        if (!openMatch) throw new Error(`openAnchor not found in ${patch.path}: ${patch.openAnchor}`);
        const afterOpen = content.slice(openMatch.index + openMatch[0].length);
        const closeMatch = afterOpen.match(closeRe);
        if (!closeMatch) throw new Error(`closeAnchor not found after openAnchor in ${patch.path}`);
        const closeAbsoluteIndex = openMatch.index + openMatch[0].length + closeMatch.index + closeMatch[0].length;
        const before = content.slice(0, openMatch.index);
        const matched = content.slice(openMatch.index, closeAbsoluteIndex);
        const after = content.slice(closeAbsoluteIndex);
        const wrapped = `${patch.openInsert}${matched}${patch.closeInsert}`;
        writeFileSync(filePath, `${before}${wrapped}${after}`);
        return { applied: true };
    }

    throw new Error(`unknown op: ${patch.op}`);
}

export function applyAddedDirs(patchesRoot, targetRepo, addedDirs) {
    const out = [];
    for (const entry of addedDirs ?? []) {
        const from = resolve(patchesRoot, entry.from);
        const to = resolve(targetRepo, entry.to);
        ensureDir(to);
        cpSync(from, to, { recursive: true, force: true });
        out.push({ from: entry.from, to: entry.to });
    }
    return out;
}

export function applyAddedFiles(patchesRoot, targetRepo, addedFiles) {
    const out = [];
    for (const entry of addedFiles ?? []) {
        const from = resolve(patchesRoot, entry.from);
        const to = resolve(targetRepo, entry.to);
        ensureDir(to);
        cpSync(from, to);
        if (entry.mode) {
            chmodSync(to, parseInt(entry.mode, 8));
        }
        out.push({ from: entry.from, to: entry.to });
    }
    return out;
}

export function applyManifest(patchesRoot, targetRepo, manifest) {
    const log = { addedDirs: [], addedFiles: [], patchedFiles: [] };
    log.addedDirs = applyAddedDirs(patchesRoot, targetRepo, manifest.addedDirs);
    log.addedFiles = applyAddedFiles(patchesRoot, targetRepo, manifest.addedFiles);
    for (const patch of manifest.patchedFiles ?? []) {
        const result = applyPatchedFile(targetRepo, patch);
        log.patchedFiles.push({ ...patch, result });
    }
    return log;
}
