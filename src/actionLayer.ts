import { App, TFolder, TFile, normalizePath, Notice } from 'obsidian';
import * as yaml from 'js-yaml';
import { ActionConfirmationModal } from './actionConfirmationModal';
import { ensureFolder, resolveSafeSuggestedPath } from './utils/folder';

const FRONTMATTER_REGEX = /^---\n([\s\S]*?)\n---\n?/;

function parseDocument(content: string): Record<string, unknown> {
  const match = content.match(FRONTMATTER_REGEX);
  if (!match) {
    return {};
  }
  try {
    const parsed = yaml.load(match[1]);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export interface AutoExecuteActionResult {
  success: boolean;
  status: 'success' | 'skipped' | 'failed';
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
        status: 'success',
        actionTaken: 'archive',
        destinationPath: destPath,
      };
    }

    // No viable destination: succeed as no-op (archive is processed, file stays in place)
    return {
      success: true,
      status: 'success',
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
      status: 'success',
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
      status: 'success',
      actionTaken: 'task',
      destinationPath: destPath,
    };
  }

  if (normalizedAction === 'delete_candidate') {
    if (options.skipConfirmation) {
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

      await ensureFolder(app, destFolder);
      await app.fileManager.renameFile(file, destPath);

      return {
        success: true,
        status: 'success',
        actionTaken: 'delete_candidate',
        destinationPath: destPath,
      };
    }

    return new Promise((resolve) => {
      let resolved = false;
      const modal = new ActionConfirmationModal(
        app,
        `Are you sure you want to move the note "${file.path}" to the trash? This action was recommended by AI review.`,
        async () => {
          try {
            await app.fileManager.trashFile(file);
            resolved = true;
            resolve({
              success: true,
              status: 'success',
              actionTaken: 'delete_candidate',
            });
          } catch (err) {
            resolved = true;
            resolve({
              success: false,
              status: 'failed',
              error: err instanceof Error ? err.message : 'Failed to move to trash',
            });
          }
        },
      );

      const originalOnClose = modal.onClose.bind(modal);
      modal.onClose = () => {
        originalOnClose();
        if (!resolved) {
          resolve({
            success: false,
            status: 'failed',
            error: 'User cancelled deletion confirmation.',
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
      status: 'success',
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
