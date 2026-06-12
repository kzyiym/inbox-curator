import { App, TFolder, TFile, normalizePath, Notice } from 'obsidian';
import { parseYamlRecord } from './utils/yaml';
import { ActionConfirmationModal } from './actionConfirmationModal';
import { ensureFolder, resolveSafeSuggestedPath } from './utils/folder';

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
      const baseFolder = normalizePath(options.suggestedFolderBasePath.trim());
      const candidate = normalizePath(`${baseFolder}/${file.name}`);
      const existingDest = app.vault.getAbstractFileByPath(candidate);
      if (!existingDest) {
        destPath = candidate;
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
      const baseFolder = normalizePath(options.suggestedFolderBasePath.trim());
      const candidate = normalizePath(`${baseFolder}/${file.name}`);
      if (app.vault.getAbstractFileByPath(candidate)) {
        conflictExists = true;
        conflictPath = candidate;
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
    const destFolder = normalizePath(options.readLaterFolder.trim());
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
    const destFolder = normalizePath(options.taskFolder.trim());
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
    const destFolder = normalizePath(options.deleteCandidateFolder.trim());
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
            status: 'failed',
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
