/**
 * Clean brand pipeline for sfn-demo-toolkit.
 *
 * Replaces the legacy brand-pipeline.js that depended on templates.js and
 * apply-branding.js. Produces:
 *   - analysis.json (full crawler output, source of truth)
 *   - preview.html (interactive review UI)
 *   - brand-content.ts (ready to drop in clients/<id>/content.ts)
 *   - theme.css (ready to drop in clients/<id>/theme.css)
 *   - profile.env (ready to drop in .env.profiles/<id>.env)
 *   - page.html / page.md (raw scrape)
 *
 * Apply step (F4) reads these and copies them into the target SFN repo.
 */
import path from 'node:path';
import { writeJsonArtifact, formatJson } from './artifacts.js';
import { ensureDir, writeTextFile } from './fs.js';
import {
    collectImageCandidates,
    collectInlineStyles,
    collectStylesheetUrls,
    extractDocumentMetadata,
    getContentRoot,
    htmlToMarkdown,
    loadDocument,
} from './dom.js';
import { fetchPage } from './fetch-page.js';
import { extractBrandTokens, mergeBrandTokenOverrides } from './colors.js';
import { selectFromScrapePayload } from './select-from-json.js';
import { buildPreviewHtml, buildPreviewOutputPath } from './preview.js';
import { ensureOverridesFile } from './overrides.js';
import {
    buildBrandContent,
    renderBrandContentModule,
    renderThemeCss,
    renderEnvProfile,
} from './sfn-content-builder.js';

export async function runBrandPipeline(options) {
    const page = await fetchPage(options.url, { waitFor: options.waitFor });
    const $ = loadDocument(page.html, page.finalUrl);
    const onlyMainContent = options.onlyMainContent === undefined ? false : Boolean(options.onlyMainContent);
    const root = getContentRoot($, onlyMainContent);

    const images = collectImageCandidates($, page.finalUrl, onlyMainContent);
    const metadata = extractDocumentMetadata($);
    const stylesheetUrls = collectStylesheetUrls($, page.finalUrl);
    const inlineStyles = collectInlineStyles($);
    const markdown = htmlToMarkdown($, root);

    const payload = {
        requestedUrl: page.requestedUrl,
        finalUrl: page.finalUrl,
        html: onlyMainContent ? root.html() || '' : page.html,
        markdown,
        images,
        metadata,
    };

    const outputDir =
        options.outDir || path.join(process.cwd(), '.sfn-toolkit', 'brand', options.clientId || 'brand');
    await ensureDir(outputDir);
    await ensureOverridesFile(path.join(outputDir, 'overrides.json'));

    await writeTextFile(path.join(outputDir, 'page.json'), formatJson(payload));

    const extractedTokens = await extractBrandTokens($, page.finalUrl, stylesheetUrls, inlineStyles);
    const tokens = mergeBrandTokenOverrides(extractedTokens, options.overrides?.tokens);

    const result = selectFromScrapePayload(payload, {
        brandId: options.clientId,
        displayName: options.displayName,
        overrides: options.overrides,
    });

    const analysis = {
        brandId: result.brandId,
        displayName: result.displayName,
        source: result.source,
        rendererSummary: {
            renderer: page.renderer,
            htmlLength: page.html.length,
            stylesheetCount: stylesheetUrls.length,
            imageCandidateCount: result.imageCandidateCount,
            imageFamilyCount: result.familyCount,
        },
        images: {
            logo: result.selections.logo?.url || null,
        },
        tokens,
        content: result.content,
        selections: result.selections,
        slotAssignments: result.slotAssignments,
        candidates: {
            images: payload.images,
            families: result.families,
        },
    };

    const analysisJsonPath = path.join(outputDir, 'analysis.json');
    const previewHtmlPath = buildPreviewOutputPath(analysisJsonPath);

    const brandContent = buildBrandContent(analysis);
    const brandContentTs = renderBrandContentModule(brandContent);
    const themeCss = renderThemeCss(brandContent.id, tokens);
    const envProfile = renderEnvProfile(brandContent.id, { siteId: options.siteId });

    await Promise.all([
        writeTextFile(path.join(outputDir, 'page.html'), page.html),
        writeTextFile(path.join(outputDir, 'page.md'), `${markdown}\n`),
        writeTextFile(analysisJsonPath, formatJson(analysis)),
        writeTextFile(previewHtmlPath, buildPreviewHtml(analysis)),
        writeTextFile(path.join(outputDir, 'brand-content.ts'), brandContentTs),
        writeTextFile(path.join(outputDir, 'theme.css'), themeCss),
        writeTextFile(path.join(outputDir, 'profile.env'), envProfile),
        writeTextFile(path.join(outputDir, 'brand-content.json'), formatJson(brandContent)),
    ]);

    return {
        analysis,
        brandContent,
        outputDir,
        previewHtmlPath,
    };
}
