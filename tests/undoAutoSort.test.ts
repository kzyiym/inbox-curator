import { describe, expect, it, vi, beforeEach } from 'vitest';
import { TFile } from 'obsidian';
import type { AutoSortActionRecord, AutoSortRunRecord } from '../src/utils/autoSortHistory';

const mockGetLastUndoable = vi.fn();
const mockMarkUndone = vi.fn();
const mockLogOperation = vi.fn();

vi.mock('../src/utils/autoSortHistory', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/utils/autoSortHistory')>();
  return {
    ...actual,
    getLastUndoableAutoSortRun: mockGetLastUndoable,
    markAutoSortRunUndone: mockMarkUndone,
  };
});

vi.mock('../src/utils/operationLog', () => ({
  logOperation: mockLogOperation,
}));

vi.mock('../src/i18n', () => ({
  t: (key: string, params?: Record<string, unknown>) => {
    const messages: Record<string, string> = {
      'notice.undoNoRun': 'Inbox Curator: No auto-sort run to undo.',
      'notice.undoSuccess': `Inbox Curator: Restored ${params?.count} notes from the last auto-sort run.`,
      'notice.undoPartial': `Inbox Curator: Restored ${params?.restored} notes. ${params?.skipped} could not be restored. See operation log.`,
      'notice.undoFailed': 'Inbox Curator: Auto-sort undo failed. See operation log.',
      'notice.undoSkipIdentityMismatch': 'Identity mismatch at destination: {{path}}',
      'notice.undoSkipLegacyRecord': 'Legacy record without identity: {{path}}',
    };
    let text = messages[key] || key;
    if (params) {
      for (const [name, value] of Object.entries(params)) {
        text = text.replace(`{{${name}}}`, String(value));
      }
    }
    return text;
  },
}));

function makeMockFile(path: string, ctime?: number): TFile {
  const file = new TFile();
  file.path = path;
  file.extension = path.endsWith('.md') ? 'md' : '';
  (file as { stat?: unknown }).stat =
    ctime === undefined ? undefined : { ctime, mtime: ctime, size: 1, type: 'file' };
  return file;
}

function makeAction(overrides: Partial<AutoSortActionRecord> = {}): AutoSortActionRecord {
  return {
    runId: 'run-1',
    timestamp: Date.now() - 1000,
    action: 'archive',
    sourcePath: 'Inbox/test.md',
    destinationPath: 'Archive/test.md',
    reviewMode: 'standard',
    parseStatus: 'parsed',
    confidence: 'high',
    reliabilityLabel: 'high',
    identity: { ctime: 1 },
    ...overrides,
  };
}

function makeRun(runId: string, actions: AutoSortActionRecord[]): AutoSortRunRecord {
  return { runId, timestamp: Date.now() - 1000, source: 'auto-create', actions };
}

function createMockApp() {
  const vaultFiles = new Map<string, TFile>();

  const app = {
    vault: {
      getAbstractFileByPath: vi.fn((path: string) => vaultFiles.get(path) ?? null),
      getMarkdownFiles: vi.fn(() => Array.from(vaultFiles.values())),
    },
    fileManager: {
      renameFile: vi.fn(async (file: TFile, newPath: string) => {
        // Simulate rename by updating the file map
        for (const [path, f] of vaultFiles) {
          if (f === file) {
            vaultFiles.delete(path);
            f.path = newPath;
            vaultFiles.set(newPath, f);
            break;
          }
        }
      }),
    },
  };

  function addFile(path: string, ctime: number | null = 1): TFile {
    const f = makeMockFile(path, ctime === null ? undefined : ctime);
    vaultFiles.set(path, f);
    return f;
  }

  return { app, addFile };
}

describe('undoLastAutoSortRun', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when no undoable run exists', async () => {
    mockGetLastUndoable.mockResolvedValue(null);

    const { undoLastAutoSortRun } = await import('../src/undoAutoSort');
    const result = await undoLastAutoSortRun({} as any);

    expect(result).toBeNull();
  });

  it('restores files from destination back to source', async () => {
    mockGetLastUndoable.mockResolvedValue(makeRun('run-1', [makeAction()]));

    const { app, addFile } = createMockApp();
    addFile('Archive/test.md');

    const { undoLastAutoSortRun } = await import('../src/undoAutoSort');
    const result = await undoLastAutoSortRun(app);

    expect(result).not.toBeNull();
    expect(result!.restoredCount).toBe(1);
    expect(mockMarkUndone).toHaveBeenCalledWith(app, 'run-1');
    expect(app.fileManager.renameFile).toHaveBeenCalledTimes(1);
  });

  it('restores delete_candidate files from quarantine back to source', async () => {
    mockGetLastUndoable.mockResolvedValue(makeRun('run-delete-candidate', [
      makeAction({
        runId: 'run-delete-candidate',
        action: 'delete_candidate',
        sourcePath: 'Inbox/test.md',
        destinationPath: 'Delete Candidates/test.md',
        confidence: 'medium',
        reliabilityLabel: 'medium',
      }),
    ]));

    const { app, addFile } = createMockApp();
    addFile('Delete Candidates/test.md');

    const { undoLastAutoSortRun } = await import('../src/undoAutoSort');
    const result = await undoLastAutoSortRun(app);

    expect(result).not.toBeNull();
    expect(result!.restoredCount).toBe(1);
    expect(app.fileManager.renameFile).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'Inbox/test.md' }),
      'Inbox/test.md',
    );
    expect(mockMarkUndone).toHaveBeenCalledWith(app, 'run-delete-candidate');
  });

  it('processes actions in reverse order', async () => {
    mockGetLastUndoable.mockResolvedValue(makeRun('run-2', [
      makeAction({
        runId: 'run-2',
        sourcePath: 'Inbox/a.md',
        destinationPath: 'Archive/a.md',
      }),
      makeAction({
        runId: 'run-2',
        timestamp: Date.now() - 500,
        action: 'read_later',
        sourcePath: 'Inbox/b.md',
        destinationPath: 'Read Later/b.md',
        confidence: 'medium',
        reliabilityLabel: 'medium',
      }),
    ]));

    const { app, addFile } = createMockApp();
    addFile('Archive/a.md');
    addFile('Read Later/b.md');

    const { undoLastAutoSortRun } = await import('../src/undoAutoSort');
    const result = await undoLastAutoSortRun(app);

    expect(result).not.toBeNull();
    expect(result!.restoredCount).toBe(2);

    // Actions processed in reverse: b.md first, then a.md
    const renameCalls = vi.mocked(app.fileManager.renameFile).mock.calls;
    expect(renameCalls[0][1]).toBe('Inbox/b.md');
    expect(renameCalls[1][1]).toBe('Inbox/a.md');
  });

  it('renames file when source path already exists', async () => {
    mockGetLastUndoable.mockResolvedValue(makeRun('run-3', [makeAction({ runId: 'run-3' })]));

    const { app, addFile } = createMockApp();
    addFile('Archive/test.md');
    addFile('Inbox/test.md'); // source already occupied

    const { undoLastAutoSortRun } = await import('../src/undoAutoSort');
    const result = await undoLastAutoSortRun(app);

    expect(result).not.toBeNull();
    expect(result!.restoredCount).toBe(1);
    const renameCall = vi.mocked(app.fileManager.renameFile).mock.calls[0];
    expect(renameCall[1]).toBe('Inbox/test (restored).md');
  });

  it('skips when destination does not exist', async () => {
    mockGetLastUndoable.mockResolvedValue(makeRun('run-4', [makeAction({ runId: 'run-4' })]));

    const { app } = createMockApp();

    const { undoLastAutoSortRun } = await import('../src/undoAutoSort');
    const result = await undoLastAutoSortRun(app);

    expect(result).not.toBeNull();
    expect(result!.restoredCount).toBe(0);
    expect(result!.skippedCount).toBe(1);
  });

  it('continues restoring other files when one fails', async () => {
    mockGetLastUndoable.mockResolvedValue(makeRun('run-5', [
      makeAction({ runId: 'run-5', sourcePath: 'Inbox/a.md', destinationPath: 'Archive/a.md' }),
      makeAction({
        runId: 'run-5',
        timestamp: Date.now() - 500,
        action: 'read_later',
        sourcePath: 'Inbox/b.md',
        destinationPath: 'Read Later/b.md',
        confidence: 'medium',
        reliabilityLabel: 'medium',
      }),
    ]));

    const { app, addFile } = createMockApp();
    addFile('Archive/a.md');
    // b's destination doesn't exist - should be skipped

    const { undoLastAutoSortRun } = await import('../src/undoAutoSort');
    const result = await undoLastAutoSortRun(app);

    expect(result).not.toBeNull();
    expect(result!.restoredCount).toBe(1); // a restored
    expect(result!.skippedCount).toBe(1); // b skipped
  });

  it('marks run as undone after processing', async () => {
    mockGetLastUndoable.mockResolvedValue(makeRun('run-6', [makeAction({ runId: 'run-6' })]));

    const { app, addFile } = createMockApp();
    addFile('Archive/test.md');

    const { undoLastAutoSortRun } = await import('../src/undoAutoSort');
    await undoLastAutoSortRun(app);

    expect(mockMarkUndone).toHaveBeenCalledWith(app, 'run-6');
  });

  it('does not undo already undone runs (handled by getLastUndoableAutoSortRun)', async () => {
    // This test verifies that getLastUndoableAutoSortRun filters undone runs
    // The function being tested relies on the history utility for this
    mockGetLastUndoable.mockResolvedValue(null);

    const { undoLastAutoSortRun } = await import('../src/undoAutoSort');
    const result = await undoLastAutoSortRun({} as any);

    expect(result).toBeNull();
    expect(mockMarkUndone).not.toHaveBeenCalled();
  });

  it('logs operation result on success', async () => {
    mockGetLastUndoable.mockResolvedValue(makeRun('run-7', [makeAction({ runId: 'run-7' })]));

    const { app, addFile } = createMockApp();
    addFile('Archive/test.md');

    const { undoLastAutoSortRun } = await import('../src/undoAutoSort');
    await undoLastAutoSortRun(app);

    expect(mockLogOperation).toHaveBeenCalledWith(
      app,
      expect.objectContaining({
        event: 'auto_sort_undo_completed',
        level: 'INFO',
      }),
    );
  });

  it('logs operation result on partial success', async () => {
    mockGetLastUndoable.mockResolvedValue(makeRun('run-8', [
      makeAction({ runId: 'run-8' }),
      makeAction({
        runId: 'run-8',
        timestamp: Date.now() - 500,
        action: 'read_later',
        sourcePath: 'Inbox/b.md',
        destinationPath: 'Read Later/b.md',
        confidence: 'medium',
        reliabilityLabel: 'medium',
      }),
    ]));

    const { app, addFile } = createMockApp();
    addFile('Archive/test.md');

    const { undoLastAutoSortRun } = await import('../src/undoAutoSort');
    await undoLastAutoSortRun(app);

    expect(mockLogOperation).toHaveBeenCalledWith(
      app,
      expect.objectContaining({
        event: 'auto_sort_undo_partial',
        level: 'WARN',
      }),
    );
  });

  it('skips a replacement file at the recorded destination when the identity differs', async () => {
    mockGetLastUndoable.mockResolvedValue(makeRun('run-mismatch', [
      makeAction({ runId: 'run-mismatch', identity: { ctime: 1 } }),
    ]));

    const { app, addFile } = createMockApp();
    addFile('Archive/test.md', 999); // replacement note, different creation time

    const { undoLastAutoSortRun } = await import('../src/undoAutoSort');
    const result = await undoLastAutoSortRun(app);

    expect(result).not.toBeNull();
    expect(result!.restoredCount).toBe(0);
    expect(result!.skippedCount).toBe(1);
    expect(app.fileManager.renameFile).not.toHaveBeenCalled();
    expect(mockLogOperation).toHaveBeenCalledWith(
      app,
      expect.objectContaining({
        event: 'auto_sort_undo_failed',
        details: expect.objectContaining({
          skippedReasons: expect.stringContaining('Identity mismatch at destination: Archive/test.md'),
        }),
      }),
    );
  });

  it('skips a legacy record that has no recorded identity', async () => {
    const legacy = makeAction({ runId: 'run-legacy' });
    delete (legacy as { identity?: unknown }).identity;
    mockGetLastUndoable.mockResolvedValue(makeRun('run-legacy', [legacy]));

    const { app, addFile } = createMockApp();
    addFile('Archive/test.md');

    const { undoLastAutoSortRun } = await import('../src/undoAutoSort');
    const result = await undoLastAutoSortRun(app);

    expect(result).not.toBeNull();
    expect(result!.restoredCount).toBe(0);
    expect(result!.skippedCount).toBe(1);
    expect(app.fileManager.renameFile).not.toHaveBeenCalled();
    expect(mockLogOperation).toHaveBeenCalledWith(
      app,
      expect.objectContaining({
        event: 'auto_sort_undo_failed',
        details: expect.objectContaining({
          skippedReasons: expect.stringContaining('Legacy record without identity: Archive/test.md'),
        }),
      }),
    );
  });

  it('skips when the destination has an identity but the current file exposes no creation time', async () => {
    mockGetLastUndoable.mockResolvedValue(makeRun('run-nostat', [
      makeAction({ runId: 'run-nostat', identity: { ctime: 1 } }),
    ]));

    const { app, addFile } = createMockApp();
    addFile('Archive/test.md', null);

    const { undoLastAutoSortRun } = await import('../src/undoAutoSort');
    const result = await undoLastAutoSortRun(app);

    expect(result).not.toBeNull();
    expect(result!.restoredCount).toBe(0);
    expect(result!.skippedCount).toBe(1);
    expect(app.fileManager.renameFile).not.toHaveBeenCalled();
  });

  it('restores the original file when it is still at its recorded destination', async () => {
    mockGetLastUndoable.mockResolvedValue(makeRun('run-identity-ok', [
      makeAction({
        runId: 'run-identity-ok',
        sourcePath: 'Inbox/note.md',
        destinationPath: 'Archive/note.md',
        identity: { ctime: 42 },
      }),
    ]));

    const { app, addFile } = createMockApp();
    const original = addFile('Archive/note.md', 42);

    const { undoLastAutoSortRun } = await import('../src/undoAutoSort');
    const result = await undoLastAutoSortRun(app);

    expect(result).not.toBeNull();
    expect(result!.restoredCount).toBe(1);
    expect(result!.skippedCount).toBe(0);
    expect(app.fileManager.renameFile).toHaveBeenCalledWith(original, 'Inbox/note.md');
  });
});
