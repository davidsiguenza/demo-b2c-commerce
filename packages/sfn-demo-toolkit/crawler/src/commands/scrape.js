import { formatJson, writeJsonArtifact } from '../lib/artifacts.js';
import { writeTextFile } from '../lib/fs.js';
import { parseArgs } from '../lib/args.js';
import { createScrapePayload } from '../lib/scrape-pipeline.js';

export async function runScrape(argv) {
  const { positional, options } = parseArgs(argv);
  const [url] = positional;

  if (!url) {
    throw new Error('Missing URL. Usage: webcrawler scrape <url> [options]');
  }

  const format = options.format || 'markdown';
  const jsonPayload = await createScrapePayload({
    url,
    waitFor: options.waitFor,
    onlyMainContent: options.onlyMainContent,
  });

  let output = '';
  if (format === 'html') {
    output = jsonPayload.html;
  } else if (format === 'markdown') {
    output = `${jsonPayload.markdown}\n`;
  } else if (format === 'json') {
    output = formatJson(jsonPayload);
  } else {
    throw new Error(`Unsupported format "${format}". Use html, markdown or json.`);
  }

  if (options.output) {
    if (format === 'json') {
      await writeJsonArtifact(options.output, jsonPayload);
    } else {
      await writeTextFile(options.output, output);
    }
    process.stdout.write(`${options.output}\n`);
    return;
  }

  process.stdout.write(output);
}
