import { App, TFolder, TFile, normalizePath, Notice } from 'obsidian';
import { parseYamlRecord } from './utils/yaml';
import { ActionConfirmationModal } from './actionConfirmationModal';
import { ensureFolder, resolveSafeFolderPath, resolveSafeSuggestedPath } from './utils/folder';
import { normalizeReviewAction, type ReviewAction } from './reviewNormalizer';

const FRONTMATTER_REGEX = /^---\n([\s\S]*?)\n---\n?/;

function parseDocument(content: string): Record<string, unknown> {
  const match = content.match(FRONTMATTER_REGEX);
  if (!match) {
    return {};
  }
  try {
    const parsed = parseYamlRecord(match[1]);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export interface ResolvedActionDestination {
  destinationPath?: string;
  conflict: boolean;
  reason?: string;
}

/**
 * Non-mutating preview of where a recommended action would move a file.
 * Mirrors the destination logic of executeProposedAction without performing
 * any file operations, for use by the dry-run / approval panel.
 */
export function resolveActionDestination(
  app: App,
  file: TFile,
  action: string,
  suggestedFolder: string | undefined,
  options: {
    readLaterFolder?: string;
    taskFolder?: string;
    deleteCandidateFolder?: string;
    suggestedFolderBasePath?: string;
  },
): ResolvedActionDestination {
  const normalizedAction = action.trim().toLowerCase();

  if (normalizedAction === 'archive') {
    if (typeof suggestedFolder === 'string' && suggestedFolder.trim() !== '') {
      const normalizedFolder = resolveSafeSuggestedPath(suggestedFolder, options.suggestedFolderBasePath);
      if (normalizedFolder && app.vault.getAbstractFileByPath(normalizedFolder) instanceof TFolder) {
        const candidate = normalizePath(`${normalizedFolder}/${file.name}`);
        if (app.vault.getAbstractFileByPath(candidate)) {
          return { conflict: true, destinationPath: candidate, reason: 'Destination file already exists.' };
        }
        return { conflict: false, destinationPath: candidate };
      }
    }
    if (options.suggestedFolderBasePath && options.suggestedFolderBasePath.trim() !== '') {
      const baseFolder = resolveSafeFolderPath(options.suggestedFolderBasePath);
      if (!baseFolder) {
        return { conflict: false, reason: 'Configured base folder path is unsafe.' };
      }
      const candidate = normalizePath(`${baseFolder}/${file.name}`);
      if (app.vault.getAbstractFileByPath(candidate)) {
        return { conflict: true, destinationPath: candidate, reason: 'Destination file already exists.' };
      }
      return { conflict: false, destinationPath: candidate };
    }
    return { conflict: false, reason: 'No viable destination folder configured.' };
  }

  const folderMap: Record<string, string | undefined> = {
    read_later: options.readLaterFolder,
    task: options.taskFolder,
    delete_candidate: options.deleteCandidateFolder,
  };

  if (normalizedAction in folderMap) {
    const folder = folderMap[normalizedAction];
    if (!folder || folder.trim() === '') {
      return { conflict: false, reason: 'Destination folder is not configured.' };
    }
    const destFolder = resolveSafeFolderPath(folder);
    if (!destFolder) {
      return { conflict: false, reason: 'Configured destination folder path is unsafe.' };
    }
    const candidate = normalizePath(`${destFolder}/${file.name}`);
    if (app.vault.getAbstractFileByPath(candidate)) {
      return { conflict: true, destinationPath: candidate, reason: 'Destination file already exists.' };
    }
    return { conflict: false, destinationPath: candidate };
  }

  return { conflict: false };
}

export interface AutoExecuteActionResult {
  success: boolean;
  status: 'executed' | 'skipped' | 'failed';
  error?: string;
  actionTaken?: string;
  action?: string;
  destinationPath?: string;
}

export async function executeProposedAction(
  app: App,
  file: TFile,
  options: {
    outputFolder: string;
    readLaterFolder?: string;
    taskFolder?: string;
    deleteCandidateFolder?: string;
    skipConfirmation?: boolean;
    suggestedFolderBasePath?: string;
    expectedAction?: ReviewAction;
    expectedDestinationPath?: string | null;
    allowedActions?: readonly ReviewAction[];
  },
): Promise<AutoExecuteActionResult> {
  // 1. Safety check: do not touch review output files
  const normalizedOutput = normalizePath(options.outputFolder.trim() || 'AI Reviews');
  if (
    file.path.startsWith(normalizedOutput + '/') ||
    file.path === normalizedOutput ||
    file.path.endsWith('.ai-review.md')
  ) {
    return {
      success: false,
      status: 'failed',
      error: 'Cannot perform action on a review note.',
    };
  }

  const content = await app.vault.read(file);
  const frontmatter = parseDocument(content);

  const action = frontmatter.ai_review_recommended_action;
  if (typeof action !== 'string' || action.trim() === '') {
    return {
      success: false,
      status: 'failed',
      error: 'No recommended action found in frontmatter.',
    };
  }

  const normalizedAction = action.trim().toLowerCase();
  const currentReviewAction = normalizeReviewAction(normalizedAction);

  if (options.expectedAction && currentReviewAction !== options.expectedAction) {
    return {
      success: false,
      status: 'skipped',
      error: `Recommended action changed from ${options.expectedAction} to ${currentReviewAction}.`,
      action: normalizedAction,
    };
  }

  if (
    currentReviewAction !== 'none' &&
    options.allowedActions &&
    !options.allowedActions.includes(currentReviewAction)
  ) {
    return {
      success: false,
      status: 'skipped',
      error: `Action ${currentReviewAction} is disabled by the action allowlist.`,
      action: normalizedAction,
    };
  }

  if (options.expectedDestinationPath !== undefined) {
    const suggestedFolder = typeof frontmatter.ai_review_suggested_folder === 'string'
      ? frontmatter.ai_review_suggested_folder
      : undefined;
    const currentDestination = resolveActionDestination(
      app,
      file,
      currentReviewAction,
      suggestedFolder,
      options,
    ).destinationPath ?? null;

    if (currentDestination !== options.expectedDestinationPath) {
      return {
        success: false,
        status: 'skipped',
        error: 'Resolved action destination changed after the review panel was opened.',
        action: normalizedAction,
        destinationPath: currentDestination ?? undefined,
      };
    }
  }

  if (normalizedAction === 'archive') {
    let destPath: string | undefined;

    // Priority 1: AI-suggested folder
    const suggestedFolder = frontmatter.ai_review_suggested_folder;
    if (typeof suggestedFolder === 'string' && suggestedFolder.trim() !== '') {
      const normalizedFolder = resolveSafeSuggestedPath(suggestedFolder, options.suggestedFolderBasePath);
      if (normalizedFolder) {
        const folderRef = app.vault.getAbstractFileByPath(normalizedFolder);
        if (folderRef instanceof TFolder) {
          const candidate = normalizePath(`${normalizedFolder}/${file.name}`);
          const existingDest = app.vault.getAbstractFileByPath(candidate);
          if (!existingDest) {
            destPath = candidate;
          }
        }
      }
    }

    // Priority 2: suggestedFolderBasePath as default archive folder
    if (!destPath && options.suggestedFolderBasePath && options.suggestedFolderBasePath.trim() !== '') {
      const baseFolder = resolveSafeFolderPath(options.suggestedFolderBasePath);
      if (baseFolder) {
        const candidate = normalizePath(`${baseFolder}/${file.name}`);
        const existingDest = app.vault.getAbstractFileByPath(candidate);
        if (!existingDest) {
          destPath = candidate;
        }
      }
    }

    if (destPath) {
      const destFolder = destPath.substring(0, destPath.lastIndexOf('/'));
      await ensureFolder(app, destFolder);
      await app.fileManager.renameFile(file, destPath);
      return {
        success: true,
        status: 'executed',
        actionTaken: 'archive',
        destinationPath: destPath,
      };
    }

    // Check if collision happened
    let conflictExists = false;
    let conflictPath = '';
    if (typeof suggestedFolder === 'string' && suggestedFolder.trim() !== '') {
      const normalizedFolder = resolveSafeSuggestedPath(suggestedFolder, options.suggestedFolderBasePath);
      if (normalizedFolder) {
        const candidate = normalizePath(`${normalizedFolder}/${file.name}`);
        if (app.vault.getAbstractFileByPath(candidate)) {
          conflictExists = true;
          conflictPath = candidate;
        }
      }
    }
    if (!conflictExists && options.suggestedFolderBasePath && options.suggestedFolderBasePath.trim() !== '') {
      const baseFolder = resolveSafeFolderPath(options.suggestedFolderBasePath);
      if (baseFolder) {
        const candidate = normalizePath(`${baseFolder}/${file.name}`);
        if (app.vault.getAbstractFileByPath(candidate)) {
          conflictExists = true;
          conflictPath = candidate;
        }
      }
    }

    if (conflictExists) {
      return {
        success: false,
        status: 'skipped',
        error: 'Destination file already exists (filename conflict).',
        destinationPath: conflictPath,
        actionTaken: 'none',
        action: 'archive',
      };
    }

    return {
      success: false,
      status: 'skipped',
      error: 'No viable destination folder configured or folder does not exist.',
      actionTaken: 'none',
      action: 'archive',
    };
  }

  if (normalizedAction === 'read_later') {
    if (!options.readLaterFolder || options.readLaterFolder.trim() === '') {
      return {
        success: false,
        status: 'failed',
        error: 'Read later folder is not configured.',
      };
    }
    const destFolder = resolveSafeFolderPath(options.readLaterFolder);
    if (!destFolder) {
      return { success: false, status: 'failed', error: 'Read later folder path is unsafe.' };
    }
    const destPath = normalizePath(`${destFolder}/${file.name}`);

    // Collision check
    const existingDest = app.vault.getAbstractFileByPath(destPath);
    if (existingDest) {
      return {
        success: false,
        status: 'skipped',
        error: 'Destination file already exists.',
        destinationPath: destPath,
      };
    }

    await ensureFolder(app, destFolder);
    await app.fileManager.renameFile(file, destPath);

    return {
      success: true,
      status: 'executed',
      actionTaken: 'read_later',
      destinationPath: destPath,
    };
  }

  if (normalizedAction === 'task') {
    if (!options.taskFolder || options.taskFolder.trim() === '') {
      return {
        success: false,
        status: 'failed',
        error: 'Task folder is not configured.',
      };
    }
    const destFolder = resolveSafeFolderPath(options.taskFolder);
    if (!destFolder) {
      return { success: false, status: 'failed', error: 'Task folder path is unsafe.' };
    }
    const destPath = normalizePath(`${destFolder}/${file.name}`);

    // Collision check
    const existingDest = app.vault.getAbstractFileByPath(destPath);
    if (existingDest) {
      return {
        success: false,
        status: 'skipped',
        error: 'Destination file already exists.',
        destinationPath: destPath,
      };
    }

    await ensureFolder(app, destFolder);
    await app.fileManager.renameFile(file, destPath);

    return {
      success: true,
      status: 'executed',
      actionTaken: 'task',
      destinationPath: destPath,
    };
  }

  if (normalizedAction === 'delete_candidate') {
    if (!options.deleteCandidateFolder || options.deleteCandidateFolder.trim() === '') {
      return {
        success: false,
        status: 'failed',
        error: 'Delete candidate folder is not configured.',
      };
    }
    const destFolder = resolveSafeFolderPath(options.deleteCandidateFolder);
    if (!destFolder) {
      return { success: false, status: 'failed', error: 'Delete candidate folder path is unsafe.' };
    }
    const destPath = normalizePath(`${destFolder}/${file.name}`);

    // Collision check
    const existingDest = app.vault.getAbstractFileByPath(destPath);
    if (existingDest) {
      return {
        success: false,
        status: 'skipped',
        error: 'Destination file already exists.',
        destinationPath: destPath,
      };
    }

    if (options.skipConfirmation) {
      try {
        await ensureFolder(app, destFolder);
        await app.fileManager.renameFile(file, destPath);
        return {
          success: true,
          status: 'executed',
          actionTaken: 'delete_candidate',
          destinationPath: destPath,
        };
      } catch (err) {
        return {
          success: false,
          status: 'failed',
          error: err instanceof Error ? err.message : 'Failed to move to delete candidate folder',
        };
      }
    }

    return new Promise((resolve) => {
      let resolved = false;
      const modal = new ActionConfirmationModal(
        app,
        `Are you sure you want to move the note "${file.path}" to the delete candidate folder "${destFolder}"? This action was recommended by AI review.`,
        () => {
          Promise.resolve().then(async () => {
            try {
              await ensureFolder(app, destFolder);
              await app.fileManager.renameFile(file, destPath);
              resolved = true;
              resolve({
                success: true,
                status: 'executed',
                actionTaken: 'delete_candidate',
                destinationPath: destPath,
              });
            } catch (err) {
              resolved = true;
              resolve({
                success: false,
                status: 'failed',
                error: err instanceof Error ? err.message : 'Failed to move to delete candidate folder',
              });
            }
          }).catch((err) => {
            console.error('Inbox Curator: Unexpected error in delete candidate modal', err);
          });
        },
      );

      const originalOnClose = modal.onClose.bind(modal);
      modal.onClose = () => {
        originalOnClose();
        if (!resolved) {
          resolve({
            success: false,
            status: 'skipped',
            error: 'User cancelled action execution.',
          });
        }
      };

      modal.open();
    });
  }

  const validNoopActions = [
    'keep_as_reference',
    'read_later',
  ];

  if (validNoopActions.includes(normalizedAction)) {
    return {
      success: true,
      status: 'executed',
      actionTaken: 'none',
      action: normalizedAction,
    };
  }

  return {
    success: false,
    status: 'failed',
    error: `Recommended action "${action}" is not supported or requires no automated steps.`,
  };
}
