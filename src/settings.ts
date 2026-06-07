import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import type InboxCuratorPlugin from '../main';
import { deleteApiKey, getApiKeySecretId, hasApiKey, saveApiKey } from './secrets';

export type InboxCuratorProvider = 'openai-compatible';

export interface InboxCuratorSettings {
  watchedFolder: string;
  reviewOutputFolder: string;
  provider: InboxCuratorProvider;
  endpointUrl: string;
  model: string;
}

export const DEFAULT_SETTINGS: InboxCuratorSettings = {
  watchedFolder: 'Inbox',
  reviewOutputFolder: 'AI Reviews',
  provider: 'openai-compatible',
  endpointUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
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
    containerEl.createEl('p', {
      text: 'Provider, endpoint URL, and model are stored in normal plugin settings (data.json). API key is stored separately in SecretStorage.',
    });

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

    new Setting(containerEl)
      .setName('Provider')
      .setDesc('Stored in data.json. Real provider branching is not implemented yet.')
      .addDropdown((dropdown) =>
        dropdown
          .addOption('openai-compatible', 'openai-compatible')
          .setValue(this.plugin.settings.provider)
          .onChange(async (value) => {
            this.plugin.settings.provider = value as InboxCuratorProvider;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Endpoint URL')
      .setDesc('Stored in data.json. API key is not stored here.')
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_SETTINGS.endpointUrl)
          .setValue(this.plugin.settings.endpointUrl)
          .onChange(async (value) => {
            this.plugin.settings.endpointUrl = value.trim() || DEFAULT_SETTINGS.endpointUrl;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Model')
      .setDesc('Stored in data.json. Enter the model name manually for now.')
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_SETTINGS.model)
          .setValue(this.plugin.settings.model)
          .onChange(async (value) => {
            this.plugin.settings.model = value.trim() || DEFAULT_SETTINGS.model;
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
