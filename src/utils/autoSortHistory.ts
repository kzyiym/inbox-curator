import { App, normalizePath } from 'obsidian';
import { ensureDotFolder } from './folder';
import type { ReviewMode, ReviewReliabilityLabel } from '../types';
import type { ReviewJobSource } from '../queue/queueTypes';
import type { ReviewParseStatus, ReviewConfidence } from '../reviewNormalizer';

const HISTORY_PATH = normalizePath('.inbox-curator/auto-sort-history.json');
const MAX_AUTO_SORT_HISTORY_RUNS = 20;
const AUTO_SORT_HISTORY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Durable identity guard recorded at move time so Undo can prove that the file
 * currently at a recorded destination is the same file that was moved.
 *
 * `ctime` is Obsidian's file creation time (Stat.ctime). It is stable across
 * renames, so a file created to replace the moved note at the same path has a
 * different creation time and is rejected. On a platform that refreshes ctime
 * on edit, an edited original is skipped rather than moved: fail closed with a
 * visible reason. A missing or non-finite value means identity could not be
 * captured, and such records are treated as unverifiable.
 */
export type AutoSortFileIdentity = {
  ctime: number;
};

export type AutoSortActionRecord = {
  runId: string;
  timestamp: number;
  action: 'archive' | 'read_later' | 'task' | 'delete_candidate';
  sourcePath: string;
  destinationPath: string;
  reviewMode: ReviewMode;
  parseStatus: ReviewParseStatus;
  confidence: ReviewConfidence;
  reliabilityLabel: ReviewReliabilityLabel;
  /**
   * Identity of the file at `destinationPath` immediately after the move.
   * Optional: records written before identity tracking have no value and are
   * treated as unverifiable (skipped, never moved by path alone).
   */
  identity?: AutoSortFileIdentity;
};

/**
 * Capture the durable identity for a file. Returns undefined when the runtime
 * does not expose a usable creation time, so callers never store a partial or
 * misleading guard.
 */
export function captureAutoSortIdentity(
  file: { stat?: { ctime?: number } } | null | undefined,
): AutoSortFileIdentity | undefined {
  const ctime = file?.stat?.ctime;
  if (typeof ctime !== 'number' || !Number.isFinite(ctime)) {
    return undefined;
  }
  return { ctime };
}

/**
 * True only when a recorded identity and the file's current identity are both
 * present and equal. Missing identity on either side returns false so callers
 * fail closed instead of moving an unverifiable file.
 */
export function autoSortIdentityMatches(
  identity: AutoSortFileIdentity | undefined,
  file: { stat?: { ctime?: number } } | null | undefined,
): boolean {
  if (!identity) {
    return false;
  }
  const ctime = file?.stat?.ctime;
  return typeof ctime === 'number' && Number.isFinite(ctime) && ctime === identity.ctime;
}

export type AutoSortRunRecord = {
  runId: string;
  timestamp: number;
  source: ReviewJobSource;
  actions: AutoSortActionRecord[];
  undone?: boolean;
  undoneAt?: number;
};

export type AutoSortHistoryFile = {
  version: 1;
  runs: AutoSortRunRecord[];
};

function defaultHistory(): AutoSortHistoryFile {
  return { version: 1, runs: [] };
}

export async function loadAutoSortHistory(app: App): Promise<AutoSortHistoryFile> {
  const adapter = app.vault.adapter;
  if (!adapter) return defaultHistory();
  try {
    if (await adapter.exists(HISTORY_PATH)) {
      const raw = await adapter.read(HISTORY_PATH);
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (parsed && typeof parsed === 'object' && parsed.version === 1 && Array.isArray(parsed.runs)) {
        return parsed as AutoSortHistoryFile;
      }
    }
  } catch {
    // ignore corrupt or missing files
  }
  return defaultHistory();
}

export async function saveAutoSortHistory(app: App, history: AutoSortHistoryFile): Promise<void> {
  const adapter = app.vault.adapter;
  if (!adapter) return;
  await ensureDotFolder(app, normalizePath('.inbox-curator'));
  await adapter.write(HISTORY_PATH, JSON.stringify(history, null, 2));
}

export function pruneAutoSortHistory(
  history: AutoSortHistoryFile,
  now?: number,
): AutoSortHistoryFile {
  const cutoff = (now ?? Date.now()) - AUTO_SORT_HISTORY_RETENTION_MS;
  const filtered = history.runs.filter((r) => r.timestamp >= cutoff);
  const sorted = filtered.sort((a, b) => b.timestamp - a.timestamp);
  const kept = sorted.slice(0, MAX_AUTO_SORT_HISTORY_RUNS);
  return { ...history, runs: kept };
}

export async function appendAutoSortActionRecord(
  app: App,
  record: AutoSortActionRecord,
): Promise<void> {
  const history = await loadAutoSortHistory(app);
  const existingRun = history.runs.find((r) => r.runId === record.runId && !r.undone);

  if (existingRun) {
    existingRun.actions.push(record);
    existingRun.timestamp = Math.max(existingRun.timestamp, record.timestamp);
  } else {
    history.runs.push({
      runId: record.runId,
      timestamp: record.timestamp,
      source: 'auto-create',
      actions: [record],
    });
  }

  const pruned = pruneAutoSortHistory(history);
  // Re-sort by timestamp descending after append
  pruned.runs.sort((a, b) => b.timestamp - a.timestamp);
  await saveAutoSortHistory(app, pruned);
}

export async function getLastUndoableAutoSortRun(app: App): Promise<AutoSortRunRecord | null> {
  const history = await loadAutoSortHistory(app);
  const sorted = [...history.runs].sort((a, b) => b.timestamp - a.timestamp);
  return sorted.find((r) => !r.undone && r.actions.length > 0) ?? null;
}

export async function markAutoSortRunUndone(
  app: App,
  runId: string,
  undoneAt?: number,
): Promise<void> {
  const history = await loadAutoSortHistory(app);
  const run = history.runs.find((r) => r.runId === runId);
  if (run) {
    run.undone = true;
    run.undoneAt = undoneAt ?? Date.now();
    await saveAutoSortHistory(app, history);
  }
}
