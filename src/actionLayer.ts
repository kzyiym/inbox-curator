import { App, TFile, normalizePath, Notice } from 'obsidian';
import * as yaml from 'js-yaml';
import { ActionConfirmationModal } from './actionConfirmationModal';

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

async function ensureFolder(app: App, folderPath: string): Promise<void> {
  const normalized = normalizePath(folderPath);
  if (!normalized || normalized === '.') {
    return;
  }

  const parts = normalized.split('/');
  let current = '';

  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    const existing = app.vault.getAbstractFileByPath(current);
    if (!existing) {
      await app.vault.createFolder(current);
    }
  }
}

export async function executeProposedAction(
  app: App,
  file: TFile,
  options: { outputFolder: string; skipConfirmation?: boolean },
): Promise<{ success: boolean; error?: string; actionTaken?: string }> {
  // 1. Safety check: do not touch review output files
  const normalizedOutput = normalizePath(options.outputFolder.trim() || 'AI Reviews');
  if (
    file.path.startsWith(normalizedOutput + '/') ||
    file.path === normalizedOutput ||
    file.path.endsWith('.ai-review.md')
  ) {
    return { success: false, error: 'Cannot perform action on a review note.' };
  }

  const content = await app.vault.read(file);
  const frontmatter = parseDocument(content);

  const action = frontmatter.ai_review_recommended_action;
  if (typeof action !== 'string' || action.trim() === '') {
    return { success: false, error: 'No recommended action found in frontmatter.' };
  }

  const normalizedAction = action.trim().toLowerCase();

  if (normalizedAction === 'archive') {
    const suggestedFolder = frontmatter.ai_review_suggested_folder;
    if (typeof suggestedFolder !== 'string' || suggestedFolder.trim() === '') {
      return { success: false, error: 'Suggested folder is missing in frontmatter.' };
    }

    const normalizedFolder = normalizePath(suggestedFolder.trim());
    const destPath = normalizePath(`${normalizedFolder}/${file.name}`);

    // Collision check
    const existingDest = app.vault.getAbstractFileByPath(destPath);
    if (existingDest) {
      return { success: false, error: 'Destination file already exists.' };
    }

    await ensureFolder(app, normalizedFolder);
    await app.fileManager.renameFile(file, destPath);

    return { success: true, actionTaken: 'archive' };
  }

  if (normalizedAction === 'delete_candidate') {
    if (options.skipConfirmation) {
      await app.vault.trash(file, true);
      return { success: true, actionTaken: 'delete_candidate' };
    }

    return new Promise((resolve) => {
      let resolved = false;
      const modal = new ActionConfirmationModal(
        app,
        `Are you sure you want to move the note "${file.path}" to the trash? This action was recommended by AI review.`,
        async () => {
          try {
            await app.vault.trash(file, true);
            resolved = true;
            resolve({ success: true, actionTaken: 'delete_candidate' });
          } catch (err) {
            resolved = true;
            resolve({ success: false, error: err instanceof Error ? err.message : 'Failed to move to trash' });
          }
        },
      );

      const originalOnClose = modal.onClose.bind(modal);
      modal.onClose = () => {
        originalOnClose();
        if (!resolved) {
          resolve({ success: false, error: 'User cancelled deletion confirmation.' });
        }
      };

      modal.open();
    });
  }

  return { success: false, error: `Recommended action "${action}" is not supported or requires no automated steps.` };
}
