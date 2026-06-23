import path from 'node:path';
import { buildBrandPreviewHtml } from './brand-preview.js';
import { normalizeWhitespace, truncate } from './strings.js';

export function buildPreviewHtml(payload) {
  if (isBrandAnalysis(payload)) {
    return buildBrandPreviewHtml(payload);
  }

  const model = normalizePayload(payload);
  const sectionsHtml = model.sections.map(renderSection).join('\n');
  const metaHtml = model.meta.map(renderMetaItem).join('\n');
  const tokenHtml = model.tokens.length > 0 ? renderTokenSection(model.tokens) : '';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(model.title)}</title>
    <style>
      :root {
        --bg: #f4efe6;
        --panel: rgba(255, 251, 245, 0.86);
        --panel-strong: #fffaf3;
        --panel-contrast: #1f2430;
        --text: #25211a;
        --muted: #6d6255;
        --line: rgba(74, 61, 46, 0.12);
        --accent: #b5532f;
        --accent-strong: #8d3d20;
        --accent-soft: rgba(181, 83, 47, 0.12);
        --success: #1f7a4c;
        --shadow: 0 24px 64px rgba(40, 27, 16, 0.14);
        --radius-xl: 28px;
        --radius-lg: 20px;
        --radius-md: 14px;
        --radius-sm: 999px;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-height: 100vh;
        background:
          radial-gradient(circle at top left, rgba(181, 83, 47, 0.18), transparent 34%),
          radial-gradient(circle at top right, rgba(33, 114, 104, 0.14), transparent 24%),
          linear-gradient(180deg, #fbf6ee 0%, #f0eadf 100%);
        color: var(--text);
        font-family: "Avenir Next", "Segoe UI", sans-serif;
      }

      img {
        display: block;
        max-width: 100%;
      }

      button,
      a {
        font: inherit;
      }

      .shell {
        width: min(1380px, calc(100vw - 32px));
        margin: 0 auto;
        padding: 32px 0 64px;
      }

      .hero {
        display: grid;
        grid-template-columns: minmax(0, 1.4fr) minmax(300px, 0.8fr);
        gap: 20px;
        margin-bottom: 28px;
      }

      .hero-card,
      .meta-card,
      .section-card,
      .status-bar {
        background: var(--panel);
        backdrop-filter: blur(16px);
        border: 1px solid rgba(255, 255, 255, 0.55);
        box-shadow: var(--shadow);
      }

      .hero-card {
        position: relative;
        overflow: hidden;
        padding: 28px;
        border-radius: var(--radius-xl);
      }

      .hero-card::before {
        content: "";
        position: absolute;
        inset: auto -80px -120px auto;
        width: 260px;
        height: 260px;
        border-radius: 50%;
        background: radial-gradient(circle, rgba(181, 83, 47, 0.24), transparent 68%);
        pointer-events: none;
      }

      .eyebrow {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        border-radius: var(--radius-sm);
        background: rgba(255, 255, 255, 0.72);
        color: var(--accent-strong);
        letter-spacing: 0.08em;
        text-transform: uppercase;
        font-size: 12px;
        font-weight: 700;
      }

      h1,
      h2,
      h3 {
        margin: 0;
        font-family: "Iowan Old Style", "Palatino Linotype", serif;
        line-height: 1.02;
      }

      h1 {
        margin-top: 18px;
        font-size: clamp(2.4rem, 4vw, 4.4rem);
        max-width: 12ch;
      }

      .hero-copy {
        max-width: 62ch;
        margin-top: 16px;
        color: var(--muted);
        font-size: 1.02rem;
        line-height: 1.65;
      }

      .hero-note {
        display: grid;
        gap: 8px;
        margin-top: 20px;
        padding: 16px 18px;
        border-radius: var(--radius-lg);
        background: rgba(255, 255, 255, 0.72);
        border: 1px solid rgba(74, 61, 46, 0.08);
      }

      .hero-note strong {
        font-size: 0.95rem;
      }

      .hero-note span {
        color: var(--muted);
        line-height: 1.5;
      }

      .meta-card {
        display: grid;
        gap: 16px;
        align-content: start;
        padding: 24px;
        border-radius: var(--radius-xl);
      }

      .meta-grid {
        display: grid;
        gap: 12px;
      }

      .meta-item {
        padding: 14px 16px;
        border-radius: var(--radius-md);
        background: rgba(255, 255, 255, 0.72);
        border: 1px solid var(--line);
      }

      .meta-item dt {
        margin: 0 0 6px;
        color: var(--muted);
        font-size: 0.8rem;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }

      .meta-item dd {
        margin: 0;
        color: var(--text);
        font-size: 0.96rem;
        line-height: 1.45;
        word-break: break-word;
      }

      .token-grid {
        display: grid;
        gap: 10px;
      }

      .token-row {
        display: grid;
        grid-template-columns: auto 1fr auto;
        gap: 12px;
        align-items: center;
        padding: 12px 14px;
        border-radius: var(--radius-md);
        background: rgba(255, 255, 255, 0.72);
        border: 1px solid var(--line);
      }

      .token-swatch {
        width: 20px;
        height: 20px;
        border-radius: 50%;
        border: 1px solid rgba(0, 0, 0, 0.14);
      }

      .status-bar {
        position: sticky;
        top: 18px;
        z-index: 5;
        display: flex;
        gap: 12px;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 24px;
        padding: 14px 18px;
        border-radius: var(--radius-lg);
      }

      .status-copy {
        display: flex;
        gap: 10px;
        align-items: center;
        color: var(--muted);
      }

      .count-pill {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 36px;
        height: 36px;
        padding: 0 12px;
        border-radius: var(--radius-sm);
        background: var(--accent-soft);
        color: var(--accent-strong);
        font-weight: 700;
      }

      .status-message {
        min-height: 1.4em;
        color: var(--success);
        font-size: 0.92rem;
      }

      .section-card {
        margin-top: 22px;
        padding: 24px;
        border-radius: var(--radius-xl);
      }

      .section-head {
        display: flex;
        gap: 16px;
        align-items: end;
        justify-content: space-between;
        margin-bottom: 22px;
      }

      .section-head p {
        margin: 10px 0 0;
        max-width: 72ch;
        color: var(--muted);
        line-height: 1.6;
      }

      .asset-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
        gap: 18px;
      }

      .asset-card {
        display: grid;
        gap: 0;
        overflow: hidden;
        border-radius: 22px;
        background: var(--panel-strong);
        border: 1px solid rgba(74, 61, 46, 0.08);
        transition: transform 160ms ease, box-shadow 160ms ease, border-color 160ms ease;
      }

      .asset-card:hover {
        transform: translateY(-3px);
        box-shadow: 0 18px 42px rgba(40, 27, 16, 0.12);
      }

      .asset-card[data-selected="true"] {
        border-color: rgba(181, 83, 47, 0.38);
        box-shadow: 0 18px 42px rgba(181, 83, 47, 0.14);
      }

      .asset-media {
        position: relative;
        background:
          linear-gradient(135deg, rgba(181, 83, 47, 0.12), rgba(33, 114, 104, 0.1)),
          #f3ede2;
      }

      .asset-image-button {
        width: 100%;
        padding: 0;
        border: 0;
        background: transparent;
        cursor: zoom-in;
      }

      .asset-image {
        width: 100%;
        aspect-ratio: 4 / 3;
        object-fit: cover;
      }

      .asset-placeholder {
        display: grid;
        place-items: center;
        aspect-ratio: 4 / 3;
        padding: 24px;
        color: var(--muted);
        text-align: center;
      }

      .zoom-pill {
        position: absolute;
        right: 14px;
        bottom: 14px;
        padding: 8px 12px;
        border-radius: var(--radius-sm);
        background: rgba(31, 36, 48, 0.8);
        color: #fff;
        font-size: 0.82rem;
        pointer-events: none;
      }

      .asset-body {
        display: grid;
        gap: 14px;
        padding: 18px;
      }

      .asset-topline {
        display: flex;
        gap: 10px;
        align-items: center;
        justify-content: space-between;
      }

      .asset-slot {
        color: var(--accent-strong);
        letter-spacing: 0.06em;
        text-transform: uppercase;
        font-size: 0.76rem;
        font-weight: 700;
      }

      .select-button,
      .copy-button,
      .copy-selected,
      .visit-link,
      .modal-close {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        min-height: 42px;
        padding: 0 16px;
        border-radius: var(--radius-sm);
        border: 0;
        cursor: pointer;
        text-decoration: none;
        transition: transform 120ms ease, background-color 120ms ease, color 120ms ease;
      }

      .copy-button,
      .copy-selected {
        background: var(--panel-contrast);
        color: #fff;
      }

      .copy-button:hover,
      .copy-selected:hover {
        transform: translateY(-1px);
        background: #121722;
      }

      .select-button {
        background: rgba(181, 83, 47, 0.1);
        color: var(--accent-strong);
      }

      .asset-card[data-selected="true"] .select-button {
        background: rgba(181, 83, 47, 0.18);
      }

      .visit-link {
        background: transparent;
        border: 1px solid var(--line);
        color: var(--text);
      }

      .copy-button[disabled],
      .select-button[disabled],
      .copy-selected[disabled] {
        cursor: not-allowed;
        opacity: 0.48;
        transform: none;
      }

      .asset-summary {
        margin: 0;
        color: var(--muted);
        line-height: 1.6;
      }

      .badge-row {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      .badge {
        display: inline-flex;
        align-items: center;
        min-height: 28px;
        padding: 0 10px;
        border-radius: var(--radius-sm);
        background: rgba(181, 83, 47, 0.08);
        color: var(--accent-strong);
        font-size: 0.8rem;
        font-weight: 600;
      }

      .detail-list {
        display: grid;
        gap: 8px;
        margin: 0;
      }

      .detail-row {
        display: grid;
        grid-template-columns: 96px 1fr;
        gap: 10px;
        align-items: start;
      }

      .detail-row dt {
        margin: 0;
        color: var(--muted);
        font-size: 0.82rem;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }

      .detail-row dd {
        margin: 0;
        color: var(--text);
        line-height: 1.5;
        word-break: break-word;
      }

      .detail-row code {
        font-family: "SFMono-Regular", "Menlo", monospace;
        font-size: 0.86rem;
      }

      .asset-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
      }

      .empty-state {
        padding: 28px;
        border-radius: 18px;
        background: rgba(255, 255, 255, 0.64);
        border: 1px dashed rgba(74, 61, 46, 0.18);
        color: var(--muted);
      }

      .modal {
        position: fixed;
        inset: 0;
        z-index: 20;
        display: none;
        padding: 24px;
        background: rgba(17, 17, 23, 0.8);
      }

      .modal.is-open {
        display: grid;
        place-items: center;
      }

      .modal-panel {
        position: relative;
        width: min(1180px, calc(100vw - 48px));
        max-height: calc(100vh - 48px);
        overflow: auto;
        padding: 18px 18px 24px;
        border-radius: 24px;
        background: rgba(17, 17, 23, 0.96);
        color: #fff;
      }

      .modal-head {
        display: flex;
        gap: 12px;
        align-items: start;
        justify-content: space-between;
        margin-bottom: 18px;
      }

      .modal-head p {
        margin: 8px 0 0;
        color: rgba(255, 255, 255, 0.72);
      }

      .modal-close {
        background: rgba(255, 255, 255, 0.14);
        color: #fff;
      }

      .modal-image {
        width: 100%;
        max-height: calc(100vh - 190px);
        object-fit: contain;
        border-radius: 18px;
        background: rgba(255, 255, 255, 0.04);
      }

      @media (max-width: 980px) {
        .hero {
          grid-template-columns: 1fr;
        }

        .status-bar {
          position: static;
          align-items: start;
          flex-direction: column;
        }
      }

      @media (max-width: 720px) {
        .shell {
          width: min(100vw - 20px, 100%);
          padding-top: 18px;
        }

        .hero-card,
        .meta-card,
        .section-card {
          padding: 18px;
          border-radius: 22px;
        }

        .asset-grid {
          grid-template-columns: 1fr;
        }

        .detail-row {
          grid-template-columns: 1fr;
        }

        .modal {
          padding: 12px;
        }
      }
    </style>
  </head>
  <body>
    <main class="shell">
      <section class="hero">
        <article class="hero-card">
          <span class="eyebrow">${escapeHtml(model.eyebrow)}</span>
          <h1>${escapeHtml(model.title)}</h1>
          <p class="hero-copy">${escapeHtml(model.subtitle)}</p>
          <div class="hero-note">
            <strong>How to use this view</strong>
            <span>Click any image to open it at full size. Use "Copy URL" to grab a direct reference, and "Select" to prepare multiple URLs at once.</span>
          </div>
        </article>
        <aside class="meta-card">
          <div class="meta-grid">
            ${metaHtml}
          </div>
          ${tokenHtml}
        </aside>
      </section>

      <section class="status-bar" aria-label="Asset selection">
        <div class="status-copy">
          <span class="count-pill" id="selected-count">0</span>
          <div>
            <strong>Selected URLs</strong>
            <div class="status-message" id="status-message">Select cards to copy multiple URLs together.</div>
          </div>
        </div>
        <button type="button" class="copy-selected" id="copy-selected" disabled>Copy selected</button>
      </section>

      ${sectionsHtml}
    </main>

    <div class="modal" id="image-modal" aria-hidden="true">
      <div class="modal-panel" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div class="modal-head">
          <div>
            <h2 id="modal-title">Full-size preview</h2>
            <p id="modal-caption"></p>
          </div>
          <button type="button" class="modal-close" id="modal-close">Close</button>
        </div>
        <img class="modal-image" id="modal-image" alt="" />
      </div>
    </div>

    <script>
      const selectedUrls = new Set();
      const selectedCount = document.getElementById('selected-count');
      const statusMessage = document.getElementById('status-message');
      const copySelectedButton = document.getElementById('copy-selected');
      const modal = document.getElementById('image-modal');
      const modalImage = document.getElementById('modal-image');
      const modalTitle = document.getElementById('modal-title');
      const modalCaption = document.getElementById('modal-caption');
      const modalClose = document.getElementById('modal-close');

      let statusTimer = null;

      function updateSelectionUi() {
        const count = selectedUrls.size;
        selectedCount.textContent = String(count);
        copySelectedButton.disabled = count === 0;
      }

      function setStatus(message) {
        statusMessage.textContent = message;
        if (statusTimer) {
          window.clearTimeout(statusTimer);
        }
        statusTimer = window.setTimeout(() => {
          statusMessage.textContent = selectedUrls.size > 0
            ? 'Ready to copy the selected URLs.'
            : 'Select cards to copy multiple URLs together.';
        }, 2200);
      }

      async function copyText(value) {
        if (!value) {
          return false;
        }

        if (navigator.clipboard && window.isSecureContext) {
          try {
            await navigator.clipboard.writeText(value);
            return true;
          } catch {
            // Fallback below.
          }
        }

        const textarea = document.createElement('textarea');
        textarea.value = value;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        const copied = document.execCommand('copy');
        document.body.removeChild(textarea);
        return copied;
      }

      function openModal(url, title, caption) {
        if (!url) {
          return;
        }

        modalImage.src = url;
        modalImage.alt = title || '';
        modalTitle.textContent = title || 'Full-size preview';
        modalCaption.textContent = caption || url;
        modal.classList.add('is-open');
        modal.setAttribute('aria-hidden', 'false');
      }

      function closeModal() {
        modal.classList.remove('is-open');
        modal.setAttribute('aria-hidden', 'true');
        modalImage.removeAttribute('src');
      }

      document.addEventListener('click', async (event) => {
        const previewTrigger = event.target.closest('[data-preview-image]');
        if (previewTrigger) {
          openModal(
            previewTrigger.getAttribute('data-image-url'),
            previewTrigger.getAttribute('data-image-title'),
            previewTrigger.getAttribute('data-image-caption'),
          );
          return;
        }

        const copyTrigger = event.target.closest('[data-copy]');
        if (copyTrigger) {
          const value = copyTrigger.getAttribute('data-copy');
          const copied = await copyText(value);
          setStatus(copied ? 'URL copied to the clipboard.' : 'Could not copy the URL.');
          return;
        }

        const selectTrigger = event.target.closest('[data-select]');
        if (selectTrigger) {
          const card = selectTrigger.closest('[data-card]');
          const url = card ? card.getAttribute('data-url') : '';
          if (!url) {
            return;
          }

          const isSelected = card.getAttribute('data-selected') === 'true';
          if (isSelected) {
            card.setAttribute('data-selected', 'false');
            selectedUrls.delete(url);
            selectTrigger.textContent = 'Select';
          } else {
            card.setAttribute('data-selected', 'true');
            selectedUrls.add(url);
            selectTrigger.textContent = 'Selected';
          }

          updateSelectionUi();
          setStatus(selectedUrls.size > 0 ? 'Selection updated.' : 'No URLs selected.');
        }
      });

      copySelectedButton.addEventListener('click', async () => {
        const payload = [...selectedUrls].join('\\n');
        const copied = await copyText(payload);
        setStatus(copied ? 'Selected URLs copied.' : 'Could not copy the selected URLs.');
      });

      modalClose.addEventListener('click', closeModal);

      modal.addEventListener('click', (event) => {
        if (event.target === modal) {
          closeModal();
        }
      });

      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && modal.classList.contains('is-open')) {
          closeModal();
        }
      });

      updateSelectionUi();
    </script>
  </body>
</html>
`;
}

export function buildPreviewOutputPath(jsonPath) {
  const parsed = path.parse(jsonPath);
  if (parsed.base === 'analysis.json') {
    return path.join(parsed.dir, 'preview.html');
  }

  return path.join(parsed.dir, `${parsed.name}.preview.html`);
}

function normalizePayload(payload) {
  return normalizeScrapePayload(payload);
}

function isBrandAnalysis(payload) {
  return Boolean(
    payload &&
      typeof payload === 'object' &&
      payload.brandId &&
      payload.content &&
      payload.source &&
      payload.candidates,
  );
}

function normalizeBrandPayload(analysis) {
  const sourceUrl = analysis.source?.finalUrl || analysis.source?.requestedUrl || '';
  const selectedItems = buildBrandSelectedItems(analysis, sourceUrl);
  const candidateItems = (analysis.candidates?.images || []).map((candidate, index) =>
    buildCandidateItem(candidate, index, sourceUrl),
  );

  return {
    eyebrow: 'Brand review',
    title: analysis.displayName || analysis.brandId || 'Preview',
    subtitle:
      normalizeWhitespace(analysis.content?.pageDescription) ||
      `Visual review of the detected assets for ${analysis.displayName || analysis.brandId || 'this brand'}.`,
    meta: [
      {
        label: 'Brand ID',
        value: analysis.brandId || 'unknown',
      },
      {
        label: 'Source URL',
        value: sourceUrl || 'n/a',
      },
      {
        label: 'Generated',
        value: formatDate(analysis.source?.fetchedAt),
      },
      {
        label: 'Images detected',
        value: String(analysis.rendererSummary?.imageCandidateCount || candidateItems.length),
      },
    ],
    tokens: buildTokenItems(analysis.tokens),
    sections: [
      {
        title: 'Selected assets',
        description: 'These are the final slots proposed by the pipeline for the logo, hero, and featured blocks.',
        items: selectedItems,
      },
      {
        title: 'Detected candidates',
        description: 'Full gallery with DOM context, source, and scoring so you can quickly review whether anything should change.',
        items: candidateItems,
      },
    ],
  };
}

function normalizeScrapePayload(payload) {
  const sourceUrl = payload.finalUrl || payload.requestedUrl || '';
  const items = (payload.images || []).map((image, index) => buildCandidateItem(image, index, sourceUrl));

  return {
    eyebrow: 'Scrape preview',
    title: extractDisplayTitle(sourceUrl, payload.requestedUrl),
    subtitle:
      items.length > 0
        ? 'Visual review of the extracted images and the nearby text associated with each one.'
        : 'The JSON payload does not contain any detected images to display in the gallery.',
    meta: [
      {
        label: 'Requested URL',
        value: payload.requestedUrl || 'n/a',
      },
      {
        label: 'Final URL',
        value: payload.finalUrl || 'n/a',
      },
      {
        label: 'Images detected',
        value: String(items.length),
      },
      {
        label: 'Markdown length',
        value: String(normalizeWhitespace(payload.markdown).length),
      },
    ],
    tokens: [],
    sections: [
      {
        title: 'Detected images',
        description: 'Each card shows a medium-sized image, the related text, and quick actions to copy or enlarge it.',
        items,
      },
    ],
  };
}

function buildBrandSelectedItems(analysis, sourceUrl) {
  const content = analysis.content || {};
  const hero = content.hero || {};
  const featuredContent = content.featuredContent || {};

  return [
    buildSelectedItem('Logo', {
      title: `${analysis.displayName || analysis.brandId || 'Brand'} logo`,
      description: 'Primary asset detected for the header.',
      imageUrl: analysis.images?.logo || '',
      imageAlt: `${analysis.displayName || analysis.brandId || 'Brand'} logo`,
    }, sourceUrl),
    buildSelectedItem('Hero 1', hero.slide1, sourceUrl),
    buildSelectedItem('Hero 2', hero.slide2, sourceUrl),
    buildSelectedItem('Hero 3', hero.slide3, sourceUrl),
    buildSelectedItem('New arrivals', content.newArrivals, sourceUrl),
    buildSelectedItem('Women', featuredContent.women, sourceUrl),
    buildSelectedItem('Men', featuredContent.men, sourceUrl),
  ].filter(Boolean);
}

function buildSelectedItem(slotName, slot, sourceUrl) {
  if (!slot) {
    return null;
  }

  const resolvedLink = resolveAgainst(sourceUrl, slot.ctaLink);

  return {
    slotName,
    title: normalizeWhitespace(slot.title) || slotName,
    imageUrl: slot.imageUrl || '',
    imageAlt: normalizeWhitespace(slot.imageAlt) || normalizeWhitespace(slot.title) || slotName,
    summary:
      truncate(
        normalizeWhitespace(slot.subtitle || slot.description || slot.ctaText || 'No text extracted for this asset.'),
        220,
      ) || 'No text extracted for this asset.',
    badges: ['Selected asset', slotName],
    linkUrl: resolvedLink,
    details: [
      { label: 'CTA', value: normalizeWhitespace(slot.ctaText) || null },
      { label: 'Link', value: resolvedLink || null },
      { label: 'Alt', value: normalizeWhitespace(slot.imageAlt) || null },
      { label: 'Image', value: slot.imageUrl || null },
    ],
  };
}

function buildCandidateItem(candidate, index, sourceUrl) {
  const title =
    firstMeaningful([
      candidate?.context?.heading,
      candidate?.alt,
      candidate?.context?.headings?.[0],
      `Image ${index + 1}`,
    ]) || `Image ${index + 1}`;
  const summary =
    truncate(
      firstMeaningful([
        candidate?.context?.paragraph,
        candidate?.context?.text,
        candidate?.alt,
        'No text context extracted for this image.',
      ]),
      220,
    ) || 'No text context extracted for this image.';
  const primaryLink = normalizeContextLink(candidate?.context?.links?.[0], sourceUrl);

  return {
    slotName: `Candidate ${index + 1}`,
    title,
    imageUrl: candidate?.url || '',
    imageAlt: normalizeWhitespace(candidate?.alt) || title,
    summary,
    badges: [
      candidate?.source || 'image',
      ...topScoreBadges(candidate?.scores),
    ],
    linkUrl: primaryLink?.url || '',
    details: [
      { label: 'Alt', value: normalizeWhitespace(candidate?.alt) || null },
      { label: 'Size', value: formatDimensions(candidate) },
      { label: 'Heading', value: normalizeWhitespace(candidate?.context?.heading) || null },
      { label: 'Link', value: primaryLink ? `${primaryLink.text} -> ${primaryLink.url}` : null },
      { label: 'Classes', value: normalizeWhitespace(candidate?.classes) || null },
    ],
  };
}

function renderSection(section) {
  const itemsHtml = section.items.length > 0
    ? `<div class="asset-grid">${section.items.map(renderCard).join('\n')}</div>`
    : '<div class="empty-state">There are no items to display in this section.</div>';

  return `<section class="section-card">
    <div class="section-head">
      <div>
        <h2>${escapeHtml(section.title)}</h2>
        <p>${escapeHtml(section.description)}</p>
      </div>
    </div>
    ${itemsHtml}
  </section>`;
}

function renderCard(item) {
  const hasImage = Boolean(item.imageUrl);
  const badgesHtml = item.badges.length > 0
    ? `<div class="badge-row">${item.badges.map((badge) => `<span class="badge">${escapeHtml(badge)}</span>`).join('')}</div>`
    : '';
  const detailsHtml = renderDetails(item.details);
  const imageHtml = hasImage
    ? `<button
        type="button"
        class="asset-image-button"
        data-preview-image
        data-image-url="${escapeAttribute(item.imageUrl)}"
        data-image-title="${escapeAttribute(item.title)}"
        data-image-caption="${escapeAttribute(item.imageAlt || item.imageUrl)}"
      >
        <img class="asset-image" src="${escapeAttribute(item.imageUrl)}" alt="${escapeAttribute(item.imageAlt)}" loading="lazy" />
        <span class="zoom-pill">Open full size</span>
      </button>`
    : '<div class="asset-placeholder">No image is available for this block.</div>';

  return `<article class="asset-card" data-card data-url="${escapeAttribute(item.imageUrl)}" data-selected="false">
    <div class="asset-media">
      ${imageHtml}
    </div>
    <div class="asset-body">
      <div class="asset-topline">
        <span class="asset-slot">${escapeHtml(item.slotName)}</span>
        <button type="button" class="select-button" data-select ${hasImage ? '' : 'disabled'}>Select</button>
      </div>
      <h3>${escapeHtml(item.title)}</h3>
      ${badgesHtml}
      <p class="asset-summary">${escapeHtml(item.summary)}</p>
      ${detailsHtml}
      <div class="asset-actions">
        <button type="button" class="copy-button" data-copy="${escapeAttribute(item.imageUrl)}" ${hasImage ? '' : 'disabled'}>Copy URL</button>
        ${item.linkUrl ? `<a class="visit-link" href="${escapeAttribute(item.linkUrl)}" target="_blank" rel="noreferrer">Open link</a>` : ''}
      </div>
    </div>
  </article>`;
}

function renderDetails(details) {
  const rows = details.filter((detail) => detail && detail.value);
  if (rows.length === 0) {
    return '';
  }

  return `<dl class="detail-list">${rows
    .map(
      (detail) => `<div class="detail-row">
        <dt>${escapeHtml(detail.label)}</dt>
        <dd><code>${escapeHtml(detail.value)}</code></dd>
      </div>`,
    )
    .join('\n')}</dl>`;
}

function renderMetaItem(item) {
  return `<dl class="meta-item">
    <dt>${escapeHtml(item.label)}</dt>
    <dd>${escapeHtml(item.value)}</dd>
  </dl>`;
}

function renderTokenSection(tokens) {
  return `<div class="token-grid">
    ${tokens
      .map(
        (token) => `<div class="token-row">
          <span class="token-swatch" style="background:${escapeAttribute(token.value)}"></span>
          <strong>${escapeHtml(token.label)}</strong>
          <code>${escapeHtml(token.value)}</code>
        </div>`,
      )
      .join('\n')}
  </div>`;
}

function buildTokenItems(tokens) {
  if (!tokens) {
    return [];
  }

  return [
    { label: 'Primary', value: tokens.primary },
    { label: 'Background', value: tokens.background },
    { label: 'Foreground', value: tokens.foreground },
    { label: 'Accent', value: tokens.accent },
  ].filter((token) => token.value);
}

function topScoreBadges(scores) {
  if (!scores) {
    return [];
  }

  return Object.entries(scores)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 3)
    .map(([key, value]) => `${labelScore(key)} ${Math.round(value)}`);
}

function labelScore(key) {
  switch (key) {
    case 'newArrivals':
      return 'new';
    default:
      return key;
  }
}

function normalizeContextLink(link, sourceUrl) {
  if (!link) {
    return null;
  }

  const text = normalizeWhitespace(link.text) || 'Open link';
  const url = resolveAgainst(sourceUrl, link.href);

  if (!url) {
    return null;
  }

  return {
    text,
    url,
  };
}

function resolveAgainst(baseUrl, rawUrl) {
  if (!rawUrl) {
    return '';
  }

  try {
    return new URL(rawUrl, baseUrl || undefined).toString();
  } catch {
    return rawUrl;
  }
}

function formatDimensions(candidate) {
  if (!candidate?.width || !candidate?.height) {
    return null;
  }

  return `${candidate.width} x ${candidate.height}`;
}

function extractDisplayTitle(finalUrl, requestedUrl) {
  const label = finalUrl || requestedUrl || 'Preview';

  try {
    const url = new URL(label);
    if (url.protocol === 'file:') {
      return path.basename(url.pathname) || 'Preview';
    }

    return url.hostname.replace(/^www\./, '') || label;
  } catch {
    return label;
  }
}

function firstMeaningful(values) {
  return values.map((value) => normalizeWhitespace(value)).find(Boolean) || '';
}

function formatDate(value) {
  if (!value) {
    return 'n/a';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
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
