import { fileExists, readTextFile, writeTextFile } from './fs.js';

export function buildEmptyOverrides() {
  return {
    slots: {},
  };
}

export async function ensureOverridesFile(filePath) {
  if (!filePath) {
    return null;
  }

  if (await fileExists(filePath)) {
    return filePath;
  }

  await writeTextFile(filePath, `${JSON.stringify(buildEmptyOverrides(), null, 2)}\n`);
  return filePath;
}

export async function loadOverridesFile(filePath) {
  if (!filePath) {
    return null;
  }

  if (!(await fileExists(filePath))) {
    return buildEmptyOverrides();
  }

  const raw = await readTextFile(filePath);
  if (!raw.trim()) {
    return buildEmptyOverrides();
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Could not parse overrides JSON at ${filePath}: ${error.message}`);
  }
}
