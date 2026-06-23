import { formatJson } from '../lib/artifacts.js';
import { parseArgs } from '../lib/args.js';
import { applyBranding } from '../lib/apply-branding.js';
import { generateBrandArtifactsFromScrape } from '../lib/brand-pipeline.js';
import { loadOverridesFile } from '../lib/overrides.js';

export async function runBrand(argv) {
  const { positional, options } = parseArgs(argv);
  const [url] = positional;

  if (!url) {
    throw new Error('Missing URL. Usage: webcrawler brand <url> [options]');
  }

  const overrides = await loadOverridesFile(options.overrides);

  const { analysis, outputDir, previewHtmlPath } = await generateBrandArtifactsFromScrape({
    url,
    waitFor: options.waitFor,
    onlyMainContent: options.onlyMainContent,
    brandId: options.brandId,
    displayName: options.displayName,
    outDir: options.outDir,
    overrides,
  });

  if (options.applyTo) {
    await applyBranding(analysis, options.applyTo, {
      replace: Boolean(options.replace),
    });
  }

  process.stdout.write(formatJson({
    brandId: analysis.brandId,
    displayName: analysis.displayName,
    outputDir,
    previewHtml: previewHtmlPath,
    appliedTo: options.applyTo || null,
  }));
}
