import { App, normalizePath } from 'obsidian';
import type { ReviewDiagnosticCapture } from '../reviewPipeline';
import { ensureDotFolder } from './folder';
import { sanitizeSensitiveData } from './sensitiveData';

export const DIAGNOSTIC_FOLDER = normalizePath('.inbox-curator/diagnostics');

export function getReviewDiagnosticFolderPath(): string {
  return DIAGNOSTIC_FOLDER;
}

export function buildReviewDiagnosticFileName(date: Date, operationId?: string): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  const suffix = operationId ? `-${operationId.replace(/[^A-Za-z0-9_-]/g, '')}` : '';
  return `review-${y}${m}${d}-${hh}${mm}${ss}${suffix}.json`;
}

/**
 * Writes a single diagnostic capture to a local, git-ignored folder.
 * The payload is sanitized to strip data URLs, bearer tokens, and key/value secrets.
 * This never touches the review note, the source note, or auto-sort history.
 */
export const DIAGNOSTIC_FILE_NAME_PATTERN = /^review-[A-Za-z0-9._-]+\.json$/;

export function isReviewDiagnosticFileName(name: string): boolean {
  if (!name || name === '.' || name === '..') return false;
  if (name.includes('/') || name.includes('\\') || name.includes('..')) return false;
  return DIAGNOSTIC_FILE_NAME_PATTERN.test(name);
}

export function isReviewDiagnosticFilePath(path: string): boolean {
  const prefix = `${DIAGNOSTIC_FOLDER}/`;
  if (!path.startsWith(prefix)) return false;
  return isReviewDiagnosticFileName(path.slice(prefix.length));
}

export async function listReviewDiagnosticFiles(app: App): Promise<string[]> {
  let listing: { files?: unknown } | undefined;
  try {
    listing = await app.vault.adapter.list(DIAGNOSTIC_FOLDER);
  } catch {
    return [];
  }
  const files = Array.isArray(listing?.files) ? (listing?.files as string[]) : [];
  return files.filter((path) => isReviewDiagnosticFilePath(path));
}

export async function removeReviewDiagnosticFiles(app: App, paths: readonly string[]): Promise<{ removed: number; failed: number }> {
  let removed = 0;
  let failed = 0;
  for (const path of paths) {
    if (!isReviewDiagnosticFilePath(path)) {
      failed += 1;
      continue;
    }
    try {
      const exists = await app.vault.adapter.exists(path);
      if (!exists) {
        failed += 1;
        continue;
      }
      await app.vault.adapter.remove(path);
      removed += 1;
    } catch {
      failed += 1;
    }
  }
  return { removed, failed };
}

export async function writeReviewDiagnostic(app: App, diagnostic: ReviewDiagnosticCapture): Promise<string> {
  await ensureDotFolder(app, DIAGNOSTIC_FOLDER);
  const capturedAt = new Date(diagnostic.capturedAt);
  const date = Number.isNaN(capturedAt.getTime()) ? new Date() : capturedAt;
  const fileName = buildReviewDiagnosticFileName(date, diagnostic.operationId);
  const path = normalizePath(`${DIAGNOSTIC_FOLDER}/${fileName}`);
  const payload = sanitizeSensitiveData(diagnostic);
  await app.vault.adapter.write(path, JSON.stringify(payload, null, 2));
  return path;
}
