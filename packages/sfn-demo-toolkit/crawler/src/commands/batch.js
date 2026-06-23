import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatJson, writeJsonArtifact } from '../lib/artifacts.js';
import { parseArgs } from '../lib/args.js';
import { buildBatchIndexHtml } from '../lib/batch-index.js';
import { ensureDir, readTextFile, writeTextFile } from '../lib/fs.js';
import { createScrapePayload } from '../lib/scrape-pipeline.js';
import { normalizeWhitespace, slugify } from '../lib/strings.js';

export async function runBatch(argv) {
  const { positional, options } = parseArgs(argv);

  if (positional.length === 0) {
    throw new Error('Missing URLs input. Usage: webcrawler batch <urls.txt|url...> --out-dir <dir> [options]');
  }

  if (!options.outDir) {
    throw new Error('Missing --out-dir <dir>. Batch needs a target folder for the generated artifacts.');
  }

  const urls = await resolveBatchUrls(positional);
  if (urls.length === 0) {
    throw new Error('No URLs found in the provided batch input.');
  }

  const outputDir = path.resolve(process.cwd(), options.outDir);
  const pagesDir = path.join(outputDir, 'pages');
  const manifestPath = path.join(outputDir, 'manifest.json');
  const indexPath = path.join(outputDir, 'index.html');
  const seenSlugs = new Set();
  const items = [];

  await ensureDir(pagesDir);

  for (const requestedUrl of urls) {
    const slug = reserveSlug(buildUrlSlug(requestedUrl), seenSlugs);
    const pageDir = path.join(pagesDir, slug);
    const jsonPath = path.join(pageDir, 'page.json');

    try {
      const payload = await createScrapePayload({
        url: requestedUrl,
        waitFor: options.waitFor,
        onlyMainContent: options.onlyMainContent,
      });
      const { previewHtmlPath } = await writeJsonArtifact(jsonPath, payload);

      items.push({
        slug,
        status: 'ok',
        requestedUrl,
        finalUrl: payload.finalUrl,
        imageCount: payload.images.length,
        jsonPath,
        previewHtmlPath,
        relativeJsonPath: relativeTo(outputDir, jsonPath),
        relativePreviewHtmlPath: relativeTo(outputDir, previewHtmlPath),
      });
    } catch (error) {
      items.push({
        slug,
        status: 'error',
        requestedUrl,
        finalUrl: null,
        imageCount: 0,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const manifest = {
    title: `Batch run - ${new Date().toISOString().slice(0, 10)}`,
    createdAt: new Date().toISOString(),
    inputCount: urls.length,
    processedCount: items.filter((item) => item.status === 'ok').length,
    failedCount: items.filter((item) => item.status === 'error').length,
    outputDir,
    items,
  };

  await Promise.all([
    writeTextFile(manifestPath, formatJson(manifest)),
    writeTextFile(indexPath, buildBatchIndexHtml(manifest)),
  ]);

  process.stdout.write(formatJson({
    inputCount: manifest.inputCount,
    processedCount: manifest.processedCount,
    failedCount: manifest.failedCount,
    outputDir,
    manifestPath,
    indexPath,
  }));
}

async function resolveBatchUrls(values) {
  const urls = [];

  for (const value of values) {
    if (isUrlLike(value)) {
      urls.push(value);
      continue;
    }

    const filePath = path.resolve(process.cwd(), value);
    await assertFileExists(filePath);
    const source = await readTextFile(filePath);

    source
      .split(/\r?\n/)
      .map((line) => normalizeWhitespace(line))
      .filter((line) => line && !line.startsWith('#'))
      .forEach((line) => {
        if (!isUrlLike(line)) {
          throw new Error(`Invalid URL in batch input file "${filePath}": ${line}`);
        }

        urls.push(line);
      });
  }

  return urls;
}

async function assertFileExists(filePath) {
  try {
    const current = await stat(filePath);
    if (!current.isFile()) {
      throw new Error(`Batch input "${filePath}" is not a file.`);
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Batch input')) {
      throw error;
    }

    throw new Error(`Batch input file not found: ${filePath}`);
  }
}

function isUrlLike(value) {
  return /^https?:\/\//i.test(value) || /^file:\/\//i.test(value);
}

function buildUrlSlug(value) {
  try {
    const url = new URL(value);
    if (url.protocol === 'file:') {
      const filePath = fileURLToPath(url);
      return slugify(path.basename(filePath, path.extname(filePath)) || 'page');
    }

    return slugify(`${url.hostname.replace(/^www\./i, '')} ${url.pathname}`);
  } catch {
    return slugify(value || 'page');
  }
}

function reserveSlug(baseSlug, seenSlugs) {
  const base = baseSlug || 'page';
  let candidate = base;
  let index = 2;

  while (seenSlugs.has(candidate)) {
    candidate = `${base}-${index}`;
    index += 1;
  }

  seenSlugs.add(candidate);
  return candidate;
}

function relativeTo(fromPath, targetPath) {
  return path.relative(fromPath, targetPath).split(path.sep).join('/');
}
