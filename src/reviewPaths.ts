import { normalizePath } from 'obsidian';

export const REVIEW_OUTPUT_SUFFIX = '.ai-review.md';

const MAX_BASENAME_LEN = 72;

export function hashString(value: string): string {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(16).padStart(8, '0');
}

function joinPath(folder: string, fileName: string): string {
  const normalizedFolder = folder ? normalizePath(folder) : '';
  if (!normalizedFolder || normalizedFolder === '.') {
    return normalizePath(fileName);
  }
  return normalizePath(`${normalizedFolder}/${fileName}`);
}

export function buildTruncatedBasename(basename: string): string {
  if (basename.length <= MAX_BASENAME_LEN) {
    return basename;
  }

  const chars = Array.from(basename);
  const shortHash = hashString(basename).slice(0, 8);
  return chars.slice(0, MAX_BASENAME_LEN).join('') + '-' + shortHash;
}

export function buildReviewOutputPath(outputFolder: string, sourcePath: string, sourceBasename: string): string {
  const basename = buildTruncatedBasename(sourceBasename);
  const pathHash = hashString(sourcePath).slice(0, 8);
  return joinPath(outputFolder, `${basename}-${pathHash}${REVIEW_OUTPUT_SUFFIX}`);
}

export function buildLegacyReviewOutputPath(outputFolder: string, sourceBasename: string): string {
  return joinPath(outputFolder, `${buildTruncatedBasename(sourceBasename)}${REVIEW_OUTPUT_SUFFIX}`);
}
