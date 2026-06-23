import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36';

export async function fetchPage(url, options = {}) {
  const waitFor = Number(options.waitFor || 0);
  const timeoutMs = Number(options.timeoutMs || DEFAULT_TIMEOUT_MS);

  if (isFileUrl(url)) {
    const html = await readFile(fileURLToPath(url), 'utf8');
    return {
      html,
      finalUrl: url,
      requestedUrl: url,
      status: 200,
      renderer: 'file',
    };
  }

  const rendered = await tryPlaywright(url, { waitFor, timeoutMs });
  if (rendered) {
    return rendered;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers: {
        'accept': 'text/html,application/xhtml+xml',
        'user-agent': DEFAULT_USER_AGENT,
      },
      redirect: 'follow',
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status} ${response.statusText}`);
    }

    const html = await response.text();
    if (waitFor > 0) {
      await delay(waitFor);
    }

    return {
      html,
      finalUrl: response.url,
      requestedUrl: url,
      status: response.status,
      renderer: 'fetch',
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchText(url, options = {}) {
  const timeoutMs = Number(options.timeoutMs || DEFAULT_TIMEOUT_MS);

  if (isFileUrl(url)) {
    return readFile(fileURLToPath(url), 'utf8');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers: {
        'accept': 'text/plain,text/css,*/*',
        'user-agent': DEFAULT_USER_AGENT,
      },
      redirect: 'follow',
      signal: controller.signal,
    });

    if (!response.ok) {
      return null;
    }

    return await response.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function tryPlaywright(url, options) {
  // Default to Playwright when available; opt out with WEBCRAWLER_NO_PLAYWRIGHT=1
  if (process.env.WEBCRAWLER_NO_PLAYWRIGHT) {
    return null;
  }

  try {
    const playwright = await loadOptionalModule('playwright');
    if (!playwright) {
      process.stderr.write(
        'note: playwright not installed; using native fetch (SPAs may not render). ' +
          'Install with: pnpm add -D playwright && npx playwright install chromium\n',
      );
      return null;
    }

    const chromium = playwright.chromium ?? playwright.default?.chromium;
    if (!chromium) {
      process.stderr.write('note: playwright module loaded but chromium export missing.\n');
      return null;
    }
    const browser = await chromium.launch({
      headless: true,
    });
    const page = await browser.newPage({
      userAgent: DEFAULT_USER_AGENT,
      viewport: { width: 1440, height: 900 },
    });

    await page.goto(url, {
      timeout: options.timeoutMs,
      waitUntil: 'domcontentloaded',
    });

    // Try to settle network — but tolerate timeout (some sites keep long-poll connections)
    try {
      await page.waitForLoadState('networkidle', { timeout: 8000 });
    } catch {
      // continue anyway
    }

    // Best-effort cookie / consent banner dismissal — many SPAs hide their hero behind it
    await dismissCommonBanners(page).catch(() => {});

    // Trigger lazy-loaded sections by scrolling. Most retail homes lazy-load below the fold.
    await scrollToBottomThenTop(page).catch(() => {});

    if (options.waitFor > 0) {
      await page.waitForTimeout(options.waitFor);
    } else {
      // small wait so any post-scroll lazy hydration can settle
      await page.waitForTimeout(750);
    }

    const html = await page.content();
    const finalUrl = page.url();
    await browser.close();

    return {
      html,
      finalUrl,
      requestedUrl: url,
      status: 200,
      renderer: 'playwright',
    };
  } catch (e) {
    const msg = String(e?.message ?? e);
    if (msg.includes("Executable doesn't exist")) {
      process.stderr.write(
        'note: playwright browser not installed; using native fetch (SPAs may not render). ' +
          'Install with: npx playwright install chromium\n',
      );
    } else {
      process.stderr.write(`note: playwright failed (${msg.split('\n')[0]}); using native fetch.\n`);
    }
    return null;
  }
}

function isFileUrl(value) {
  return typeof value === 'string' && value.startsWith('file://');
}

/**
 * Best-effort cookie / consent / region-selector banner dismissal.
 * Tries common selectors used by OneTrust, Cookiebot, Quantcast, plus generic
 * "Accept all" / "Aceptar" buttons. Silent on failure — banners that can't be
 * dismissed will just leave their content in the DOM.
 */
async function dismissCommonBanners(page) {
  const selectors = [
    // OneTrust
    '#onetrust-accept-btn-handler',
    '#onetrust-reject-all-handler',
    'button[aria-label*="Aceptar" i]',
    'button[aria-label*="Accept" i]',
    // Cookiebot
    '#CybotCookiebotDialogBodyButtonAccept',
    '#CybotCookiebotDialogBodyLevelButtonAccept',
    // Quantcast
    '.qc-cmp2-summary-buttons button[mode="primary"]',
    // Didomi
    '#didomi-notice-agree-button',
    // Generic "accept" / "aceptar" buttons
    'button:has-text("Aceptar todo")',
    'button:has-text("Aceptar todas")',
    'button:has-text("Accept all")',
    'button:has-text("I agree")',
    'button:has-text("Got it")',
    'button:has-text("OK")',
  ];

  for (const sel of selectors) {
    try {
      const locator = page.locator(sel).first();
      if (await locator.count() > 0 && await locator.isVisible({ timeout: 500 })) {
        await locator.click({ timeout: 1500 });
        await page.waitForTimeout(400);
        return;
      }
    } catch {
      // try next selector
    }
  }
}

/**
 * Scroll to the bottom in steps, then back up. Triggers lazy-loaded
 * content (hero carousels, image sliders, below-the-fold sections) that
 * many SPAs only hydrate when intersection observers fire.
 */
async function scrollToBottomThenTop(page) {
  await page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const distance = 800;
    const max = document.body.scrollHeight;
    for (let y = 0; y < max; y += distance) {
      window.scrollTo(0, y);
      await sleep(150);
    }
    window.scrollTo(0, 0);
    await sleep(200);
  });
}

async function loadOptionalModule(specifier) {
  const entrypoints = [];

  try {
    entrypoints.push(createRequire(import.meta.url).resolve(specifier));
  } catch {
    // Ignore local resolution failures.
  }

  try {
    entrypoints.push(createRequire(path.join(process.cwd(), 'package.json')).resolve(specifier));
  } catch {
    // Ignore cwd resolution failures.
  }

  for (const entrypoint of new Set(entrypoints)) {
    try {
      return await import(entrypoint);
    } catch {
      // Try the next resolution target.
    }
  }

  return null;
}
