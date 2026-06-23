export function buildBatchIndexHtml(manifest) {
  const successCount = manifest.items.filter((item) => item.status === 'ok').length;
  const failureCount = manifest.items.length - successCount;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(manifest.title || 'WebCrawler Batch')}</title>
    <style>
      :root {
        --bg: #f6f1e8;
        --panel: #fffaf4;
        --text: #211d17;
        --muted: #6d6256;
        --line: rgba(61, 49, 35, 0.12);
        --accent: #a24d2b;
        --ok: #1d7a4c;
        --error: #b43b2d;
        --shadow: 0 18px 48px rgba(29, 19, 10, 0.1);
        --radius: 22px;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-height: 100vh;
        background:
          radial-gradient(circle at top left, rgba(162, 77, 43, 0.14), transparent 32%),
          linear-gradient(180deg, #fcf7f0 0%, #f2ecdf 100%);
        color: var(--text);
        font-family: "Avenir Next", "Segoe UI", sans-serif;
      }

      a {
        color: inherit;
      }

      .shell {
        width: min(1200px, calc(100vw - 32px));
        margin: 0 auto;
        padding: 28px 0 64px;
      }

      .hero,
      .card {
        background: rgba(255, 250, 244, 0.9);
        border: 1px solid rgba(255, 255, 255, 0.7);
        border-radius: 28px;
        box-shadow: var(--shadow);
      }

      .hero {
        display: grid;
        gap: 20px;
        padding: 28px;
      }

      .eyebrow {
        display: inline-flex;
        align-items: center;
        padding: 8px 12px;
        border-radius: 999px;
        background: rgba(162, 77, 43, 0.1);
        color: var(--accent);
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      h1,
      h2 {
        margin: 0;
        font-family: "Iowan Old Style", "Palatino Linotype", serif;
      }

      h1 {
        font-size: clamp(2.2rem, 4vw, 4rem);
        line-height: 1.04;
      }

      .subtitle {
        margin: 0;
        max-width: 72ch;
        color: var(--muted);
        line-height: 1.6;
      }

      .summary {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 12px;
      }

      .summary-item {
        padding: 14px 16px;
        border-radius: 18px;
        background: rgba(255, 255, 255, 0.72);
        border: 1px solid var(--line);
      }

      .summary-item strong {
        display: block;
        margin-bottom: 6px;
        font-size: 1.3rem;
      }

      .summary-item span {
        color: var(--muted);
      }

      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
        gap: 18px;
        margin-top: 24px;
      }

      .card {
        display: grid;
        gap: 16px;
        padding: 20px;
      }

      .status {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        width: fit-content;
        min-height: 30px;
        padding: 0 12px;
        border-radius: 999px;
        font-size: 0.82rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
      }

      .status-ok {
        background: rgba(29, 122, 76, 0.12);
        color: var(--ok);
      }

      .status-error {
        background: rgba(180, 59, 45, 0.12);
        color: var(--error);
      }

      .meta {
        display: grid;
        gap: 8px;
        margin: 0;
      }

      .meta-row {
        display: grid;
        grid-template-columns: 88px 1fr;
        gap: 10px;
      }

      .meta-row dt {
        margin: 0;
        color: var(--muted);
        font-size: 0.82rem;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }

      .meta-row dd {
        margin: 0;
        word-break: break-word;
        line-height: 1.5;
      }

      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
      }

      .button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 42px;
        padding: 0 16px;
        border-radius: 999px;
        border: 0;
        background: #1d2430;
        color: #fff;
        text-decoration: none;
      }

      .button-secondary {
        background: transparent;
        border: 1px solid var(--line);
        color: var(--text);
      }

      @media (max-width: 720px) {
        .shell {
          width: min(100vw - 20px, 100%);
          padding-top: 18px;
        }

        .hero,
        .card {
          padding: 18px;
          border-radius: 22px;
        }

        .meta-row {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <main class="shell">
      <section class="hero">
        <span class="eyebrow">Batch crawl</span>
        <h1>${escapeHtml(manifest.title || 'WebCrawler Batch')}</h1>
        <p class="subtitle">Aggregate index for reviewing a batch of URLs. Each card links to the machine-readable JSON output and the human-readable HTML preview.</p>
        <div class="summary">
          <div class="summary-item">
            <strong>${escapeHtml(String(manifest.inputCount || 0))}</strong>
            <span>Input URLs</span>
          </div>
          <div class="summary-item">
            <strong>${escapeHtml(String(successCount))}</strong>
            <span>Processed successfully</span>
          </div>
          <div class="summary-item">
            <strong>${escapeHtml(String(failureCount))}</strong>
            <span>Failed</span>
          </div>
        </div>
      </section>

      <section class="grid">
        ${manifest.items.map(renderItem).join('\n')}
      </section>
    </main>
  </body>
</html>
`;
}

function renderItem(item) {
  const statusClass = item.status === 'ok' ? 'status status-ok' : 'status status-error';
  const actions = item.status === 'ok'
    ? `<div class="actions">
        <a class="button" href="${escapeAttribute(item.relativePreviewHtmlPath)}">Open preview</a>
        <a class="button button-secondary" href="${escapeAttribute(item.relativeJsonPath)}">Open JSON</a>
      </div>`
    : '';

  return `<article class="card">
    <span class="${statusClass}">${escapeHtml(item.status)}</span>
    <div>
      <h2>${escapeHtml(item.slug)}</h2>
    </div>
    <dl class="meta">
      <div class="meta-row">
        <dt>URL</dt>
        <dd>${escapeHtml(item.requestedUrl)}</dd>
      </div>
      <div class="meta-row">
        <dt>Final</dt>
        <dd>${escapeHtml(item.finalUrl || 'n/a')}</dd>
      </div>
      <div class="meta-row">
        <dt>Images</dt>
        <dd>${escapeHtml(String(item.imageCount || 0))}</dd>
      </div>
      ${item.error ? `<div class="meta-row"><dt>Error</dt><dd>${escapeHtml(item.error)}</dd></div>` : ''}
    </dl>
    ${actions}
  </article>`;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttribute(value) {
  return escapeHtml(value);
}
