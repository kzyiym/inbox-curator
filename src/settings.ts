import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import type InboxCuratorPlugin from '../main';
import { testConnection } from './connectionTest';
import { deleteApiKey, getApiKey, getApiKeySecretId, hasApiKey, isMaskedApiKeyValue, SAVED_API_KEY_MASK, saveApiKey } from './secrets';

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

function buildConnectionFailureNotice(status: number | undefined, responseBody: string | undefined, error: string): string {
  const normalizedResponse = responseBody?.toLowerCase() ?? '';

  if (status === 429 && normalizedResponse.includes('prepayment credits are depleted')) {
    return 'Connection failed: Google AI Studio credits are depleted';
  }

  if (status) {
    return `Connection test failed: HTTP ${status}`;
  }

  return `Connection test failed: ${error}`;
}

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
      text: 'API key is stored in Obsidian SecretStorage.',
    });
    containerEl.createEl('p', {
      text: 'Provider, endpoint, and model are stored in plugin settings.',
    });
    containerEl.createEl('p', {
      text: 'Saved API keys are masked and never displayed.',
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
    let hasEditedApiKey = false;

    apiKeySetting.addText((text) => {
      text.inputEl.type = 'text';
      text.setPlaceholder('Paste API key');

      void hasApiKey(this.app).then((saved) => {
        text.setValue(saved ? SAVED_API_KEY_MASK : '');
      });

      text.inputEl.addEventListener('focus', () => {
        if (!hasEditedApiKey && text.inputEl.value === SAVED_API_KEY_MASK) {
          text.setValue('');
        }
      });

      text.inputEl.addEventListener('blur', () => {
        if (!hasEditedApiKey) {
          void hasApiKey(this.app).then((saved) => {
            if (saved && text.inputEl.value.trim() === '') {
              text.setValue(SAVED_API_KEY_MASK);
            }
          });
        }
      });

      text.onChange((value) => {
        const trimmed = value.trim();
        if (!hasEditedApiKey && trimmed === SAVED_API_KEY_MASK) {
          draftValue = '';
          return;
        }

        hasEditedApiKey = true;
        draftValue = trimmed;
      });
    });

    apiKeySetting.addButton((button) =>
      button.setButtonText('Save API key').onClick(async () => {
        if (!hasEditedApiKey || !draftValue || isMaskedApiKeyValue(draftValue)) {
          new Notice('No new API key to save. Existing saved key was kept.');
          return;
        }

        try {
          await saveApiKey(this.app, draftValue);
          draftValue = '';
          hasEditedApiKey = false;
          this.display();
          new Notice('API key saved to SecretStorage.');
        } catch (error) {
          new Notice('API key save failed');
          console.warn('Inbox Curator API key save failed', {
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }),
    );

    apiKeySetting.addButton((button) =>
      button.setButtonText('Delete API key').setWarning().onClick(async () => {
        await deleteApiKey(this.app);
        draftValue = '';
        hasEditedApiKey = false;
        this.display();
        new Notice('API key deleted from SecretStorage.');
      }),
    );

    new Setting(containerEl)
      .setName('Test connection')
      .setDesc('Send a minimal OpenAI-compatible chat completion request using the saved API key.')
      .addButton((button) =>
        button.setButtonText('Test connection').onClick(async () => {
          const apiKeyCandidate = hasEditedApiKey && draftValue ? draftValue : await getApiKey(this.app);
          if (!apiKeyCandidate || isMaskedApiKeyValue(apiKeyCandidate)) {
            new Notice('Connection test failed: missing API key');
            console.warn('Inbox Curator connection test aborted', {
              provider: this.plugin.settings.provider,
              endpointUrl: this.plugin.settings.endpointUrl,
              model: this.plugin.settings.model,
              reason: 'Missing or masked API key',
            });
            return;
          }

          const result = await testConnection({
            provider: this.plugin.settings.provider,
            endpointUrl: this.plugin.settings.endpointUrl,
            model: this.plugin.settings.model,
            apiKey: apiKeyCandidate,
          });

          if (result.ok === true) {
            new Notice('Connection test succeeded');
            return;
          }

          new Notice(buildConnectionFailureNotice(result.status, result.responseBody, result.error));
          console.warn('Inbox Curator connection test failed', {
            provider: this.plugin.settings.provider,
            endpointUrl: this.plugin.settings.endpointUrl,
            model: this.plugin.settings.model,
            finalUrl: result.finalUrl,
            status: result.status,
            error: result.error,
            responseBody: result.responseBody,
          });
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
