import { writeTextFile } from './fs.js';
import { buildPreviewHtml, buildPreviewOutputPath } from './preview.js';

export function formatJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export async function writeJsonArtifact(jsonPath, payload, options = {}) {
  const previewHtmlPath =
    options.writePreview === false ? null : options.previewHtmlPath || buildPreviewOutputPath(jsonPath);
  const writes = [writeTextFile(jsonPath, formatJson(payload))];

  if (previewHtmlPath) {
    writes.push(writeTextFile(previewHtmlPath, buildPreviewHtml(payload)));
  }

  await Promise.all(writes);

  return {
    jsonPath,
    previewHtmlPath,
  };
}
