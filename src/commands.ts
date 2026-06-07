import type InboxCuratorPlugin from '../main';

export function registerInboxCuratorCommands(plugin: InboxCuratorPlugin): void {
  plugin.addCommand({
    id: 'review-current-note',
    name: 'Review current note',
    callback: async () => {
      await plugin.reviewActiveFile();
    },
  });

  plugin.addCommand({
    id: 'process-watched-folder',
    name: 'Process watched folder',
    callback: async () => {
      await plugin.processWatchedFolder();
    },
  });

  plugin.addCommand({
    id: 'execute-proposed-action',
    name: 'Execute proposed action for current note',
    callback: async () => {
      await plugin.executeProposedActionForActiveFile();
    },
  });
}
