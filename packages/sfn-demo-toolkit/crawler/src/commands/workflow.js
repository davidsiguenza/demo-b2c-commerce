import { applyBranding } from '../lib/apply-branding.js';
import { formatJson } from '../lib/artifacts.js';
import { parseArgs } from '../lib/args.js';
import { generateBrandArtifactsFromScrape } from '../lib/brand-pipeline.js';
import { loadOverridesFile } from '../lib/overrides.js';
import { runCommand } from '../lib/run-command.js';

export async function runWorkflow(argv) {
  const { positional, options } = parseArgs(argv);
  const [url] = positional;

  if (!url) {
    throw new Error('Missing URL. Usage: webcrawler workflow <url> --apply-to <path> [options]');
  }

  if (!options.applyTo) {
    throw new Error('Missing --apply-to <path>. The workflow needs a target storefront project.');
  }

  const packageManager = options.packageManager || 'pnpm';
  const shouldTypecheck = Boolean(options.typecheck);
  const shouldBuild = Boolean(options.build);
  const shouldPush = Boolean(options.push);
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

  await applyBranding(analysis, options.applyTo, {
    replace: Boolean(options.replace),
  });

  const steps = [];

  if (shouldTypecheck) {
    steps.push(['typecheck']);
  }

  if (shouldBuild) {
    steps.push(['build']);
  }

  if (shouldPush) {
    steps.push(['push']);
  }

  for (const [scriptName] of steps) {
    await runCommand(packageManager, ['run', scriptName], {
      cwd: options.applyTo,
    });
  }

  process.stdout.write(formatJson({
    brandId: analysis.brandId,
    displayName: analysis.displayName,
    outputDir,
    previewHtml: previewHtmlPath,
    appliedTo: options.applyTo,
    ranSteps: steps.map(([scriptName]) => scriptName),
  }));
}
