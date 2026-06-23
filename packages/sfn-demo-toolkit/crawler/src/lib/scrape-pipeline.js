import { fetchPage } from './fetch-page.js';
import { collectImageCandidates, getContentRoot, htmlToMarkdown, loadDocument } from './dom.js';

export async function createScrapePayload(options) {
  const onlyMainContent = Boolean(options.onlyMainContent);
  const page = await fetchPage(options.url, {
    waitFor: options.waitFor,
  });
  const $ = loadDocument(page.html, page.finalUrl);
  const root = getContentRoot($, onlyMainContent);
  const images = collectImageCandidates($, page.finalUrl, onlyMainContent);

  return {
    requestedUrl: page.requestedUrl,
    finalUrl: page.finalUrl,
    html: onlyMainContent ? root.html() || '' : page.html,
    markdown: htmlToMarkdown($, root),
    images,
  };
}
