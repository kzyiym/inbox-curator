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
