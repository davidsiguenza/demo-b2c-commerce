import { fetchText } from './fetch-page.js';
import { uniq } from './strings.js';

const TOKEN_CANDIDATES = {
  primary: ['--primary', '--primary-color', '--color-primary', '--brand-primary', '--accent-color'],
  background: ['--background', '--background-color', '--color-background', '--surface', '--page-bg'],
  foreground: ['--foreground', '--text-color', '--color-text', '--copy-color', '--body-color'],
  accent: ['--accent', '--secondary', '--color-secondary', '--brand-secondary'],
  border: ['--border', '--border-color', '--line-color'],
};

const OVERRIDABLE_TOKEN_KEYS = [
  'primary',
  'primaryForeground',
  'background',
  'foreground',
  'accent',
  'accentForeground',
  'border',
  'ring',
];

export async function extractBrandTokens($, pageUrl, stylesheetUrls, inlineStyles) {
  const stylesheets = await Promise.all(stylesheetUrls.slice(0, 5).map((url) => fetchText(url)));
  const cssBlobs = [...inlineStyles, ...stylesheets.filter(Boolean)];
  const variableMap = new Map();
  const palette = [];

  for (const css of cssBlobs) {
    collectCssVariables(css, variableMap);
    palette.push(...collectColorLiterals(css));
  }

  const uniquePalette = uniq(palette.map(normalizeColor).filter(Boolean));

  const primary = pickVariable(variableMap, TOKEN_CANDIDATES.primary) || pickVivid(uniquePalette) || '#111111';
  const background =
    pickVariable(variableMap, TOKEN_CANDIDATES.background) || pickLight(uniquePalette) || '#ffffff';
  const foreground =
    pickVariable(variableMap, TOKEN_CANDIDATES.foreground) || readableTextFor(background);
  const accent = pickVariable(variableMap, TOKEN_CANDIDATES.accent) || mix(primary, background, 0.15);
  const border = pickVariable(variableMap, TOKEN_CANDIDATES.border) || mix(foreground, background, 0.12);

  return {
    primary,
    primaryForeground: readableTextFor(primary),
    accent,
    accentForeground: readableTextFor(accent),
    background,
    foreground,
    border,
    ring: primary,
    sourcePalette: uniquePalette.slice(0, 12),
  };
}

export function mergeBrandTokenOverrides(baseTokens, overrides) {
  if (!overrides || typeof overrides !== 'object') {
    return baseTokens;
  }

  const merged = {
    ...baseTokens,
  };
  const applied = new Set();

  OVERRIDABLE_TOKEN_KEYS.forEach((key) => {
    const normalized = normalizeColor(overrides[key]);
    if (normalized) {
      merged[key] = normalized;
      applied.add(key);
    }
  });

  if (applied.has('background') && !applied.has('foreground')) {
    merged.foreground = readableTextFor(merged.background);
  }

  if (applied.has('primary') && !applied.has('primaryForeground')) {
    merged.primaryForeground = readableTextFor(merged.primary);
  }

  if (applied.has('accent') && !applied.has('accentForeground')) {
    merged.accentForeground = readableTextFor(merged.accent);
  }

  if (applied.has('primary') && !applied.has('ring')) {
    merged.ring = merged.primary;
  }

  if ((applied.has('background') || applied.has('foreground')) && !applied.has('border')) {
    merged.border = mix(merged.foreground, merged.background, 0.12);
  }

  return merged;
}

function collectCssVariables(css, variableMap) {
  const regex = /(--[a-z0-9-_]+)\s*:\s*([^;]+);/gi;
  for (const match of css.matchAll(regex)) {
    const name = match[1].toLowerCase();
    const color = normalizeColor(match[2]);
    if (color) {
      variableMap.set(name, color);
    }
  }
}

function collectColorLiterals(css) {
  const matches = [];

  for (const match of css.matchAll(/#[0-9a-f]{3,8}\b/gi)) {
    matches.push(match[0]);
  }

  for (const match of css.matchAll(/rgba?\(([^)]+)\)/gi)) {
    matches.push(match[0]);
  }

  for (const match of css.matchAll(/hsla?\(([^)]+)\)/gi)) {
    matches.push(match[0]);
  }

  return matches;
}

function pickVariable(variableMap, names) {
  for (const name of names) {
    const match = variableMap.get(name);
    if (match) {
      return match;
    }
  }

  return null;
}

function pickVivid(palette) {
  return palette.find((color) => {
    const { saturation, lightness } = rgbToHsl(hexToRgb(color));
    return saturation >= 0.3 && lightness >= 0.2 && lightness <= 0.7;
  });
}

function pickLight(palette) {
  return palette.find((color) => {
    const { lightness } = rgbToHsl(hexToRgb(color));
    return lightness >= 0.9;
  });
}

export function normalizeColor(value) {
  if (!value) {
    return null;
  }

  const trimmed = String(value).trim().toLowerCase();

  if (/^#[0-9a-f]{3}$/.test(trimmed)) {
    return `#${trimmed.slice(1).split('').map((char) => char + char).join('')}`;
  }

  if (/^#[0-9a-f]{6}$/.test(trimmed)) {
    return trimmed;
  }

  const rgb = trimmed.match(/^rgba?\(([^)]+)\)$/);
  if (rgb) {
    const [red, green, blue] = rgb[1]
      .split(',')
      .slice(0, 3)
      .map((part) => Number.parseFloat(part.trim()));

    if ([red, green, blue].every(Number.isFinite)) {
      return rgbToHex({ red, green, blue });
    }
  }

  const hsl = trimmed.match(/^hsla?\(([^)]+)\)$/);
  if (hsl) {
    const [hue, saturation, lightness] = hsl[1]
      .split(',')
      .slice(0, 3)
      .map((part) => Number.parseFloat(part));

    if ([hue, saturation, lightness].every(Number.isFinite)) {
      const rgbColor = hslToRgb({
        hue,
        saturation: saturation / 100,
        lightness: lightness / 100,
      });
      return rgbToHex(rgbColor);
    }
  }

  return null;
}

function rgbToHex({ red, green, blue }) {
  return `#${[red, green, blue]
    .map((channel) => clampChannel(channel).toString(16).padStart(2, '0'))
    .join('')}`;
}

function hexToRgb(hex) {
  const normalized = hex.replace('#', '');
  return {
    red: Number.parseInt(normalized.slice(0, 2), 16),
    green: Number.parseInt(normalized.slice(2, 4), 16),
    blue: Number.parseInt(normalized.slice(4, 6), 16),
  };
}

function hslToRgb({ hue, saturation, lightness }) {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const segment = (hue / 60) % 6;
  const second = chroma * (1 - Math.abs((segment % 2) - 1));
  const lightnessMatch = lightness - chroma / 2;

  let red = 0;
  let green = 0;
  let blue = 0;

  if (segment >= 0 && segment < 1) {
    red = chroma;
    green = second;
  } else if (segment < 2) {
    red = second;
    green = chroma;
  } else if (segment < 3) {
    green = chroma;
    blue = second;
  } else if (segment < 4) {
    green = second;
    blue = chroma;
  } else if (segment < 5) {
    red = second;
    blue = chroma;
  } else {
    red = chroma;
    blue = second;
  }

  return {
    red: (red + lightnessMatch) * 255,
    green: (green + lightnessMatch) * 255,
    blue: (blue + lightnessMatch) * 255,
  };
}

function rgbToHsl({ red, green, blue }) {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const lightness = (max + min) / 2;

  if (delta === 0) {
    return { hue: 0, saturation: 0, lightness };
  }

  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  let hue = 0;

  if (max === r) {
    hue = 60 * (((g - b) / delta) % 6);
  } else if (max === g) {
    hue = 60 * ((b - r) / delta + 2);
  } else {
    hue = 60 * ((r - g) / delta + 4);
  }

  if (hue < 0) {
    hue += 360;
  }

  return { hue, saturation, lightness };
}

function readableTextFor(backgroundHex) {
  const { red, green, blue } = hexToRgb(backgroundHex);
  const luminance = [red, green, blue]
    .map((value) => {
      const channel = value / 255;
      return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    })
    .reduce(
      (sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index],
      0,
    );

  return luminance > 0.5 ? '#111111' : '#ffffff';
}

function mix(colorA, colorB, weight = 0.5) {
  const left = hexToRgb(colorA);
  const right = hexToRgb(colorB);
  return rgbToHex({
    red: left.red * (1 - weight) + right.red * weight,
    green: left.green * (1 - weight) + right.green * weight,
    blue: left.blue * (1 - weight) + right.blue * weight,
  });
}

function clampChannel(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}
