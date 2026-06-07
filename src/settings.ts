import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import type InboxCuratorPlugin from '../main';
import { deleteApiKey, getApiKeySecretId, hasApiKey, saveApiKey } from './secrets';

export interface InboxCuratorSettings {
  watchedFolder: string;
  reviewOutputFolder: string;
}

export const DEFAULT_SETTINGS: InboxCuratorSettings = {
  watchedFolder: 'Inbox',
  reviewOutputFolder: 'AI Reviews',
};

export class InboxCuratorSettingTab extends PluginSettingTab {
  plugin: InboxCuratorPlugin;

  constructor(app: App, plugin: InboxCuratorPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'Inbox Curator' });

    new Setting(containerEl)
      .setName('Watched folder')
      .setDesc('Single watched folder for the current MVP.')
      .addText((text) =>
        text
          .setPlaceholder('Inbox')
          .setValue(this.plugin.settings.watchedFolder)
          .onChange(async (value) => {
            this.plugin.settings.watchedFolder = value.trim();
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Review output folder')
      .setDesc('Separate review notes are written here.')
      .addText((text) =>
        text
          .setPlaceholder('AI Reviews')
          .setValue(this.plugin.settings.reviewOutputFolder)
          .onChange(async (value) => {
            this.plugin.settings.reviewOutputFolder = value.trim() || DEFAULT_SETTINGS.reviewOutputFolder;
            await this.plugin.saveSettings();
          }),
      );

    const apiKeySetting = new Setting(containerEl)
      .setName('API key')
      .setDesc(`Stored in SecretStorage under ${getApiKeySecretId()}. Not saved to data.json.`);

    let draftValue = '';

    apiKeySetting.addText((text) => {
      text.inputEl.type = 'password';
      text.setPlaceholder('Paste API key');
      text.onChange((value) => {
        draftValue = value.trim();
      });
    });

    apiKeySetting.addButton((button) =>
      button.setButtonText('Save API key').onClick(async () => {
        if (!draftValue) {
          new Notice('Enter an API key first.');
          return;
        }
        await saveApiKey(this.app, draftValue);
        draftValue = '';
        this.display();
        new Notice('API key saved to SecretStorage.');
      }),
    );

    apiKeySetting.addButton((button) =>
      button.setButtonText('Delete API key').setWarning().onClick(async () => {
        await deleteApiKey(this.app);
        draftValue = '';
        this.display();
        new Notice('API key deleted from SecretStorage.');
      }),
    );

    void this.renderApiKeyStatus(containerEl);
  }

  private async renderApiKeyStatus(containerEl: HTMLElement): Promise<void> {
    const saved = await hasApiKey(this.app);
    containerEl.createEl('p', {
      text: saved ? 'API key status: saved in SecretStorage' : 'API key status: not saved',
    });
  }
}
