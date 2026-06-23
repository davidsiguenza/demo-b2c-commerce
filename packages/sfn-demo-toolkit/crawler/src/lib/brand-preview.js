import { normalizeWhitespace } from './strings.js';

const SLOT_ORDER = ['logo', 'hero.slide1', 'hero.slide2', 'hero.slide3', 'newArrivals', 'featured.women', 'featured.men'];
const TOKEN_ORDER = [
  { key: 'primary', label: 'Primary' },
  { key: 'primaryForeground', label: 'Primary foreground' },
  { key: 'background', label: 'Background' },
  { key: 'foreground', label: 'Foreground' },
  { key: 'accent', label: 'Accent' },
  { key: 'accentForeground', label: 'Accent foreground' },
  { key: 'border', label: 'Border' },
  { key: 'ring', label: 'Ring' },
];

export function buildBrandPreviewHtml(analysis) {
  const model = normalizeBrandPreviewModel(analysis);
  const initialOverridesJson = JSON.stringify(buildInitialOverridesPayload(model), null, 2);
  const hasEditableTokens = Object.keys(model.editableTokens || {}).length > 0;
  const metaHtml = [
    renderMetaItem('Brand ID', model.brandId || 'unknown'),
    renderMetaItem('Source URL', model.sourceUrl || 'n/a'),
    renderMetaItem('Generated', formatDate(model.generatedAt)),
    renderMetaItem('Image families', String(model.imageFamilyCount)),
    renderMetaItem('Raw candidates', String(model.imageCandidateCount)),
  ].join('\n');
  const tokenHtml = hasEditableTokens
    ? renderEditableTokenSection(model.editableTokens)
    : model.tokens.length > 0
      ? renderTokenGrid(model.tokens)
      : '';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(model.title)}</title>
    <style>
      :root {
        --bg: #f3eadc;
        --panel: rgba(255, 251, 244, 0.92);
        --panel-strong: #fff9f0;
        --panel-contrast: #1d2430;
        --text: #251e15;
        --muted: #6b5d4d;
        --line: rgba(76, 60, 40, 0.12);
        --accent: #aa4f2f;
        --accent-strong: #8a3517;
        --accent-soft: rgba(170, 79, 47, 0.12);
        --warning: #b46d06;
        --warning-soft: rgba(180, 109, 6, 0.12);
        --success: #1e7b4d;
        --shadow: 0 24px 64px rgba(44, 30, 16, 0.12);
        --radius-xl: 28px;
        --radius-lg: 20px;
        --radius-md: 14px;
        --radius-pill: 999px;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-height: 100vh;
        background:
          radial-gradient(circle at top left, rgba(170, 79, 47, 0.16), transparent 36%),
          radial-gradient(circle at top right, rgba(37, 124, 109, 0.12), transparent 28%),
          linear-gradient(180deg, #fbf5ea 0%, #efe5d6 100%);
        color: var(--text);
        font-family: "Avenir Next", "Segoe UI", sans-serif;
      }

      img {
        display: block;
        max-width: 100%;
      }

      button,
      a,
      textarea,
      input {
        font: inherit;
      }

      .shell {
        width: min(1460px, calc(100vw - 32px));
        margin: 0 auto;
        padding: 28px 0 64px;
      }

      .hero {
        display: grid;
        grid-template-columns: minmax(0, 1.45fr) minmax(320px, 0.8fr);
        gap: 20px;
      }

      .hero-card,
      .meta-card,
      .section-card,
      .notice-card {
        background: var(--panel);
        border: 1px solid rgba(255, 255, 255, 0.6);
        box-shadow: var(--shadow);
        backdrop-filter: blur(16px);
      }

      .hero-card,
      .meta-card,
      .section-card,
      .notice-card {
        border-radius: var(--radius-xl);
      }

      .hero-card,
      .meta-card,
      .section-card {
        padding: 24px;
      }

      .hero-card {
        position: relative;
        overflow: hidden;
      }

      .hero-card::after {
        content: "";
        position: absolute;
        right: -90px;
        bottom: -120px;
        width: 280px;
        height: 280px;
        border-radius: 50%;
        background: radial-gradient(circle, rgba(170, 79, 47, 0.2), transparent 70%);
        pointer-events: none;
      }

      .eyebrow,
      .badge,
      .pill {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        min-height: 28px;
        padding: 0 12px;
        border-radius: var(--radius-pill);
        font-size: 0.8rem;
        font-weight: 700;
        letter-spacing: 0.04em;
      }

      .eyebrow {
        background: rgba(255, 255, 255, 0.76);
        color: var(--accent-strong);
        text-transform: uppercase;
      }

      .badge {
        background: rgba(170, 79, 47, 0.08);
        color: var(--accent-strong);
      }

      .badge-muted {
        background: rgba(29, 36, 48, 0.08);
        color: var(--muted);
      }

      .badge-warning {
        background: var(--warning-soft);
        color: var(--warning);
      }

      h1,
      h2,
      h3,
      h4 {
        margin: 0;
        font-family: "Iowan Old Style", "Palatino Linotype", serif;
        line-height: 1.04;
      }

      h1 {
        margin-top: 16px;
        font-size: clamp(2.5rem, 4vw, 4.5rem);
        max-width: 11ch;
      }

      .hero-copy {
        max-width: 72ch;
        margin: 16px 0 0;
        color: var(--muted);
        line-height: 1.65;
      }

      .hero-steps {
        display: grid;
        gap: 12px;
        margin-top: 20px;
      }

      .step {
        padding: 14px 16px;
        border-radius: var(--radius-lg);
        background: rgba(255, 255, 255, 0.7);
        border: 1px solid var(--line);
      }

      .step strong {
        display: block;
        font-size: 0.96rem;
      }

      .step span {
        display: block;
        margin-top: 6px;
        color: var(--muted);
        line-height: 1.55;
      }

      .meta-card {
        display: grid;
        gap: 16px;
        align-content: start;
      }

      .meta-grid,
      .token-grid {
        display: grid;
        gap: 10px;
      }

      .meta-item,
      .token-row {
        padding: 12px 14px;
        border-radius: var(--radius-md);
        background: rgba(255, 255, 255, 0.72);
        border: 1px solid var(--line);
      }

      .meta-item dt {
        margin: 0 0 6px;
        color: var(--muted);
        font-size: 0.8rem;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }

      .meta-item dd {
        margin: 0;
        line-height: 1.45;
        word-break: break-word;
      }

      .token-row {
        display: grid;
        grid-template-columns: auto 1fr auto;
        gap: 12px;
        align-items: center;
      }

      .token-panel {
        display: grid;
        gap: 12px;
      }

      .token-panel-head {
        display: grid;
        gap: 6px;
      }

      .token-panel-head p {
        margin: 0;
        color: var(--muted);
        font-size: 0.92rem;
        line-height: 1.45;
      }

      .token-editor-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
        gap: 14px;
      }

      .token-editor-card {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr) auto;
        gap: 14px;
        align-items: center;
        padding: 14px 16px;
        border-radius: 18px;
        background: rgba(255, 255, 255, 0.72);
        border: 1px solid var(--line);
      }

      .token-editor-label {
        font-size: 1.05rem;
        font-weight: 700;
        line-height: 1.2;
      }

      .token-editor-copy {
        min-width: 0;
      }

      .token-editor-copy p {
        margin: 4px 0 0;
        color: var(--muted);
        font-size: 0.86rem;
      }

      .token-editor-swatch {
        width: 26px;
        height: 26px;
        padding: 0;
        border: 0;
        background: transparent;
        cursor: pointer;
        border-radius: 50%;
        overflow: hidden;
      }

      .token-editor-swatch::-webkit-color-swatch-wrapper {
        padding: 0;
      }

      .token-editor-swatch::-webkit-color-swatch,
      .token-editor-swatch::-moz-color-swatch {
        border: 1px solid rgba(0, 0, 0, 0.12);
        border-radius: 50%;
      }

      .token-editor-input {
        width: 112px;
        min-height: 36px;
        padding: 0;
        border: 0;
        background: transparent;
        color: var(--panel-contrast);
        text-align: right;
        font-family: "SFMono-Regular", "Menlo", monospace;
        font-size: 0.95rem;
      }

      .token-editor-input.is-invalid {
        color: var(--warning);
      }

      .token-editor-input:focus {
        outline: none;
      }

      .token-swatch {
        width: 18px;
        height: 18px;
        border-radius: 50%;
        border: 1px solid rgba(0, 0, 0, 0.14);
      }

      .notice-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 18px;
        margin-top: 20px;
      }

      .notice-card {
        padding: 18px 20px;
      }

      .notice-card p {
        margin: 10px 0 0;
        color: var(--muted);
        line-height: 1.55;
      }

      .section-card {
        margin-top: 22px;
      }

      .section-head {
        display: flex;
        gap: 16px;
        align-items: end;
        justify-content: space-between;
        margin-bottom: 18px;
      }

      .section-head p {
        margin: 10px 0 0;
        max-width: 76ch;
        color: var(--muted);
        line-height: 1.55;
      }

      .section-tools {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        align-items: center;
      }

      .button,
      .link-button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        min-height: 42px;
        padding: 0 16px;
        border-radius: var(--radius-pill);
        border: 0;
        cursor: pointer;
        text-decoration: none;
        transition: transform 120ms ease, background-color 120ms ease;
      }

      .button {
        background: var(--panel-contrast);
        color: #fff;
      }

      .button:hover,
      .link-button:hover {
        transform: translateY(-1px);
      }

      .button[disabled] {
        cursor: not-allowed;
        opacity: 0.52;
        transform: none;
      }

      .is-hidden {
        display: none !important;
      }

      .button-secondary {
        background: rgba(170, 79, 47, 0.1);
        color: var(--accent-strong);
      }

      .button-tertiary {
        background: rgba(29, 36, 48, 0.08);
        color: var(--text);
      }

      .button-ghost {
        background: transparent;
        border: 1px solid var(--line);
        color: var(--text);
      }

      .textarea-wrap {
        display: grid;
        gap: 12px;
      }

      .overrides-textarea {
        width: 100%;
        min-height: 180px;
        padding: 16px;
        border-radius: 18px;
        border: 1px solid var(--line);
        background: rgba(255, 255, 255, 0.76);
        color: var(--panel-contrast);
        resize: vertical;
      }

      .status-line {
        min-height: 1.4em;
        color: var(--muted);
        font-size: 0.95rem;
      }

      .status-line.warning {
        color: var(--warning);
      }

      .slot-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
        gap: 18px;
      }

      .slot-card,
      .family-card {
        overflow: hidden;
        border-radius: 24px;
        background: var(--panel-strong);
        border: 1px solid rgba(76, 60, 40, 0.08);
        transition: transform 160ms ease, box-shadow 160ms ease, border-color 160ms ease;
      }

      .slot-card:hover,
      .family-card:hover {
        transform: translateY(-2px);
        box-shadow: 0 18px 38px rgba(44, 30, 16, 0.1);
      }

      .slot-card.is-active {
        border-color: rgba(170, 79, 47, 0.42);
        box-shadow: 0 20px 42px rgba(170, 79, 47, 0.14);
      }

      .slot-card.is-overridden {
        border-color: rgba(30, 123, 77, 0.34);
      }

      .slot-card.is-empty {
        border-style: dashed;
      }

      .slot-media,
      .family-media {
        position: relative;
        background:
          linear-gradient(135deg, rgba(170, 79, 47, 0.12), rgba(37, 124, 109, 0.08)),
          #f5ede1;
      }

      .image-button {
        width: 100%;
        padding: 0;
        border: 0;
        background: transparent;
        cursor: zoom-in;
      }

      .card-image {
        width: 100%;
        aspect-ratio: 4 / 3;
        object-fit: cover;
      }

      .card-placeholder {
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
        border-radius: var(--radius-pill);
        background: rgba(29, 36, 48, 0.82);
        color: #fff;
        font-size: 0.82rem;
        pointer-events: none;
      }

      .slot-body,
      .family-body {
        display: grid;
        gap: 14px;
        padding: 18px;
      }

      .card-topline {
        display: flex;
        gap: 10px;
        align-items: center;
        justify-content: space-between;
      }

      .card-title {
        font-size: 1.7rem;
      }

      .slot-label {
        color: var(--accent-strong);
        font-size: 0.78rem;
        font-weight: 700;
        letter-spacing: 0.06em;
        text-transform: uppercase;
      }

      .card-summary {
        margin: 0;
        color: var(--muted);
        line-height: 1.6;
      }

      .badge-row,
      .action-row,
      .variation-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      .detail-list {
        display: grid;
        gap: 8px;
        margin: 0;
      }

      .detail-row {
        display: grid;
        grid-template-columns: 90px 1fr;
        gap: 10px;
      }

      .detail-row dt {
        color: var(--muted);
        font-size: 0.8rem;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }

      .detail-row dd {
        margin: 0;
        line-height: 1.45;
        word-break: break-word;
      }

      .detail-row code {
        font-family: "SFMono-Regular", "Menlo", monospace;
        font-size: 0.84rem;
      }

      .family-grid {
        display: grid;
        gap: 18px;
      }

      .family-card {
        display: grid;
        grid-template-columns: minmax(260px, 360px) minmax(0, 1fr);
      }

      .family-metadata {
        display: grid;
        gap: 10px;
      }

      .used-by {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      details.variations {
        padding: 14px 16px 2px;
        border-radius: 18px;
        background: rgba(29, 36, 48, 0.04);
        border: 1px solid rgba(29, 36, 48, 0.08);
      }

      details.variations summary {
        cursor: pointer;
        font-weight: 700;
        color: var(--text);
        list-style: none;
      }

      details.variations summary::-webkit-details-marker {
        display: none;
      }

      .variation-list {
        display: grid;
        gap: 12px;
        margin-top: 14px;
      }

      .variation-item {
        display: grid;
        grid-template-columns: 104px minmax(0, 1fr);
        gap: 12px;
        align-items: start;
        padding-top: 12px;
        border-top: 1px solid rgba(29, 36, 48, 0.08);
      }

      .variation-thumb {
        width: 104px;
        aspect-ratio: 4 / 3;
        border-radius: 14px;
        object-fit: cover;
        background: rgba(29, 36, 48, 0.06);
      }

      .variation-copy {
        display: grid;
        gap: 8px;
      }

      .variation-meta {
        color: var(--muted);
        font-size: 0.9rem;
      }

      .modal {
        position: fixed;
        inset: 0;
        z-index: 20;
        display: none;
        padding: 24px;
        background: rgba(18, 18, 26, 0.82);
      }

      .modal.is-open {
        display: grid;
        place-items: center;
      }

      .modal-panel {
        width: min(1160px, calc(100vw - 48px));
        max-height: calc(100vh - 48px);
        overflow: auto;
        padding: 18px 18px 24px;
        border-radius: 24px;
        background: rgba(18, 18, 26, 0.96);
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

      .modal-image {
        width: 100%;
        max-height: calc(100vh - 190px);
        object-fit: contain;
        border-radius: 18px;
        background: rgba(255, 255, 255, 0.04);
      }

      @media (max-width: 1100px) {
        .hero,
        .notice-grid,
        .family-card {
          grid-template-columns: 1fr;
        }

        .meta-card .token-editor-grid {
          grid-template-columns: 1fr;
        }
      }

      @media (max-width: 760px) {
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

        .detail-row,
        .variation-item {
          grid-template-columns: 1fr;
        }

        .token-editor-card {
          grid-template-columns: auto minmax(0, 1fr);
        }

        .token-editor-input {
          grid-column: 1 / -1;
          width: 100%;
          text-align: left;
        }

        .variation-thumb {
          width: 100%;
        }
      }
    </style>
  </head>
  <body>
    <script id="brand-preview-data" type="application/json">${escapeScriptJson(model)}</script>
    <main class="shell">
      <section class="hero">
        <article class="hero-card">
          <span class="eyebrow">Brand review</span>
          <h1>${escapeHtml(model.title)}</h1>
          <p class="hero-copy">${escapeHtml(model.subtitle)}</p>
          <div class="hero-steps">
            <div class="step">
              <strong>1. Review the selected slots</strong>
              <span>Each homepage slot starts with the current automatic choice. Activate a slot before assigning a replacement.</span>
            </div>
            <div class="step">
              <strong>2. Choose a candidate family or a specific variation</strong>
              <span>Families collapse repeated assets into one card, so identical images in multiple formats do not flood the page.</span>
            </div>
            <div class="step">
              <strong>3. Save or copy the current selection payload</strong>
              <span>The overrides JSON should always reflect the latest slot selection you see in this preview, so regenerating or applying keeps the current state intact.</span>
            </div>
          </div>
        </article>
        <aside class="meta-card">
          <div class="meta-grid">
            ${metaHtml}
          </div>
          ${tokenHtml}
        </aside>
      </section>

      <section class="notice-grid">
        <article class="notice-card">
          <h2>Preview-first workflow</h2>
          <p>Use this view to curate the exact homepage story before anything is written into the storefront project. The final patching step should happen only after this preview looks right.</p>
        </article>
        <article class="notice-card">
          <h2>Duplicate protection</h2>
          <p id="duplicate-status">All current slot assignments are unique across both imagery and extracted text context.</p>
        </article>
      </section>

      <section class="section-card">
        <div class="section-head">
          <div>
            <h2>Overrides JSON</h2>
            <p>The payload below records the current slot selection shown in this preview. The numbers are indices from <code>page.json.images[]</code>.</p>
          </div>
          <div class="section-tools">
            <button type="button" class="button button-secondary" id="save-overrides" disabled>Save overrides.json</button>
            <button type="button" class="button button-secondary" id="regenerate-preview" disabled>Regenerate preview</button>
            <button type="button" class="button button-ghost" id="apply-brand" disabled>Apply to storefront</button>
            <button type="button" class="button" id="copy-overrides">Copy overrides.json</button>
          </div>
        </div>
        <div class="textarea-wrap">
          <textarea class="overrides-textarea" id="overrides-json" readonly>${escapeHtml(initialOverridesJson)}</textarea>
          <div class="status-line" id="status-line">Activate a slot, then choose a candidate family or a specific variation.</div>
          <div class="status-line" id="review-mode-line">Preview-only mode. Save, regenerate, and apply are enabled only when this page is opened from the localhost URL started by <code>start-brand-review.sh</code>.</div>
        </div>
      </section>

      <section class="section-card">
        <div class="section-head">
          <div>
            <h2>Selected assets</h2>
            <p>These are the slots that will feed the branded storefront homepage. Use “Change image” on any slot before choosing a replacement below.</p>
          </div>
        </div>
        <div class="slot-grid" id="slot-grid"></div>
      </section>

      <section class="section-card">
        <div class="section-head">
          <div>
            <h2>Detected candidate families</h2>
            <p>Each family groups repeated formats or sizes of the same asset. Open the variations panel only when you need a specific rendition.</p>
          </div>
        </div>
        <div class="family-grid" id="family-grid"></div>
      </section>
    </main>

    <div class="modal" id="image-modal" aria-hidden="true">
      <div class="modal-panel" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div class="modal-head">
          <div>
            <h2 id="modal-title">Full-size preview</h2>
            <p id="modal-caption"></p>
          </div>
          <button type="button" class="button button-tertiary" id="modal-close">Close</button>
        </div>
        <img class="modal-image" id="modal-image" alt="" />
      </div>
    </div>

    <script>
      (function () {
        const data = JSON.parse(document.getElementById('brand-preview-data').textContent);
        const slotGrid = document.getElementById('slot-grid');
        const familyGrid = document.getElementById('family-grid');
        const overridesTextarea = document.getElementById('overrides-json');
        const duplicateStatus = document.getElementById('duplicate-status');
        const statusLine = document.getElementById('status-line');
        const copyOverridesButton = document.getElementById('copy-overrides');
        const saveOverridesButton = document.getElementById('save-overrides');
        const regeneratePreviewButton = document.getElementById('regenerate-preview');
        const applyBrandButton = document.getElementById('apply-brand');
        const reviewModeLine = document.getElementById('review-mode-line');
        const tokenEditorGrid = document.getElementById('token-editor-grid');
        const modal = document.getElementById('image-modal');
        const modalImage = document.getElementById('modal-image');
        const modalTitle = document.getElementById('modal-title');
        const modalCaption = document.getElementById('modal-caption');
        const modalClose = document.getElementById('modal-close');

        const slotOrder = ${JSON.stringify(SLOT_ORDER)};
        const tokenOrder = ${JSON.stringify(TOKEN_ORDER)};
        const baseAssignments = {};
        const currentAssignments = {};
        const overrides = {};
        const currentTokens = Object.assign({}, data.editableTokens || {});
        let activeSlotKey = null;
        let reviewSession = null;
        let statusTimer = null;

        const candidateByIndex = new Map();
        data.families.forEach(function (family) {
          family.candidates.forEach(function (candidate) {
            candidateByIndex.set(candidate.index, Object.assign({}, candidate, {
              familyKey: family.familyKey,
              contentKey: family.contentKey,
              familyScores: family.scores || {},
            }));
          });
        });

        slotOrder.forEach(function (slotKey) {
          const assignment = data.slotAssignments[slotKey] || {};
          baseAssignments[slotKey] = assignment.index === null ? null : assignment.index;
          currentAssignments[slotKey] = baseAssignments[slotKey];
        });

        function getSlotConfig(slotKey) {
          switch (slotKey) {
            case 'logo':
              return {
                label: 'Logo',
                fallbackTitle: data.displayName + ' logo',
                fallbackCtaText: '',
                fallbackLink: data.sourceUrl || '/',
                allowSubtitle: false,
              };
            case 'hero.slide1':
              return {
                label: 'Hero 1',
                fallbackTitle: data.displayName + ' 1',
                fallbackCtaText: 'SHOP NOW',
                fallbackLink: data.sourceUrl || '/',
                allowSubtitle: true,
              };
            case 'hero.slide2':
              return {
                label: 'Hero 2',
                fallbackTitle: data.displayName + ' 2',
                fallbackCtaText: 'SHOP NOW',
                fallbackLink: data.sourceUrl || '/',
                allowSubtitle: true,
              };
            case 'hero.slide3':
              return {
                label: 'Hero 3',
                fallbackTitle: data.displayName + ' 3',
                fallbackCtaText: 'SHOP NOW',
                fallbackLink: data.sourceUrl || '/',
                allowSubtitle: true,
              };
            case 'newArrivals':
              return {
                label: 'New arrivals',
                fallbackTitle: 'New Arrivals',
                fallbackCtaText: 'SHOP NOW',
                fallbackLink: data.sourceUrl || '/',
                allowSubtitle: true,
              };
            case 'featured.women':
              return {
                label: 'Women',
                fallbackTitle: 'Women',
                fallbackCtaText: 'EXPLORE',
                fallbackLink: data.sourceUrl || '/',
                allowSubtitle: true,
              };
            case 'featured.men':
              return {
                label: 'Men',
                fallbackTitle: 'Men',
                fallbackCtaText: 'EXPLORE',
                fallbackLink: data.sourceUrl || '/',
                allowSubtitle: true,
              };
            default:
              return {
                label: slotKey,
                fallbackTitle: slotKey,
                fallbackCtaText: 'SHOP NOW',
                fallbackLink: data.sourceUrl || '/',
                allowSubtitle: true,
              };
          }
        }

        function normalizeWhitespace(value) {
          return String(value || '').replace(/\\s+/g, ' ').trim();
        }

        function getTokenLabel(tokenKey) {
          const match = tokenOrder.find(function (token) {
            return token.key === tokenKey;
          });
          return match ? match.label : tokenKey;
        }

        function truncate(value, maxLength) {
          const text = normalizeWhitespace(value);
          if (text.length <= maxLength) {
            return text;
          }
          return text.slice(0, maxLength - 1).trim() + '...';
        }

        function escapeHtml(value) {
          return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
        }

        function firstMeaningful(values) {
          for (let index = 0; index < values.length; index += 1) {
            const value = normalizeWhitespace(values[index]);
            if (value) {
              return value;
            }
          }
          return '';
        }

        function firstRelevantLink(links) {
          return (links || []).find(function (link) {
            const text = normalizeWhitespace(link && link.text).toLowerCase();
            return text && text.length <= 30 && ['search', 'menu', 'close'].indexOf(text) === -1;
          }) || null;
        }

        function sanitizeLink(rawLink) {
          if (!rawLink) {
            return '/';
          }

          try {
            const url = new URL(rawLink, data.sourceUrl || undefined);
            return (url.pathname || '/') + (url.search || '');
          } catch (_error) {
            return rawLink.charAt(0) === '/' ? rawLink : '/';
          }
        }

        function fullLink(rawLink) {
          if (!rawLink) {
            return '';
          }

          try {
            return new URL(rawLink, data.sourceUrl || undefined).toString();
          } catch (_error) {
            return rawLink;
          }
        }

        function formatDimensions(candidate) {
          if (!candidate || !candidate.width || !candidate.height) {
            return '';
          }
          return candidate.width + ' x ' + candidate.height;
        }

        function topScoreBadges(scores) {
          if (!scores) {
            return [];
          }

          return Object.keys(scores)
            .sort(function (left, right) {
              return scores[right] - scores[left];
            })
            .slice(0, 3)
            .map(function (key) {
              return labelScore(key) + ' ' + Math.round(scores[key] || 0);
            });
        }

        function labelScore(key) {
          if (key === 'newArrivals') {
            return 'new';
          }
          return key;
        }

        function buildSlotPresentation(slotKey, candidate) {
          const config = getSlotConfig(slotKey);
          if (!candidate) {
            return {
              label: config.label,
              title: config.fallbackTitle,
              summary: config.allowSubtitle ? 'No candidate is currently assigned to this slot.' : 'No logo candidate is currently assigned.',
              ctaText: config.fallbackCtaText,
              ctaLink: config.fallbackLink,
              imageUrl: '',
              imageAlt: config.fallbackTitle,
              detailRows: [],
              candidate: null,
            };
          }

          const title = firstMeaningful([
            candidate.context && candidate.context.heading,
            candidate.alt,
            config.fallbackTitle,
          ]);
          const subtitle = config.allowSubtitle
            ? firstMeaningful([
                candidate.context && candidate.context.paragraph,
                candidate.context && candidate.context.headings && candidate.context.headings[1],
                candidate.context && candidate.context.text,
                'Discover ' + title + '.',
              ])
            : '';
          const cta = firstRelevantLink(candidate.context && candidate.context.links);
          const ctaText = cta && cta.text ? cta.text : config.fallbackCtaText;
          const ctaLink = sanitizeLink((cta && cta.href) || config.fallbackLink);

          return {
            label: config.label,
            title: title,
            summary: truncate(subtitle || candidate.alt || 'No text extracted for this image.', 220),
            ctaText: ctaText,
            ctaLink: ctaLink,
            imageUrl: candidate.url || '',
            imageAlt: candidate.alt || title,
            detailRows: [
              { label: 'Family', value: candidate.familyKey || null },
              { label: 'Size', value: formatDimensions(candidate) || null },
              { label: 'Link', value: ctaText && ctaLink ? ctaText + ' -> ' + fullLink(ctaLink) : fullLink(ctaLink) || null },
              { label: 'Image', value: candidate.url || null },
            ],
            candidate: candidate,
          };
        }

        function assignedSlotsByFamily() {
          const byFamily = {};
          slotOrder.forEach(function (slotKey) {
            const index = currentAssignments[slotKey];
            const candidate = candidateByIndex.get(index);
            if (!candidate || !candidate.familyKey) {
              return;
            }
            if (!byFamily[candidate.familyKey]) {
              byFamily[candidate.familyKey] = [];
            }
            byFamily[candidate.familyKey].push(getSlotConfig(slotKey).label);
          });
          return byFamily;
        }

        function duplicateWarnings() {
          const familyMap = {};
          const contentMap = {};

          slotOrder.forEach(function (slotKey) {
            const index = currentAssignments[slotKey];
            const candidate = candidateByIndex.get(index);
            if (!candidate) {
              return;
            }

            if (candidate.familyKey) {
              if (!familyMap[candidate.familyKey]) {
                familyMap[candidate.familyKey] = [];
              }
              familyMap[candidate.familyKey].push(getSlotConfig(slotKey).label);
            }

            if (candidate.contentKey) {
              if (!contentMap[candidate.contentKey]) {
                contentMap[candidate.contentKey] = [];
              }
              contentMap[candidate.contentKey].push(getSlotConfig(slotKey).label);
            }
          });

          const warnings = [];
          Object.keys(familyMap).forEach(function (familyKey) {
            if (familyMap[familyKey].length > 1) {
              warnings.push('Same image family used in ' + familyMap[familyKey].join(', ') + '.');
            }
          });
          Object.keys(contentMap).forEach(function (contentKey) {
            if (contentMap[contentKey].length > 1) {
              warnings.push('Same extracted text context used in ' + contentMap[contentKey].join(', ') + '.');
            }
          });

          return warnings;
        }

        function renderBadges(items, extraClass) {
          if (!items || items.length === 0) {
            return '';
          }

          return '<div class="badge-row">' + items.map(function (item) {
            return '<span class="badge ' + (extraClass || '') + '">' + escapeHtml(item) + '</span>';
          }).join('') + '</div>';
        }

        function renderDetails(detailRows) {
          const rows = (detailRows || []).filter(function (row) {
            return row && row.value;
          });
          if (rows.length === 0) {
            return '';
          }

          return '<dl class="detail-list">' + rows.map(function (row) {
            return '<div class="detail-row"><dt>' + escapeHtml(row.label) + '</dt><dd><code>' + escapeHtml(row.value) + '</code></dd></div>';
          }).join('') + '</dl>';
        }

        function renderSlotCard(slotKey) {
          const index = currentAssignments[slotKey];
          const candidate = candidateByIndex.get(index) || null;
          const presentation = buildSlotPresentation(slotKey, candidate);
          const isActive = activeSlotKey === slotKey;
          const isOverridden = Object.prototype.hasOwnProperty.call(overrides, slotKey);
          const hasImage = Boolean(presentation.imageUrl);
          const classNames = ['slot-card'];

          if (isActive) {
            classNames.push('is-active');
          }
          if (isOverridden) {
            classNames.push('is-overridden');
          }
          if (!hasImage) {
            classNames.push('is-empty');
          }

          const badges = ['Current choice'];
          if (isOverridden) {
            badges.push('Overridden');
          } else {
            badges.push('Auto');
          }

          const imageHtml = hasImage
            ? '<button type="button" class="image-button" data-preview-image data-image-url="' + escapeHtml(presentation.imageUrl) + '" data-image-title="' + escapeHtml(presentation.title) + '" data-image-caption="' + escapeHtml(presentation.imageAlt) + '"><img class="card-image" src="' + escapeHtml(presentation.imageUrl) + '" alt="' + escapeHtml(presentation.imageAlt) + '" loading="lazy" /><span class="zoom-pill">Open full size</span></button>'
            : '<div class="card-placeholder">No image is available for this slot yet.</div>';

          const actionButtons = [
            '<button type="button" class="button button-secondary" data-change-slot="' + escapeHtml(slotKey) + '">' + (isActive ? 'Choosing from candidates' : 'Change image') + '</button>',
            '<button type="button" class="button button-tertiary" data-reset-slot="' + escapeHtml(slotKey) + '"' + (isOverridden ? '' : ' disabled') + '>Reset</button>',
          ];

          if (presentation.ctaLink) {
            actionButtons.push('<a class="button button-ghost" href="' + escapeHtml(fullLink(presentation.ctaLink)) + '" target="_blank" rel="noreferrer">Open link</a>');
          }

          return '<article class="' + classNames.join(' ') + '"><div class="slot-media">' + imageHtml + '</div><div class="slot-body"><div class="card-topline"><span class="slot-label">' + escapeHtml(presentation.label) + '</span></div><h3 class="card-title">' + escapeHtml(presentation.title) + '</h3>' + renderBadges(badges) + '<p class="card-summary">' + escapeHtml(presentation.summary) + '</p>' + renderDetails(presentation.detailRows) + '<div class="action-row">' + actionButtons.join('') + '</div></div></article>';
        }

        function renderVariationItem(slotKey, candidate) {
          const hasImage = Boolean(candidate && candidate.url);
          const actionLabel = activeSlotKey ? 'Use for ' + getSlotConfig(activeSlotKey).label : 'Select a slot first';
          const actionDisabled = activeSlotKey ? '' : ' disabled';
          const variationBadges = [extractExtension(candidate.url || '').toUpperCase() || 'IMG'];
          const size = formatDimensions(candidate);
          if (size) {
            variationBadges.push(size);
          }

          return '<div class="variation-item"><div>' + (hasImage ? '<img class="variation-thumb" src="' + escapeHtml(candidate.url) + '" alt="' + escapeHtml(candidate.alt || '') + '" loading="lazy" />' : '<div class="variation-thumb"></div>') + '</div><div class="variation-copy"><strong>' + escapeHtml(firstMeaningful([candidate.alt, candidate.context && candidate.context.heading, 'Variation'])) + '</strong><div class="variation-meta">' + escapeHtml(truncate(firstMeaningful([candidate.context && candidate.context.paragraph, candidate.context && candidate.context.text, candidate.url]), 180)) + '</div>' + renderBadges(variationBadges, 'badge-muted') + '<div class="variation-actions"><button type="button" class="button button-secondary" data-select-candidate="' + escapeHtml(String(candidate.index)) + '"' + actionDisabled + '>' + escapeHtml(actionLabel) + '</button><button type="button" class="button button-tertiary" data-copy-url="' + escapeHtml(candidate.url || '') + '"' + (hasImage ? '' : ' disabled') + '>Copy URL</button></div></div></div>';
        }

        function extractExtension(url) {
          const match = String(url || '').match(/\\.([a-z0-9]+)(\\?|$)/i);
          return match ? match[1] : '';
        }

        function renderFamilyCard(family) {
          const representative = candidateByIndex.get(family.representativeIndex) || family.candidates[0] || null;
          const hasImage = Boolean(representative && representative.url);
          const familyAssignments = assignedSlotsByFamily()[family.familyKey] || [];
          const actionLabel = activeSlotKey ? 'Use for ' + getSlotConfig(activeSlotKey).label : 'Select a slot first';
          const actionDisabled = activeSlotKey ? '' : ' disabled';
          const imageHtml = hasImage
            ? '<button type="button" class="image-button" data-preview-image data-image-url="' + escapeHtml(representative.url) + '" data-image-title="' + escapeHtml(firstMeaningful([representative.context && representative.context.heading, representative.alt, family.familyKey])) + '" data-image-caption="' + escapeHtml(representative.alt || representative.url) + '"><img class="card-image" src="' + escapeHtml(representative.url) + '" alt="' + escapeHtml(representative.alt || '') + '" loading="lazy" /><span class="zoom-pill">Open full size</span></button>'
            : '<div class="card-placeholder">No representative image is available for this family.</div>';

          const badges = ['' + family.variationCount + ' variations'].concat(topScoreBadges(family.scores || {}));
          const familySummary = truncate(firstMeaningful([
            representative && representative.context && representative.context.paragraph,
            representative && representative.context && representative.context.text,
            representative && representative.alt,
            family.familyKey,
          ]), 220);
          const details = renderDetails([
            { label: 'Family', value: family.familyKey || null },
            { label: 'Content', value: family.contentKey || null },
            { label: 'Image', value: representative && representative.url ? representative.url : null },
          ]);
          const usedByHtml = familyAssignments.length > 0
            ? '<div class="used-by">' + familyAssignments.map(function (slotLabel) {
                return '<span class="pill badge-warning">Used by ' + escapeHtml(slotLabel) + '</span>';
              }).join('') + '</div>'
            : '';
          const variationsHtml = family.candidates.slice(1).map(function (candidate) {
            return renderVariationItem(activeSlotKey, candidate);
          }).join('');
          const detailsHtml = family.candidates.length > 1
            ? '<details class="variations"><summary>Show ' + escapeHtml(String(family.candidates.length - 1)) + ' additional variations</summary><div class="variation-list">' + variationsHtml + '</div></details>'
            : '';

          return '<article class="family-card"><div class="family-media">' + imageHtml + '</div><div class="family-body"><div class="card-topline"><span class="slot-label">Family group</span></div><h3>' + escapeHtml(firstMeaningful([representative && representative.context && representative.context.heading, representative && representative.alt, family.familyKey])) + '</h3>' + renderBadges(badges) + '<p class="card-summary">' + escapeHtml(familySummary) + '</p>' + usedByHtml + details + '<div class="action-row"><button type="button" class="button button-secondary" data-select-candidate="' + escapeHtml(String(representative && representative.index !== undefined ? representative.index : '')) + '"' + actionDisabled + '>' + escapeHtml(actionLabel) + '</button><button type="button" class="button button-tertiary" data-copy-url="' + escapeHtml(representative && representative.url ? representative.url : '') + '"' + (hasImage ? '' : ' disabled') + '>Copy URL</button></div>' + detailsHtml + '</div></article>';
        }

        function renderSlots() {
          slotGrid.innerHTML = slotOrder.map(renderSlotCard).join('');
        }

        function normalizeHexColor(value) {
          const trimmed = String(value || '').trim().toLowerCase();

          if (/^#[0-9a-f]{3}$/.test(trimmed)) {
            return '#' + trimmed.slice(1).split('').map(function (char) {
              return char + char;
            }).join('');
          }

          if (/^#[0-9a-f]{6}$/.test(trimmed)) {
            return trimmed;
          }

          return null;
        }

        function renderTokenEditorCard(token) {
          const value = currentTokens[token.key] || '#000000';
          return '<article class="token-editor-card">' +
            '<input class="token-editor-swatch" data-token-color="' + escapeHtml(token.key) + '" type="color" value="' + escapeHtml(value) + '" aria-label="' + escapeHtml(token.label + ' color picker') + '" />' +
            '<div class="token-editor-copy"><div class="token-editor-label">' + escapeHtml(token.label) + '</div></div>' +
            '<input class="token-editor-input" data-token-text="' + escapeHtml(token.key) + '" type="text" value="' + escapeHtml(value) + '" spellcheck="false" aria-label="' + escapeHtml(token.label + ' color value') + '" />' +
            '</article>';
        }

        function renderTokenEditors() {
          if (!tokenEditorGrid) {
            return;
          }

          const activeTokens = tokenOrder.filter(function (token) {
            return Boolean(currentTokens[token.key]);
          });
          tokenEditorGrid.innerHTML = activeTokens.map(renderTokenEditorCard).join('');
        }

        function renderFamilies() {
          familyGrid.innerHTML = data.families.map(renderFamilyCard).join('');
        }

        function buildOverridesPayload() {
          const slots = {};
          slotOrder.forEach(function (slotKey) {
            const index = currentAssignments[slotKey];
            if (Number.isInteger(index)) {
              slots[slotKey] = index;
            }
          });

          return {
            slots: slots,
            tokens: Object.assign({}, currentTokens),
          };
        }

        function updateOverrides() {
          overridesTextarea.value = JSON.stringify(buildOverridesPayload(), null, 2);
        }

        function setElementHidden(element, shouldHide) {
          if (!element) {
            return;
          }
          element.classList.toggle('is-hidden', Boolean(shouldHide));
        }

        function setButtonBusy(button, isBusy, busyLabel) {
          if (!button) {
            return;
          }

          if (!button.dataset.defaultLabel) {
            button.dataset.defaultLabel = button.textContent;
          }

          button.disabled = Boolean(isBusy);
          button.textContent = isBusy ? busyLabel : button.dataset.defaultLabel;
        }

        async function requestJson(url, options) {
          const response = await fetch(url, options);
          const raw = await response.text();
          const payload = raw ? JSON.parse(raw) : {};

          if (!response.ok) {
            throw new Error(payload.error || ('Request failed with status ' + response.status + '.'));
          }

          return payload;
        }

        async function persistOverrides() {
          if (!reviewSession) {
            throw new Error('This preview is not connected to a local review session.');
          }

          return requestJson('/api/overrides', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(buildOverridesPayload()),
          });
        }

        async function initializeReviewSession() {
          try {
            reviewSession = await requestJson('/api/session');
          } catch (_error) {
            reviewSession = null;
            reviewModeLine.classList.add('warning');
            reviewModeLine.textContent = 'Preview-only mode. Save, regenerate, and apply are enabled only when this page is opened from the localhost URL started by start-brand-review.sh. If you opened preview.html directly or used preview-brand.sh, copy overrides.json and continue from the terminal.';
            return;
          }

          saveOverridesButton.disabled = false;
          regeneratePreviewButton.disabled = false;
          applyBrandButton.disabled = false;
          reviewModeLine.classList.remove('warning');
          reviewModeLine.textContent = 'Live review session connected. Save overrides, regenerate the proposal, or apply the approved brand directly from this page.';
        }

        function updateDuplicateStatus() {
          const warnings = duplicateWarnings();
          if (warnings.length === 0) {
            duplicateStatus.textContent = 'All current slot assignments are unique across both imagery and extracted text context.';
            duplicateStatus.classList.remove('warning');
            return;
          }

          duplicateStatus.textContent = warnings.join(' ');
          duplicateStatus.classList.add('warning');
        }

        function renderAll() {
          renderSlots();
          renderFamilies();
          renderTokenEditors();
          updateOverrides();
          updateDuplicateStatus();
        }

        function setStatus(message, isWarning) {
          statusLine.textContent = message;
          statusLine.classList.toggle('warning', Boolean(isWarning));
          if (statusTimer) {
            window.clearTimeout(statusTimer);
          }
          statusTimer = window.setTimeout(function () {
            statusLine.textContent = activeSlotKey
              ? 'Active slot: ' + getSlotConfig(activeSlotKey).label + '. Choose a family or variation below.'
              : 'Activate a slot, then choose a candidate family or a specific variation.';
            statusLine.classList.toggle('warning', false);
          }, 2600);
        }

        async function copyText(value) {
          if (!value) {
            return false;
          }

          if (navigator.clipboard && window.isSecureContext) {
            try {
              await navigator.clipboard.writeText(value);
              return true;
            } catch (_error) {
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

        document.addEventListener('click', async function (event) {
          const previewTrigger = event.target.closest('[data-preview-image]');
          if (previewTrigger) {
            openModal(
              previewTrigger.getAttribute('data-image-url'),
              previewTrigger.getAttribute('data-image-title'),
              previewTrigger.getAttribute('data-image-caption')
            );
            return;
          }

          const changeSlotTrigger = event.target.closest('[data-change-slot]');
          if (changeSlotTrigger) {
            activeSlotKey = changeSlotTrigger.getAttribute('data-change-slot');
            renderAll();
            setStatus('Active slot updated to ' + getSlotConfig(activeSlotKey).label + '.', false);
            return;
          }

          const resetTrigger = event.target.closest('[data-reset-slot]');
          if (resetTrigger) {
            const slotKey = resetTrigger.getAttribute('data-reset-slot');
            currentAssignments[slotKey] = baseAssignments[slotKey];
            delete overrides[slotKey];
            renderAll();
            setStatus(getSlotConfig(slotKey).label + ' has been reset to the automatic selection.', false);
            return;
          }

          const selectTrigger = event.target.closest('[data-select-candidate]');
          if (selectTrigger) {
            if (!activeSlotKey) {
              setStatus('Choose a slot first, then pick a candidate family or variation.', true);
              return;
            }

            const index = Number(selectTrigger.getAttribute('data-select-candidate'));
            if (!Number.isInteger(index)) {
              setStatus('That candidate does not have a valid image index.', true);
              return;
            }

            currentAssignments[activeSlotKey] = index;
            if (index === baseAssignments[activeSlotKey]) {
              delete overrides[activeSlotKey];
            } else {
              overrides[activeSlotKey] = index;
            }

            renderAll();
            setStatus(getSlotConfig(activeSlotKey).label + ' now points to image index ' + index + '.', false);
            return;
          }

          const copyUrlTrigger = event.target.closest('[data-copy-url]');
          if (copyUrlTrigger) {
            const copied = await copyText(copyUrlTrigger.getAttribute('data-copy-url'));
            setStatus(copied ? 'Image URL copied to the clipboard.' : 'Could not copy the image URL.', !copied);
            return;
          }
        });

        copyOverridesButton.addEventListener('click', async function () {
          const copied = await copyText(overridesTextarea.value);
          setStatus(copied ? 'Overrides JSON copied to the clipboard.' : 'Could not copy overrides JSON.', !copied);
        });

        saveOverridesButton.addEventListener('click', async function () {
          setButtonBusy(saveOverridesButton, true, 'Saving...');

          try {
            const result = await persistOverrides();
            setStatus('Overrides saved to ' + result.overridesPath + '.', false);
          } catch (error) {
            setStatus(error.message || 'Could not save overrides.json.', true);
          } finally {
            setButtonBusy(saveOverridesButton, false);
          }
        });

        regeneratePreviewButton.addEventListener('click', async function () {
          setButtonBusy(regeneratePreviewButton, true, 'Regenerating...');

          try {
            await persistOverrides();
            const result = await requestJson('/api/regenerate', {
              method: 'POST',
            });
            setStatus('Preview regenerated. Reloading the latest proposal...', false);
            window.location.assign(result.previewUrl || ('/preview.html?ts=' + Date.now()));
          } catch (error) {
            setStatus(error.message || 'Could not regenerate the preview.', true);
          } finally {
            setButtonBusy(regeneratePreviewButton, false);
          }
        });

        applyBrandButton.addEventListener('click', async function () {
          if (!window.confirm('Apply this approved brand to the storefront project now?')) {
            return;
          }

          setButtonBusy(applyBrandButton, true, 'Applying...');

          try {
            await persistOverrides();
            const result = await requestJson('/api/apply', {
              method: 'POST',
            });
            const ranSteps = Array.isArray(result.ranSteps) && result.ranSteps.length > 0
              ? ' Ran steps: ' + result.ranSteps.join(', ') + '.'
              : '';
            setStatus('Brand applied to ' + result.appliedTo + '.' + ranSteps, false);
          } catch (error) {
            setStatus(error.message || 'Could not apply the brand to the storefront.', true);
          } finally {
            setButtonBusy(applyBrandButton, false);
          }
        });

        modalClose.addEventListener('click', closeModal);

        modal.addEventListener('click', function (event) {
          if (event.target === modal) {
            closeModal();
          }
        });

        document.addEventListener('keydown', function (event) {
          if (event.key === 'Escape' && modal.classList.contains('is-open')) {
            closeModal();
          }
        });

        document.addEventListener('input', function (event) {
          const colorInput = event.target.closest('[data-token-color]');
          if (!colorInput) {
            return;
          }

          const tokenKey = colorInput.getAttribute('data-token-color');
          const normalized = normalizeHexColor(colorInput.value);
          if (!normalized) {
            return;
          }

          currentTokens[tokenKey] = normalized;
          const textInput = document.querySelector('[data-token-text="' + tokenKey + '"]');
          if (textInput) {
            textInput.value = normalized;
            textInput.classList.remove('is-invalid');
          }
          updateOverrides();
        });

        document.addEventListener('change', function (event) {
          const textInput = event.target.closest('[data-token-text]');
          if (!textInput) {
            return;
          }

          const tokenKey = textInput.getAttribute('data-token-text');
          const normalized = normalizeHexColor(textInput.value);
          if (!normalized) {
            textInput.classList.add('is-invalid');
            setStatus('Use a valid hex color for ' + getTokenLabel(tokenKey) + '.', true);
            return;
          }

          textInput.classList.remove('is-invalid');
          textInput.value = normalized;
          currentTokens[tokenKey] = normalized;
          const colorInput = document.querySelector('[data-token-color="' + tokenKey + '"]');
          if (colorInput) {
            colorInput.value = normalized;
          }
          updateOverrides();
          setStatus(getTokenLabel(tokenKey) + ' updated to ' + normalized + '.', false);
        });

        renderAll();
        void initializeReviewSession();
      })();
    </script>
  </body>
</html>
`;
}

function buildInitialOverridesPayload(model) {
  const slots = {};

  SLOT_ORDER.forEach((slotKey) => {
    const index = model.slotAssignments?.[slotKey]?.index;
    if (Number.isInteger(index)) {
      slots[slotKey] = index;
    }
  });

  return {
    slots,
    tokens: {
      ...model.editableTokens,
    },
  };
}

function normalizeBrandPreviewModel(analysis) {
  const sourceUrl = analysis.source?.finalUrl || analysis.source?.requestedUrl || '';

  return {
    title: analysis.displayName || analysis.brandId || 'Preview',
    subtitle:
      normalizeWhitespace(analysis.content?.pageDescription) ||
      `Visual review of the detected assets for ${analysis.displayName || analysis.brandId || 'this brand'}.`,
    brandId: analysis.brandId || '',
    displayName: analysis.displayName || analysis.brandId || 'Brand',
    sourceUrl,
    generatedAt: analysis.source?.fetchedAt || '',
    imageCandidateCount: analysis.rendererSummary?.imageCandidateCount || (analysis.candidates?.images || []).length,
    imageFamilyCount: analysis.rendererSummary?.imageFamilyCount || (analysis.candidates?.families || []).length,
    tokens: buildTokenItems(analysis.tokens),
    editableTokens: buildEditableTokens(analysis.tokens),
    slotAssignments: analysis.slotAssignments || {},
    families: (analysis.candidates?.families || []).map((family) => ({
      familyKey: family.familyKey,
      contentKey: family.contentKey,
      scores: family.scores || {},
      representativeIndex: family.representative?.index ?? family.candidates?.[0]?.index ?? null,
      variationCount: family.variationCount || family.candidates?.length || 0,
      candidates: (family.candidates || []).map((candidate) => ({
        index: candidate.index,
        url: candidate.url,
        alt: candidate.alt,
        width: candidate.width,
        height: candidate.height,
        source: candidate.source,
        classes: candidate.classes,
        context: {
          heading: candidate.context?.heading || '',
          headings: candidate.context?.headings || [],
          paragraph: candidate.context?.paragraph || '',
          text: candidate.context?.text || '',
          links: (candidate.context?.links || []).map((link) => ({
            text: link.text || '',
            href: link.href || '',
          })),
        },
      })),
    })),
  };
}

function buildEditableTokens(tokens) {
  if (!tokens) {
    return {};
  }

  const result = {};
  TOKEN_ORDER.forEach((token) => {
    if (tokens[token.key]) {
      result[token.key] = tokens[token.key];
    }
  });
  return result;
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

function renderMetaItem(label, value) {
  return `<dl class="meta-item"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></dl>`;
}

function renderTokenGrid(tokens) {
  return `<div class="token-grid">${tokens
    .map(
      (token) => `<div class="token-row"><span class="token-swatch" style="background:${escapeHtml(token.value)}"></span><strong>${escapeHtml(token.label)}</strong><code>${escapeHtml(token.value)}</code></div>`,
    )
    .join('')}</div>`;
}

function renderEditableTokenSection(editableTokens) {
  const activeTokens = TOKEN_ORDER.filter((token) => editableTokens[token.key]);

  return `<section class="token-panel">
    <div class="token-panel-head">
      <h2>Brand colors</h2>
      <p>Edit the selected brand tokens directly here. Saving or applying the preview uses these values.</p>
    </div>
    <div class="token-editor-grid" id="token-editor-grid">${activeTokens
      .map((token) => {
        const value = editableTokens[token.key];
        return `<article class="token-editor-card">
          <input class="token-editor-swatch" data-token-color="${escapeHtml(token.key)}" type="color" value="${escapeHtml(value)}" aria-label="${escapeHtml(`${token.label} color picker`)}" />
          <div class="token-editor-copy"><div class="token-editor-label">${escapeHtml(token.label)}</div></div>
          <input class="token-editor-input" data-token-text="${escapeHtml(token.key)}" type="text" value="${escapeHtml(value)}" spellcheck="false" aria-label="${escapeHtml(`${token.label} color value`)}" />
        </article>`;
      })
      .join('')}</div>
  </section>`;
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

function escapeScriptJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}
