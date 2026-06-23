import { runBatch } from './commands/batch.js';
import { runBrand } from './commands/brand.js';
import { runScrape } from './commands/scrape.js';
import { runWorkflow } from './commands/workflow.js';

const HELP = `webcrawler

Usage:
  webcrawler scrape <url> [options]
  webcrawler batch <urls.txt|url...> [options]
  webcrawler brand <url> [options]
  webcrawler workflow <url> [options]

Commands:
  scrape   Crawl one page and output html, markdown or json. If json is saved to disk, a preview html is generated too.
  batch    Crawl multiple URLs and write one json/preview pair per page plus a batch manifest and index.
  brand    Analyze one storefront homepage and generate json for agents plus preview html for humans.
  workflow Run brand, write artifacts to disk and optionally apply/build/push a storefront project.

Common options:
  -o, --output <file>       Scrape only. Output file (.html, .md, .json)
      --out-dir <dir>       Batch/brand/workflow. Output directory for generated artifacts
      --format <value>      html | markdown | json
      --wait-for <ms>       Wait time kept for Firecrawl CLI parity
      --only-main-content   Restrict markdown/json extraction to the main content

Brand options:
      --brand-id <id>       Stable id used in branding-presets.ts and data-brand
      --display-name <name> Optional display name override
      --apply-to <path>     Optional storefront project path to patch automatically
      --overrides <file>    Optional overrides.json file generated from preview.html
      --replace             Replace existing brand blocks in target files

Workflow options:
      --apply-to <path>       Required. Storefront project path to patch automatically
      --overrides <file>      Optional overrides.json file generated from preview.html
      --typecheck             Run package-manager typecheck after patching
      --build                 Run package-manager build after patching
      --push                  Run package-manager push after a successful build
      --package-manager <pm>  pnpm | npm | yarn (default: pnpm)

Examples:
  webcrawler scrape "https://www.example.com" --format json -o ./outputs/example.json
  webcrawler batch ./urls.txt --out-dir ./outputs/batch
  webcrawler scrape "https://www.example.com" --format markdown --only-main-content -o .webcrawler/example-home.md
  webcrawler brand "https://www.example.com" --brand-id mybrand --out-dir .webcrawler/mybrand
  webcrawler brand "https://www.example.com" --brand-id mybrand --out-dir .webcrawler/mybrand --overrides .webcrawler/mybrand/overrides.json
  webcrawler brand "https://www.example.com" --brand-id mybrand --apply-to /path/to/storefront
  webcrawler workflow "https://www.example.com" --brand-id mybrand --apply-to /path/to/storefront --typecheck --build --overrides .webcrawler/mybrand/overrides.json
`;

export async function main(argv) {
  const [command, ...rest] = argv;

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    process.stdout.write(`${HELP}\n`);
    return;
  }

  if (command === 'scrape') {
    await runScrape(rest);
    return;
  }

  if (command === 'batch') {
    await runBatch(rest);
    return;
  }

  if (command === 'brand') {
    await runBrand(rest);
    return;
  }

  if (command === 'workflow') {
    await runWorkflow(rest);
    return;
  }

  throw new Error(`Unknown command "${command}".\n\n${HELP}`);
}
