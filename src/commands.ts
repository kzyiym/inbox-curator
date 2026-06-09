import { Notice } from 'obsidian';
import type InboxCuratorPlugin from '../main';
import { t } from './i18n';
import { undoLastAutoSortRun } from './undoAutoSort';

export function registerInboxCuratorCommands(plugin: InboxCuratorPlugin): void {
  plugin.addCommand({
    id: 'review-current-note',
    name: t('commands.reviewCurrentNote'),
    callback: async () => {
      await plugin.reviewActiveFile();
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
    callback: async () => {
      await plugin.executeProposedActionForActiveFile();
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
    id: 'review-selected-notes-as-collection',
    name: t('commands.reviewSelectedNotesAsCollection'),
    callback: async () => {
      await plugin.reviewSelectedNotesAsCollection();
    },
  });

  plugin.addCommand({
    id: 'review-folder-as-collection',
    name: t('commands.reviewFolderAsCollection'),
    callback: async () => {
      await plugin.reviewFolderAsCollection();
    },
  });
}
