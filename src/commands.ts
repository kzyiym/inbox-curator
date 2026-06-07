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
    id: 'process-current-note',
    name: 'Process current note',
    callback: async () => {
      await plugin.reviewActiveFile();
    },
  });
}
