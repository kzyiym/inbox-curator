import { describe, it, expect, vi, beforeEach } from 'vitest';
import { normalizePath } from 'obsidian';
import {
  loadAutoSortHistory,
  saveAutoSortHistory,
  appendAutoSortActionRecord,
  getLastUndoableAutoSortRun,
  markAutoSortRunUndone,
  updateAutoSortRunUndoProgress,
  pruneAutoSortHistory,
  type AutoSortActionRecord,
  type AutoSortHistoryFile,
} from '../src/utils/autoSortHistory';

const HISTORY_PATH = normalizePath('.inbox-curator/auto-sort-history.json');

const NOW = Date.now();

const sampleRecord: AutoSortActionRecord = {
  runId: 'run-test-1',
  timestamp: NOW - 1000,
  action: 'archive',
  sourcePath: 'Inbox/test.md',
  destinationPath: 'Archive/test.md',
  reviewMode: 'standard',
  parseStatus: 'parsed',
  confidence: 'high',
  reliabilityLabel: 'high',
};

function createMockApp() {
  const files = new Map<string, string>();
  const adapter = {
    exists: vi.fn(async (path: string) => files.has(path)),
    read: vi.fn(async (path: string) => files.get(path) ?? ''),
    write: vi.fn(async (path: string, data: string) => { files.set(path, data); }),
    remove: vi.fn(async (path: string) => { files.delete(path); }),
    mkdir: vi.fn(async (path: string) => { files.set(path, ''); }),
  };
  const vault = {
    adapter,
    getAbstractFileByPath: vi.fn((path: string) => null),
    createFolder: vi.fn(async (path: string) => { files.set(path, ''); }),
  };
  return { vault, metadataCache: { getFileCache: vi.fn() } } as any;
}

describe('autoSortHistory', () => {
  let app: any;

  beforeEach(() => {
    app = createMockApp();
  });

  it('loads empty history when file does not exist', async () => {
    const history = await loadAutoSortHistory(app);
    expect(history.version).toBe(1);
    expect(history.runs).toEqual([]);
  });

  it('loads empty history when file is corrupt', async () => {
    app.vault.adapter.write(HISTORY_PATH, 'not json');
    const history = await loadAutoSortHistory(app);
    expect(history.version).toBe(1);
    expect(history.runs).toEqual([]);
  });

  it('saves and loads history correctly', async () => {
    const history: AutoSortHistoryFile = { version: 1, runs: [] };
    await saveAutoSortHistory(app, history);
    // Must not use Vault API for dot-folder
    expect(app.vault.createFolder).not.toHaveBeenCalled();
    expect(app.vault.getAbstractFileByPath).not.toHaveBeenCalled();
    const loaded = await loadAutoSortHistory(app);
    expect(loaded.version).toBe(1);
    expect(loaded.runs).toEqual([]);
  });

  it('loads existing version 1 history records', async () => {
    await app.vault.adapter.write(HISTORY_PATH, JSON.stringify({
      version: 1,
      runs: [{
        runId: 'legacy-run',
        timestamp: NOW - 2000,
        source: 'auto-create',
        actions: [sampleRecord],
      }],
    }));

    const loaded = await loadAutoSortHistory(app);
    expect(loaded.version).toBe(1);
    expect(loaded.runs[0].actions[0].action).toBe('archive');
  });

  it('appends action record to history', async () => {
    await appendAutoSortActionRecord(app, sampleRecord);
    const history = await loadAutoSortHistory(app);
    expect(history.runs).toHaveLength(1);
    expect(history.runs[0].runId).toBe('run-test-1');
    expect(history.runs[0].actions).toHaveLength(1);
    expect(history.runs[0].actions[0].action).toBe('archive');
  });

  it('appends delete_candidate action records without changing the history version', async () => {
    await appendAutoSortActionRecord(app, {
      ...sampleRecord,
      action: 'delete_candidate',
      destinationPath: 'Delete Candidates/test.md',
    });

    const history = await loadAutoSortHistory(app);
    expect(history.version).toBe(1);
    expect(history.runs[0].actions[0].action).toBe('delete_candidate');
  });

  it('groups actions with same runId into same run', async () => {
    const rec1 = { ...sampleRecord, timestamp: NOW - 500 };
    const rec2 = { ...sampleRecord, timestamp: NOW - 400, action: 'read_later' as const, destinationPath: 'Read Later/test.md' };

    await appendAutoSortActionRecord(app, rec1);
    await appendAutoSortActionRecord(app, rec2);

    const history = await loadAutoSortHistory(app);
    expect(history.runs).toHaveLength(1);
    expect(history.runs[0].actions).toHaveLength(2);
  });

  it('creates separate runs for different runIds', async () => {
    const rec1 = { ...sampleRecord, runId: 'run-a', timestamp: NOW - 500 };
    const rec2 = { ...sampleRecord, runId: 'run-b', timestamp: NOW - 400, action: 'read_later' as const, destinationPath: 'Read Later/test.md' };

    await appendAutoSortActionRecord(app, rec1);
    await appendAutoSortActionRecord(app, rec2);

    const history = await loadAutoSortHistory(app);
    expect(history.runs).toHaveLength(2);
  });

  it('returns last undoable run', async () => {
    const rec1 = { ...sampleRecord, runId: 'run-1', timestamp: NOW - 200 };
    const rec2 = { ...sampleRecord, runId: 'run-2', timestamp: NOW - 100, action: 'read_later' as const, destinationPath: 'Read Later/test.md' };

    await appendAutoSortActionRecord(app, rec1);
    await appendAutoSortActionRecord(app, rec2);

    const last = await getLastUndoableAutoSortRun(app);
    expect(last).not.toBeNull();
    expect(last!.runId).toBe('run-2');
  });

  it('excludes undone runs from last undoable', async () => {
    await appendAutoSortActionRecord(app, { ...sampleRecord, runId: 'run-1', timestamp: NOW - 200 });
    await appendAutoSortActionRecord(app, { ...sampleRecord, runId: 'run-2', timestamp: NOW - 100, action: 'read_later' as const, destinationPath: 'Read Later/test.md' });

    await markAutoSortRunUndone(app, 'run-2');
    const last = await getLastUndoableAutoSortRun(app);
    expect(last).not.toBeNull();
    expect(last!.runId).toBe('run-1');
  });

  it('marks run as undone', async () => {
    await appendAutoSortActionRecord(app, sampleRecord);
    await markAutoSortRunUndone(app, 'run-test-1');

    const history = await loadAutoSortHistory(app);
    expect(history.runs[0].undone).toBe(true);
    expect(history.runs[0].undoneAt).toBeGreaterThan(0);
  });

  it('keeps a run undoable until every action is restored', async () => {
    await appendAutoSortActionRecord(app, { ...sampleRecord, runId: 'run-progress', timestamp: NOW - 200 });
    await appendAutoSortActionRecord(app, {
      ...sampleRecord,
      runId: 'run-progress',
      timestamp: NOW - 100,
      action: 'read_later' as const,
      destinationPath: 'Read Later/test.md',
    });

    const partial = await updateAutoSortRunUndoProgress(app, 'run-progress', [
      { actionIndex: 0, restoredAt: NOW },
    ]);

    expect(partial).not.toBeNull();
    expect(partial!.allResolved).toBe(false);
    expect(partial!.status).toBe('partial');
    expect(partial!.resolvedCount).toBe(1);
    expect(partial!.totalActions).toBe(2);

    const history = await loadAutoSortHistory(app);
    expect(history.runs[0].undone).toBeFalsy();
    expect(history.runs[0].lastUndoStatus).toBe('partial');
    expect(history.runs[0].actions[0].restoredAt).toBe(NOW);
    expect(history.runs[0].actions[1].restoredAt).toBeUndefined();

    const last = await getLastUndoableAutoSortRun(app);
    expect(last).not.toBeNull();
    expect(last!.runId).toBe('run-progress');
  });

  it('marks a run fully undone once every action is restored', async () => {
    await appendAutoSortActionRecord(app, { ...sampleRecord, runId: 'run-complete', timestamp: NOW - 200 });
    await appendAutoSortActionRecord(app, {
      ...sampleRecord,
      runId: 'run-complete',
      timestamp: NOW - 100,
      action: 'read_later' as const,
      destinationPath: 'Read Later/test.md',
    });

    const result = await updateAutoSortRunUndoProgress(app, 'run-complete', [
      { actionIndex: 0, restoredAt: NOW },
      { actionIndex: 1, restoredAt: NOW },
    ]);

    expect(result).not.toBeNull();
    expect(result!.allResolved).toBe(true);
    expect(result!.status).toBe('complete');

    const history = await loadAutoSortHistory(app);
    expect(history.runs[0].undone).toBe(true);
    expect(history.runs[0].lastUndoStatus).toBe('complete');
    expect(history.runs[0].undoneAt).toBeGreaterThan(0);

    const last = await getLastUndoableAutoSortRun(app);
    expect(last).toBeNull();
  });

  it('returns null when recording progress for an unknown run', async () => {
    const result = await updateAutoSortRunUndoProgress(app, 'does-not-exist', []);
    expect(result).toBeNull();
  });

  it('records progress for legacy records that lack the new fields', async () => {
    await app.vault.adapter.write(HISTORY_PATH, JSON.stringify({
      version: 1,
      runs: [{
        runId: 'legacy-undo',
        timestamp: NOW - 10,
        source: 'auto-create',
        actions: [{ ...sampleRecord, runId: 'legacy-undo' }],
      }],
    }));

    const before = await getLastUndoableAutoSortRun(app);
    expect(before).not.toBeNull();
    expect(before!.runId).toBe('legacy-undo');

    const result = await updateAutoSortRunUndoProgress(app, 'legacy-undo', [
      { actionIndex: 0, restoredAt: NOW },
    ]);
    expect(result!.allResolved).toBe(true);

    const history = await loadAutoSortHistory(app);
    expect(history.runs[0].actions[0].restoredAt).toBe(NOW);
    expect(history.runs[0].undone).toBe(true);
    expect(await getLastUndoableAutoSortRun(app)).toBeNull();
  });

  it('prunes runs over the max count', () => {
    const now = 1000000;
    const runs = Array.from({ length: 25 }, (_, i) => ({
      runId: `run-${i}`,
      timestamp: now - i * 1000,
      source: 'auto-create' as const,
      actions: [{ ...sampleRecord, runId: `run-${i}`, timestamp: now - i * 1000 }],
    }));
    const history: AutoSortHistoryFile = { version: 1, runs };
    const pruned = pruneAutoSortHistory(history, now);
    expect(pruned.runs.length).toBeLessThanOrEqual(20);
  });

  it('prunes runs older than 7 days', () => {
    const now = 10000000;
    const recent = { runId: 'run-recent', timestamp: now - 1000, source: 'auto-create' as const, actions: [sampleRecord] };
    const old = { runId: 'run-old', timestamp: now - 8 * 24 * 60 * 60 * 1000, source: 'auto-create' as const, actions: [sampleRecord] };
    const history: AutoSortHistoryFile = { version: 1, runs: [recent, old] };
    const pruned = pruneAutoSortHistory(history, now);
    expect(pruned.runs).toHaveLength(1);
    expect(pruned.runs[0].runId).toBe('run-recent');
  });

  it('does not store note body or raw response in history', () => {
    const recordStr = JSON.stringify(sampleRecord);
    expect(recordStr).not.toContain('noteContent');
    expect(recordStr).not.toContain('rawResponse');
    expect(recordStr).not.toContain('apiKey');
    expect(recordStr).not.toContain('base64');
    expect(recordStr).toContain('sourcePath');
    expect(recordStr).toContain('destinationPath');
  });
});
