export function normalizeWhitespace(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function uniq(values) {
  return [...new Set(values.filter(Boolean))];
}

export function slugify(value) {
  const normalized = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  return normalized
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'brand';
}

export function titleCase(value) {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/\b([a-z])/g, (match) => match.toUpperCase());
}

export function truncate(value, maxLength) {
  const text = normalizeWhitespace(value);

  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 1).trim()}…`;
}

export function candidateKeywords(...parts) {
  return normalizeWhitespace(parts.join(' ')).toLowerCase();
}
