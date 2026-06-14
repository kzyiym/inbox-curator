import { Notice, TFile } from 'obsidian';
import type InboxCuratorPlugin from '../main';
import { t } from './i18n';
import { undoLastAutoSortRun } from './undoAutoSort';

export function registerInboxCuratorCommands(plugin: InboxCuratorPlugin): void {
  plugin.addCommand({
    id: 'review-current-note',
    name: t('commands.reviewCurrentNote'),
    editorCheckCallback: (checking, _editor, view) => {
      const file = view?.file;
      if (checking) {
        return file instanceof TFile && file.extension === 'md' && !file.path.endsWith('.ai-review.md');
      }
      if (!(file instanceof TFile) || file.extension !== 'md') {
        new Notice(t('notice.openMarkdownNoteFirst'));
        return;
      }
      void plugin.reviewFile(file);
    },
  });

  plugin.addCommand({
    id: 'process-watched-folder',
    name: t('commands.processWatchedFolder'),
    callback: async () => {
      await plugin.processWatchedFolder();
    },
  });

  plugin.addCommand({
    id: 'execute-proposed-action',
    name: t('commands.executeProposedAction'),
    editorCheckCallback: (checking, _editor, view) => {
      const file = view?.file;
      if (checking) {
        return file instanceof TFile && file.extension === 'md' && !file.path.endsWith('.ai-review.md');
      }
      if (!(file instanceof TFile) || file.extension !== 'md') {
        new Notice(t('notice.openMarkdownNoteFirst'));
        return;
      }
      void plugin.executeProposedActionForFile(file);
    },
  });

  plugin.addCommand({
    id: 'cleanup-processing-markers',
    name: t('commands.cleanupProcessingMarkers'),
    callback: async () => {
      await plugin.cleanupEmojiPrefixFiles();
      new Notice(t('notice.cleanupMarkersNone'));
    },
  });

  plugin.addCommand({
    id: 'undo-last-auto-sort',
    name: t('commands.undoLastAutoSort'),
    callback: async () => {
      await undoLastAutoSortRun(plugin.app);
    },
  });

  plugin.addCommand({
    id: 'open-action-review-panel',
    name: t('commands.openActionReviewPanel'),
    callback: async () => {
      await plugin.openActionReviewPanel(false);
    },
  });

  plugin.addCommand({
    id: 'dry-run-auto-sort',
    name: t('commands.dryRunAutoSort'),
    callback: async () => {
      await plugin.openActionReviewPanel(true);
    },
  });

  plugin.addCommand({
    id: 'review-selected-notes-as-collection',
    name: t('commands.reviewSelectedNotesAsCollection'),
    callback: async () => {
      await plugin.reviewSelectedNotesAsCollection();
    },
  });

  plugin.addCommand({
    id: 'review-folder-as-collection',
    name: t('commands.reviewFolderAsCollection'),
    editorCheckCallback: (checking, _editor, view) => {
      if (checking) {
        return true;
      }
      const activeFile = view?.file instanceof TFile && view.file.extension === 'md'
        ? view.file
        : undefined;
      void plugin.reviewFolderAsCollection(activeFile);
    },
  });
}
