/**
 * Select 7 distinct image slots (logo, hero×3, newArrivals, featured women, featured men)
 * from the full scrape JSON. Deduplicates by "image family" (same asset in different formats)
 * and scores by aspect ratio + keywords so each slot gets a different, well-fitting image.
 */

import { candidateKeywords, normalizeWhitespace, slugify, titleCase, truncate } from './strings.js';

const DEFAULTS = {
  heroCtaText: 'SHOP NOW',
  featureCtaText: 'EXPLORE',
  browseTitle: 'Browse',
  browseCtaText: 'Shop',
  featuredProductsTitle: 'Our Picks',
};

const SLOT_DEFINITIONS = [
  {
    key: 'logo',
    label: 'Logo',
    scoreKeys: ['logo'],
  },
  {
    key: 'hero.slide1',
    label: 'Hero 1',
    scoreKeys: ['hero'],
  },
  {
    key: 'hero.slide2',
    label: 'Hero 2',
    scoreKeys: ['hero'],
  },
  {
    key: 'hero.slide3',
    label: 'Hero 3',
    scoreKeys: ['hero'],
  },
  {
    key: 'newArrivals',
    label: 'New arrivals',
    scoreKeys: ['newArrivals', 'hero'],
  },
  {
    key: 'featured.women',
    label: 'Women',
    scoreKeys: ['women', 'hero'],
  },
  {
    key: 'featured.men',
    label: 'Men',
    scoreKeys: ['men', 'hero'],
  },
];

const SLOT_KEYS = new Set(SLOT_DEFINITIONS.map((slot) => slot.key));

/** Normalize URL to a stable "family" key so .avif, .webp, .jpg of the same asset share one key. */
export function imageFamilyKey(url) {
  try {
    const u = new URL(url);
    let path = u.pathname.replace(/\/$/, '');
    path = path.replace(/\.(avif|webp|jpg|jpeg|png|svg)(\?|$)/i, '$2');
    const segment = path.split('/').filter(Boolean).pop() || path;
    return segment || url;
  } catch {
    return url;
  }
}

/** Prefer one URL per family: .svg for logo; for photos prefer .jpg or .webp, then by dimensions. */
function pickRepresentativeCandidate(candidates, preferSvg = false) {
  if (candidates.length === 0) {
    return null;
  }

  return sortCandidateVariants(candidates, preferSvg)[0] || null;
}

function sortCandidateVariants(candidates, preferSvg = false) {
  return [...candidates].sort((left, right) => compareCandidateVariants(left, right, preferSvg));
}

function compareCandidateVariants(left, right, preferSvg = false) {
  if (preferSvg) {
    const leftSvg = /\.svg(\?|$)/i.test(left.url);
    const rightSvg = /\.svg(\?|$)/i.test(right.url);
    if (leftSvg !== rightSvg) {
      return leftSvg ? -1 : 1;
    }
  }

  const extensionOrder = { jpg: 0, jpeg: 0, webp: 1, png: 2, avif: 3, svg: 4 };
  const leftExt = extractExtension(left.url);
  const rightExt = extractExtension(right.url);
  const leftOrder = extensionOrder[leftExt] ?? 5;
  const rightOrder = extensionOrder[rightExt] ?? 5;

  if (leftOrder !== rightOrder) {
    return leftOrder - rightOrder;
  }

  const leftArea = (left.width || 0) * (left.height || 0);
  const rightArea = (right.width || 0) * (right.height || 0);
  if (leftArea !== rightArea) {
    return rightArea - leftArea;
  }

  return (left.index || 0) - (right.index || 0);
}

function extractExtension(url) {
  return (url.match(/\.(jpg|jpeg|webp|avif|png|svg)(\?|$)/i) || [])[1]?.toLowerCase() || '';
}

/** Group candidates by image family and attach keywords + scores to each representative. */
function buildFamilies(images) {
  const byFamily = new Map();

  for (const image of images) {
    const key = imageFamilyKey(image.url);
    if (!byFamily.has(key)) {
      byFamily.set(key, []);
    }
    byFamily.get(key).push(image);
  }

  const families = [];
  for (const [familyKey, variants] of byFamily) {
    const isLogoFamily = variants.some((candidate) => /\.svg(\?|$)/i.test(candidate.url));
    const candidates = sortCandidateVariants(variants, isLogoFamily);
    const representative = pickRepresentativeCandidate(candidates, isLogoFamily);

    if (!representative) {
      continue;
    }

    const keywords = candidateKeywords(
      representative.url,
      representative.alt,
      representative.context?.heading,
      representative.context?.paragraph,
      representative.context?.text,
      (representative.context?.links || []).map((link) => `${link.text || ''} ${link.href || ''}`).join(' '),
    );

    const scores = scoreCandidate({
      ...representative,
      keywords,
      index: Math.min(...candidates.map((candidate) => candidate.index ?? 0)),
    });

    families.push({
      familyKey,
      contentKey: buildContentKey(representative),
      representative,
      candidates,
      keywords,
      scores,
      variationCount: candidates.length,
    });
  }

  return families.sort((left, right) => topScore(right) - topScore(left));
}

function buildContentKey(candidate) {
  const raw = normalizeWhitespace([
    candidate?.context?.heading,
    candidate?.context?.paragraph,
    candidate?.alt,
    (candidate?.context?.links || []).map((link) => link.text).join(' '),
  ].filter(Boolean).join(' '));

  if (!raw) {
    return imageFamilyKey(candidate?.url || '');
  }

  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function scoreCandidate(candidate) {
  const keywords = candidate.keywords || '';
  const url = String(candidate.url || '').toLowerCase();
  const landscapeScore = scoreLandscape(candidate);
  const topOfPageBonus = Math.max(0, 24 - (candidate.index || 0) * 4);

  const isSvg = /\.svg(\?|$)/i.test(url);
  const isLikelyLogoUrl = /\/logo|\/logos\/|\/wordmark|\/brand-mark|\/header\/|\/icons\//.test(url);
  const isCookieBannerAsset =
    /onetrust|cookielaw|cookie-consent|cookiebot|cybot|qc-cmp|didomi|trustarc|consent[-_/]/i.test(url);
  const isFavicon = /favicon|apple-touch|android-chrome|powered_by/i.test(url);
  const isTrustBadge =
    /norton[-_]?certificate|sello[-_]?confianza|trust[-_]?badge|secure[-_]?(seal|badge)|verisign|mcafee[-_]?secure|ssl[-_]?certificate/i.test(
      url,
    );
  const isTinyImg =
    Number.isFinite(candidate.width) && Number.isFinite(candidate.height) &&
    candidate.width > 0 && candidate.height > 0 &&
    candidate.width < 240 && candidate.height < 240;

  // For non-logo slots, SVGs and known logo/icon URLs are almost always wrong.
  const nonLogoPenalty =
    (isSvg ? -60 : 0) +
    (isLikelyLogoUrl ? -45 : 0) +
    (isCookieBannerAsset ? -200 : 0) +
    (isFavicon ? -120 : 0) +
    (isTrustBadge ? -200 : 0) +
    (isTinyImg ? -30 : 0);

  return {
    logo:
      topOfPageBonus +
      landscapeScore * -0.15 +
      (candidate.inHeader ? 60 : 0) +
      keywordScore(keywords, ['logo', 'brand', 'wordmark', 'header'], 40) +
      (isSvg ? 30 : 0) +
      (isLikelyLogoUrl ? 25 : 0) +
      (isCookieBannerAsset ? -200 : 0) +
      (isFavicon ? -100 : 0) +
      keywordScore(keywords, ['hero', 'banner', 'desktop', 'homepage'], -20) +
      keywordScore(keywords, ['icon', 'chevron', 'flexa', 'arrow'], -25) +
      keywordScore(keywords, ['certificate', 'badge', 'powered_by', 'norton'], -150),
    hero:
      landscapeScore +
      topOfPageBonus +
      nonLogoPenalty +
      keywordScore(keywords, ['hero', 'banner', 'homepage', 'desktop', '_desktop', 'carousel', 'slider'], 22) +
      keywordScore(keywords, ['.mp4', '.webm', 'video', 'movie'], -100) +
      keywordScore(
        keywords,
        [
          'mobile',
          '_mobile',
          'portrait',
          'logo',
          'icon',
          'new',
          'arrival',
          'noved',
          'women',
          'mujer',
          'men',
          'hombre',
          'chevron',
          'flexa',
        ],
        -18,
      ),
    newArrivals:
      landscapeScore +
      nonLogoPenalty +
      keywordScore(keywords, ['.mp4', '.webm', 'video', 'movie'], -100) +
      keywordScore(
        keywords,
        ['new', 'arrivals', 'latest', 'season', 'collection', 'noved', 'just in', 'sneaker', 'launch', 'categor'],
        18,
      ) +
      keywordScore(keywords, ['mobile', '_mobile', 'logo', 'icon', 'chevron', 'flexa', 'arrow', 'breadcrumb'], -25),
    women:
      landscapeScore +
      nonLogoPenalty +
      keywordScore(keywords, ['.mp4', '.webm', 'video', 'movie'], -100) +
      keywordScore(keywords, ['women', 'woman', 'mujer', 'female', 'ladies', 'girl', 'nina'], 30) +
      keywordScore(keywords, ['men', 'man', 'hombre', 'boy', 'nino'], -12),
    men:
      landscapeScore +
      nonLogoPenalty +
      keywordScore(keywords, ['.mp4', '.webm', 'video', 'movie'], -100) +
      keywordScore(keywords, ['men', 'man', 'hombre', 'male', 'boy', 'nino'], 30) +
      keywordScore(keywords, ['women', 'woman', 'mujer', 'girl', 'nina'], -12),
  };
}

function scoreLandscape(candidate) {
  let score = 0;
  if (candidate.width && candidate.height) {
    score += candidate.width >= candidate.height ? 18 : -10;
    if (candidate.width / Math.max(candidate.height, 1) >= 1.45) {
      score += 12;
    }
  }
  const keywords = candidate.keywords || '';
  score += keywordScore(keywords, ['desktop', '_desktop', 'landscape', 'banner'], 18);
  score += keywordScore(keywords, ['mobile', '_mobile', 'portrait'], -22);
  return score;
}

function keywordScore(input, terms, scorePerHit) {
  const str = typeof input === 'string' ? input : '';
  return terms.reduce((total, term) => total + (str.includes(term) ? scorePerHit : 0), 0);
}

function topScore(family) {
  return Math.max(...Object.values(family.scores));
}

function normalizeOverrides(overrides) {
  const rawSlots = overrides?.slots && typeof overrides.slots === 'object' ? overrides.slots : {};
  const slots = {};

  for (const [slotKey, rawIndex] of Object.entries(rawSlots)) {
    if (!SLOT_KEYS.has(slotKey)) {
      continue;
    }

    const index = Number(rawIndex);
    if (Number.isInteger(index) && index >= 0) {
      slots[slotKey] = index;
    }
  }

  return { slots };
}

function buildCandidateLookup(families) {
  const byIndex = new Map();

  for (const family of families) {
    for (const candidate of family.candidates) {
      byIndex.set(candidate.index, {
        candidate,
        family,
      });
    }
  }

  return byIndex;
}

function selectFromFamilies(families, options = {}) {
  const overrides = normalizeOverrides(options.overrides);
  const lookup = buildCandidateLookup(families);
  const assignments = {};
  const usedFamilies = new Set();
  const usedContentKeys = new Set();

  for (const slot of SLOT_DEFINITIONS) {
    const overrideIndex = overrides.slots[slot.key];
    if (overrideIndex === undefined) {
      continue;
    }

    const selected = lookup.get(overrideIndex);
    if (!selected) {
      continue;
    }

    assignCandidate(assignments, slot.key, selected, true, usedFamilies, usedContentKeys);
  }

  for (const slot of SLOT_DEFINITIONS) {
    if (assignments[slot.key]) {
      continue;
    }

    const selected = pickBestByFamily(families, slot.scoreKeys, usedFamilies, usedContentKeys);
    if (!selected) {
      continue;
    }

    assignCandidate(
      assignments,
      slot.key,
      {
        candidate: selected.representative,
        family: selected,
      },
      false,
      usedFamilies,
      usedContentKeys,
    );
  }

  return assignments;
}

function assignCandidate(assignments, slotKey, selection, overridden, usedFamilies, usedContentKeys) {
  assignments[slotKey] = {
    ...selection,
    overridden,
  };

  if (selection.family?.familyKey) {
    usedFamilies.add(selection.family.familyKey);
  }

  if (selection.family?.contentKey) {
    usedContentKeys.add(selection.family.contentKey);
  }
}

function pickBestByFamily(families, scoreKeys, usedFamilies, usedContentKeys) {
  const sorted = [...families].sort(
    (left, right) => rankFamily(right, scoreKeys) - rankFamily(left, scoreKeys),
  );

  const distinctFamilyAndContent = sorted.find(
    (family) => !usedFamilies.has(family.familyKey) && !usedContentKeys.has(family.contentKey),
  );
  if (distinctFamilyAndContent) {
    return distinctFamilyAndContent;
  }

  const distinctFamily = sorted.find((family) => !usedFamilies.has(family.familyKey));
  if (distinctFamily) {
    return distinctFamily;
  }

  return sorted[0] || null;
}

function rankFamily(family, scoreKeys) {
  return scoreKeys.reduce((total, key, index) => {
    const weight = index === 0 ? 100 : 10;
    return total + (family.scores[key] || 0) * weight;
  }, topScore(family));
}

function buildSelections(assignments) {
  return {
    logo: assignments.logo?.candidate || null,
    heroSlides: [
      assignments['hero.slide1']?.candidate,
      assignments['hero.slide2']?.candidate,
      assignments['hero.slide3']?.candidate,
    ].filter(Boolean),
    women: assignments['featured.women']?.candidate || null,
    men: assignments['featured.men']?.candidate || null,
    newArrivals: assignments.newArrivals?.candidate || null,
  };
}

function buildSlotAssignments(assignments) {
  return Object.fromEntries(
    SLOT_DEFINITIONS.map((slot) => {
      const assignment = assignments[slot.key];

      return [
        slot.key,
        {
          label: slot.label,
          index: assignment?.candidate?.index ?? null,
          familyKey: assignment?.family?.familyKey ?? null,
          contentKey: assignment?.family?.contentKey ?? null,
          overridden: Boolean(assignment?.overridden),
        },
      ];
    }),
  );
}

function buildContent({ assignments, metadata, pageUrl, displayName }) {
  const slide1 = buildImageSlot(assignments['hero.slide1']?.candidate, {
    fallbackTitle: `${displayName} 1`,
    fallbackCtaText: DEFAULTS.heroCtaText,
    fallbackLink: pageUrl,
    allowSubtitle: true,
  });
  const slide2 = buildImageSlot(assignments['hero.slide2']?.candidate, {
    fallbackTitle: `${displayName} 2`,
    fallbackCtaText: DEFAULTS.heroCtaText,
    fallbackLink: pageUrl,
    allowSubtitle: true,
  });
  const slide3 = buildImageSlot(assignments['hero.slide3']?.candidate, {
    fallbackTitle: `${displayName} 3`,
    fallbackCtaText: DEFAULTS.heroCtaText,
    fallbackLink: pageUrl,
    allowSubtitle: true,
  });
  const women = buildImageSlot(assignments['featured.women']?.candidate, {
    fallbackTitle: 'Women',
    fallbackCtaText: DEFAULTS.featureCtaText,
    fallbackLink: pageUrl,
    allowSubtitle: true,
  });
  const men = buildImageSlot(assignments['featured.men']?.candidate, {
    fallbackTitle: 'Men',
    fallbackCtaText: DEFAULTS.featureCtaText,
    fallbackLink: pageUrl,
    allowSubtitle: true,
  });
  const newArrivals = buildImageSlot(assignments.newArrivals?.candidate, {
    fallbackTitle: 'New Arrivals',
    fallbackCtaText: DEFAULTS.heroCtaText,
    fallbackLink: pageUrl,
    allowSubtitle: true,
  });

  return {
    hero: {
      slide1,
      slide2,
      slide3,
      // Storefront Next v0.3 home uses four hero slides; generated runs only assign three slots.
      slide4: { ...slide3 },
    },
    featuredProducts: { title: DEFAULTS.featuredProductsTitle },
    newArrivals: {
      title: newArrivals.title,
      description: newArrivals.subtitle,
      ctaText: newArrivals.ctaText,
      ctaLink: newArrivals.ctaLink,
      imageUrl: newArrivals.imageUrl,
      imageAlt: newArrivals.imageAlt,
    },
    categoryGrid: { title: DEFAULTS.browseTitle, shopNowButton: DEFAULTS.browseCtaText },
    featuredContent: {
      women: {
        title: women.title,
        description: women.subtitle,
        ctaText: women.ctaText,
        ctaLink: women.ctaLink,
        imageUrl: women.imageUrl,
        imageAlt: women.imageAlt,
      },
      men: {
        title: men.title,
        description: men.subtitle,
        ctaText: men.ctaText,
        ctaLink: men.ctaLink,
        imageUrl: men.imageUrl,
        imageAlt: men.imageAlt,
      },
    },
    pageTitle: metadata?.title || `${displayName} Store`,
    pageDescription: metadata?.description || `Welcome to ${displayName}.`,
  };
}

function buildImageSlot(candidate, options) {
  if (!candidate) {
    return {
      title: options.fallbackTitle,
      subtitle: options.allowSubtitle ? `Discover ${options.fallbackTitle}.` : '',
      ctaText: options.fallbackCtaText,
      ctaLink: sanitizeLink(options.fallbackLink),
      imageUrl: '',
      imageAlt: options.fallbackTitle,
    };
  }

  const title = firstMeaningful([
    candidate.context?.heading,
    candidate.alt,
    options.fallbackTitle,
  ]);
  const subtitle = options.allowSubtitle
    ? firstMeaningful([
        candidate.context?.paragraph,
        candidate.context?.headings?.[1],
        candidate.context?.text,
        `Discover ${title}.`,
      ])
    : null;
  const cta = firstRelevantLink(candidate.context?.links) || {};
  const ctaText = cta.text || options.fallbackCtaText;
  const ctaLink = sanitizeLink(cta.href || options.fallbackLink);

  return {
    title,
    subtitle: truncate(subtitle || '', 180),
    ctaText,
    ctaLink,
    imageUrl: candidate.url || '',
    imageAlt: candidate.alt || title,
  };
}

// Banner / consent / utility copy fragments that should never end up in hero titles.
const NOISE_PATTERNS = [
  /remember (my |your )?selection/i,
  /click here/i,
  /accept (all )?cookies/i,
  /aceptar (todas? )?(las )?cookies/i,
  /cookie policy/i,
  /pol[ií]tica de (privacidad|cookies)/i,
  /privacy policy/i,
  /change your (region|country|language)/i,
  /select your (country|region|language|preferred|preferencias)/i,
  /change region/i,
  /skip to (content|main)/i,
  /^select$/i,
  /^aceptar$/i,
  /^continue$/i,
  /^continuar$/i,
  /shipping to/i,
  /env[íi]os a/i,
  /sign in/i,
  /iniciar sesi[oó]n/i,
  /add to cart/i,
  /a[ñn]adir al carrito/i,
  /^https?:\/\//i, // a URL leaked into a title
  /^[a-z0-9_-]+\.(jpg|jpeg|png|webp|svg|gif)$/i, // a filename leaked into a title
];

function isNoiseText(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return true;
  if (trimmed.length > 220) return true;
  if (trimmed.length < 3) return true;
  return NOISE_PATTERNS.some((re) => re.test(trimmed));
}

function firstMeaningful(values) {
  return (
    values
      .map((value) => normalizeWhitespace(value))
      .find((value) => value && value.length > 0 && !isNoiseText(value)) || ''
  );
}

function firstRelevantLink(links = []) {
  return (links || []).find((link) => {
    const text = normalizeWhitespace(link.text || '').toLowerCase();
    if (!text || text.length > 30) return false;
    if (['search', 'menu', 'close'].includes(text)) return false;
    if (isNoiseText(text)) return false;
    return true;
  });
}

function sanitizeLink(rawLink) {
  if (!rawLink) {
    return '/';
  }

  try {
    const url = new URL(rawLink);
    return `${url.pathname}${url.search}` || '/';
  } catch {
    return rawLink.startsWith('/') ? rawLink : '/';
  }
}

/**
 * From scrape payload (full page JSON with images + metadata), select 7 distinct slots
 * and build content. Returns { brandId, displayName, selections, content, source, imageCandidateCount, familyCount }.
 */
export function selectFromScrapePayload(payload, options = {}) {
  const { brandId, displayName, overrides } = options;
  const images = payload.images || [];
  const metadata = payload.metadata || {};
  const pageUrl = payload.finalUrl || payload.requestedUrl || '';
  const requestedUrl = payload.requestedUrl || pageUrl;

  const effectiveDisplayName =
    displayName ||
    metadata.siteName ||
    deriveDisplayName(metadata.title, requestedUrl) ||
    titleCase(brandId || 'Brand');
  const effectiveBrandId = brandId || slugify(effectiveDisplayName);

  const families = buildFamilies(images);
  const assignments = selectFromFamilies(families, {
    overrides,
  });
  const selections = buildSelections(assignments);
  const content = buildContent({
    assignments,
    metadata,
    pageUrl,
    displayName: effectiveDisplayName,
  });

  return {
    brandId: effectiveBrandId,
    displayName: effectiveDisplayName,
    selections,
    content,
    families,
    slotAssignments: buildSlotAssignments(assignments),
    source: {
      requestedUrl,
      finalUrl: pageUrl,
      fetchedAt: new Date().toISOString(),
    },
    imageCandidateCount: images.length,
    familyCount: families.length,
  };
}

function deriveDisplayName(title, requestedUrl) {
  if (title) {
    const fromTitle = title.split(/[|\-–·]/)[0];
    if (normalizeWhitespace(fromTitle)) {
      return normalizeWhitespace(fromTitle);
    }
  }

  try {
    return new URL(requestedUrl).hostname.replace(/^www\./, '').split('.')[0];
  } catch {
    return 'Brand';
  }
}
