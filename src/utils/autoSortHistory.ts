import { App, normalizePath } from 'obsidian';
import { ensureDotFolder } from './folder';
import type { ReviewMode, ReviewReliabilityLabel } from '../types';
import type { ReviewJobSource } from '../queue/queueTypes';
import type { ReviewParseStatus, ReviewConfidence } from '../reviewNormalizer';

const HISTORY_PATH = normalizePath('.inbox-curator/auto-sort-history.json');
const MAX_AUTO_SORT_HISTORY_RUNS = 20;
const AUTO_SORT_HISTORY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export type AutoSortActionRecord = {
  runId: string;
  timestamp: number;
  action: 'archive' | 'read_later' | 'task';
  sourcePath: string;
  destinationPath: string;
  reviewMode: ReviewMode;
  parseStatus: ReviewParseStatus;
  confidence: ReviewConfidence;
  reliabilityLabel: ReviewReliabilityLabel;
};

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
      const parsed = JSON.parse(raw);
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
