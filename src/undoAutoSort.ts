import { App, Notice, TFile } from 'obsidian';
import { getLastUndoableAutoSortRun, markAutoSortRunUndone } from './utils/autoSortHistory';
import { logOperation } from './utils/operationLog';
import { t } from './i18n';

export interface UndoResult {
  restoredCount: number;
  skippedCount: number;
  failedCount: number;
  runId: string;
  totalActions: number;
}

function buildRestoredPath(sourcePath: string, existingPaths: Set<string>): string {
  if (!existingPaths.has(sourcePath)) {
    return sourcePath;
  }

  const ext = sourcePath.endsWith('.md') ? '.md' : '';
  const base = ext ? sourcePath.slice(0, -ext.length) : sourcePath;
  let counter = 1;
  while (existingPaths.has(`${base} (restored)${ext}`)) {
    counter++;
  }
  if (counter === 1) {
    const candidate = `${base} (restored)${ext}`;
    if (!existingPaths.has(candidate)) {
      return candidate;
    }
    counter = 2;
  }
  return `${base} (restored ${counter})${ext}`;
}

export async function undoLastAutoSortRun(app: App): Promise<UndoResult | null> {
  const run = await getLastUndoableAutoSortRun(app);
  if (!run) {
    new Notice(t('notice.undoNoRun'));
    return null;
  }

  const actions = [...run.actions].reverse();
  let restoredCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  const skipped: string[] = [];
  const failed: string[] = [];

  const existingPaths = new Set<string>();
  const vaultFiles = app.vault.getMarkdownFiles();
  for (const f of vaultFiles) {
    existingPaths.add(f.path);
  }

  for (const action of actions) {
    try {
      const destPath = action.destinationPath;
      const sourcePath = action.sourcePath;

      const destFile = app.vault.getAbstractFileByPath(destPath);
      if (!destFile || !(destFile instanceof TFile)) {
        skippedCount++;
        skipped.push(`Destination not found: ${destPath}`);
        continue;
      }

      const resolvedSourcePath = buildRestoredPath(sourcePath, existingPaths);
      existingPaths.add(resolvedSourcePath);

      await app.fileManager.renameFile(destFile, resolvedSourcePath);
      restoredCount++;
    } catch (err) {
      failedCount++;
      const msg = err instanceof Error ? err.message : String(err);
      failed.push(`${action.sourcePath}: ${msg}`);
    }
  }

  await markAutoSortRunUndone(app, run.runId);

  // Build path map for logging (truncated if large)
  const restoredPaths = actions.slice(0, restoredCount).map((a) => a.sourcePath);

  if (restoredCount === actions.length) {
    new Notice(t('notice.undoSuccess', { count: restoredCount }));
    void logOperation(app, {
      timestamp: new Date().toISOString(),
      level: 'INFO',
      event: 'auto_sort_undo_completed',
      notePath: run.runId,
      message: `Auto-sort undo completed: ${restoredCount} notes restored`,
      details: {
        runId: run.runId,
        restoredCount,
        skippedCount,
        failedCount,
      },
    });
  } else if (restoredCount > 0) {
    new Notice(t('notice.undoPartial', { restored: restoredCount, skipped: skippedCount }));
    void logOperation(app, {
      timestamp: new Date().toISOString(),
      level: 'WARN',
      event: 'auto_sort_undo_partial',
      notePath: run.runId,
      message: `Auto-sort undo partially completed: ${restoredCount} restored, ${skippedCount} skipped, ${failedCount} failed`,
      details: {
        runId: run.runId,
        restoredCount,
        skippedCount,
        failedCount,
        skippedReasons: skipped.join('; ').slice(0, 500),
        failedReasons: failed.join('; ').slice(0, 500),
      },
    });
  } else {
    new Notice(t('notice.undoFailed'));
    void logOperation(app, {
      timestamp: new Date().toISOString(),
      level: 'ERROR',
      event: 'auto_sort_undo_failed',
      notePath: run.runId,
      message: `Auto-sort undo failed: 0 notes restored`,
      details: {
        runId: run.runId,
        restoredCount,
        skippedCount,
        failedCount,
        skippedReasons: skipped.join('; ').slice(0, 500),
        failedReasons: failed.join('; ').slice(0, 500),
      },
    });
  }

  return { restoredCount, skippedCount, failedCount, runId: run.runId, totalActions: actions.length };
}
