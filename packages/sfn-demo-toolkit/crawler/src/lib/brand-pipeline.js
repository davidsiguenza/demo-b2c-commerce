import path from 'node:path';
import { writeJsonArtifact } from './artifacts.js';
import { analyzeBrand } from './brand-analyzer.js';
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
import { ensureDir, writeTextFile } from './fs.js';
import { selectFromScrapePayload } from './select-from-json.js';
import { buildPreviewHtml, buildPreviewOutputPath } from './preview.js';
import { buildCssBlock, buildEnvSnippet, buildPresetEntry, buildReport } from './templates.js';
import { extractBrandTokens, mergeBrandTokenOverrides } from './colors.js';
import { formatJson } from './artifacts.js';
import { ensureOverridesFile } from './overrides.js';

export async function generateBrandArtifacts(options) {
  const page = await fetchPage(options.url, {
    waitFor: options.waitFor,
  });
  const $ = loadDocument(page.html, page.finalUrl);
  const onlyMainContent =
    options.onlyMainContent === undefined ? true : Boolean(options.onlyMainContent);
  const analysis = await analyzeBrand({
    $,
    pageUrl: page.finalUrl,
    requestedUrl: page.requestedUrl,
    html: page.html,
    onlyMainContent,
    brandId: options.brandId,
    displayName: options.displayName,
  });
  const outputDir =
    options.outDir || path.join(process.cwd(), '.webcrawler', analysis.brandId);
  const root = getContentRoot($, onlyMainContent);
  const analysisJsonPath = path.join(outputDir, 'analysis.json');

  await ensureDir(outputDir);
  const analysisArtifactPromise = writeJsonArtifact(analysisJsonPath, analysis);
  await Promise.all([
    writeTextFile(path.join(outputDir, 'page.html'), page.html),
    writeTextFile(path.join(outputDir, 'page.md'), `${htmlToMarkdown($, root)}\n`),
    analysisArtifactPromise,
    writeTextFile(path.join(outputDir, 'branding-preset.snippet.ts'), `${buildPresetEntry(analysis)}\n`),
    writeTextFile(path.join(outputDir, 'brand-tokens.css'), `${buildCssBlock(analysis)}\n`),
    writeTextFile(path.join(outputDir, 'env.txt'), `${buildEnvSnippet(analysis)}\n`),
    writeTextFile(path.join(outputDir, 'report.md'), buildReport(analysis)),
  ]);
  const { previewHtmlPath } = await analysisArtifactPromise;

  return {
    analysis,
    outputDir,
    previewHtmlPath,
  };
}

/**
 * Scrape-first flow: fetch page → build full JSON (all images + text) → select 7 distinct
 * slots by family (dedupe formats) and aspect-ratio/keyword scoring → apply branding.
 * Use this for workflows so each slot gets a different image and texts.
 */
export async function generateBrandArtifactsFromScrape(options) {
  const page = await fetchPage(options.url, {
    waitFor: options.waitFor,
  });
  const $ = loadDocument(page.html, page.finalUrl);
  const onlyMainContent =
    options.onlyMainContent === undefined ? true : Boolean(options.onlyMainContent);
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
    options.outDir || path.join(process.cwd(), '.webcrawler', options.brandId || 'brand');
  await ensureDir(outputDir);
  await ensureOverridesFile(path.join(outputDir, 'overrides.json'));

  const pageJsonPath = path.join(outputDir, 'page.json');
  await writeTextFile(pageJsonPath, formatJson(payload));

  const extractedTokens = await extractBrandTokens($, page.finalUrl, stylesheetUrls, inlineStyles);
  const tokens = mergeBrandTokenOverrides(extractedTokens, options.overrides?.tokens);
  const result = selectFromScrapePayload(payload, {
    brandId: options.brandId,
    displayName: options.displayName,
    overrides: options.overrides,
  });

  const analysis = {
    brandId: result.brandId,
    displayName: result.displayName,
    source: result.source,
    rendererSummary: {
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

  await Promise.all([
    writeTextFile(path.join(outputDir, 'page.html'), page.html),
    writeTextFile(path.join(outputDir, 'page.md'), `${markdown}\n`),
    writeTextFile(analysisJsonPath, formatJson(analysis)),
    writeTextFile(previewHtmlPath, buildPreviewHtml(analysis)),
    writeTextFile(path.join(outputDir, 'branding-preset.snippet.ts'), `${buildPresetEntry(analysis)}\n`),
    writeTextFile(path.join(outputDir, 'brand-tokens.css'), `${buildCssBlock(analysis)}\n`),
    writeTextFile(path.join(outputDir, 'env.txt'), `${buildEnvSnippet(analysis)}\n`),
    writeTextFile(path.join(outputDir, 'report.md'), buildReport(analysis)),
  ]);

  return {
    analysis,
    outputDir,
    previewHtmlPath,
  };
}
