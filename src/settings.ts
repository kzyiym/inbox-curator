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
  maxNotesPerRun: number;
  requestsPerMinute: number;
  delayBetweenRequestsMs: number;
  enableAutomaticWatching: boolean;
  autoReviewOnCreate: boolean;
  autoReviewOnModify: boolean;
  watchDebounceMs: number;
  enablePolling: boolean;
  pollingIntervalMs: number;
  fetchUrlMetadata: boolean;
  extractUrlArticleText: boolean;
  maxExtractedCharacters: number;
  readImages: boolean;
  readVideos: boolean;
}

export const DEFAULT_SETTINGS: InboxCuratorSettings = {
  watchedFolder: 'Inbox',
  reviewOutputFolder: 'AI Reviews',
  provider: 'openai-compatible',
  endpointUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  maxNotesPerRun: 10,
  requestsPerMinute: 10,
  delayBetweenRequestsMs: 1000,
  enableAutomaticWatching: false,
  autoReviewOnCreate: false,
  autoReviewOnModify: false,
  watchDebounceMs: 1500,
  enablePolling: false,
  pollingIntervalMs: 30000,
  fetchUrlMetadata: true,
  extractUrlArticleText: true,
  maxExtractedCharacters: 12000,
  readImages: false,
  readVideos: false,
};

function clampInteger(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.round(value)));
}

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

function buildSafeSnippet(value: string | undefined, maxLength = 160): string | undefined {
  const normalized = value?.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return undefined;
  }

  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength)}…`;
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
      .setName('Max notes per run')
      .setDesc('Maximum number of AI-reviewed candidates per watched-folder run. Skipped notes do not count toward this cap.')
      .addText((text) => {
        text.inputEl.type = 'number';
        text.inputEl.min = '1';
        text.inputEl.max = '100';
        text.setPlaceholder(String(DEFAULT_SETTINGS.maxNotesPerRun));
        text.setValue(String(this.plugin.settings.maxNotesPerRun));
        text.onChange(async (value) => {
          this.plugin.settings.maxNotesPerRun = clampInteger(Number(value), 1, 100, DEFAULT_SETTINGS.maxNotesPerRun);
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName('Requests per minute')
      .setDesc('Used to derive a minimum delay between watched-folder AI review requests.')
      .addText((text) => {
        text.inputEl.type = 'number';
        text.inputEl.min = '1';
        text.inputEl.max = '60';
        text.setPlaceholder(String(DEFAULT_SETTINGS.requestsPerMinute));
        text.setValue(String(this.plugin.settings.requestsPerMinute));
        text.onChange(async (value) => {
          this.plugin.settings.requestsPerMinute = clampInteger(Number(value), 1, 60, DEFAULT_SETTINGS.requestsPerMinute);
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName('Delay between requests')
      .setDesc('Extra delay in milliseconds between watched-folder AI review requests. The larger of this and the requests-per-minute delay is used.')
      .addText((text) => {
        text.inputEl.type = 'number';
        text.inputEl.min = '0';
        text.inputEl.max = '60000';
        text.setPlaceholder(String(DEFAULT_SETTINGS.delayBetweenRequestsMs));
        text.setValue(String(this.plugin.settings.delayBetweenRequestsMs));
        text.onChange(async (value) => {
          this.plugin.settings.delayBetweenRequestsMs = clampInteger(Number(value), 0, 60000, DEFAULT_SETTINGS.delayBetweenRequestsMs);
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName('Automatic watching')
      .setDesc('Default OFF. Watch the configured folder for new or changed Markdown notes and enqueue automatic reviews.')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.enableAutomaticWatching).onChange(async (value) => {
          this.plugin.settings.enableAutomaticWatching = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName('Auto-review on create')
      .setDesc('When automatic watching is enabled, enqueue review for new Markdown notes in the watched folder.')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.autoReviewOnCreate).onChange(async (value) => {
          this.plugin.settings.autoReviewOnCreate = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName('Auto-review on modify')
      .setDesc('When automatic watching is enabled, enqueue review for changed Markdown notes in the watched folder.')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.autoReviewOnModify).onChange(async (value) => {
          this.plugin.settings.autoReviewOnModify = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName('Watch debounce')
      .setDesc('Delay in milliseconds before an automatic watched-folder change is queued. Helps collapse noisy modify bursts.')
      .addText((text) => {
        text.inputEl.type = 'number';
        text.inputEl.min = '0';
        text.inputEl.max = '60000';
        text.setPlaceholder(String(DEFAULT_SETTINGS.watchDebounceMs));
        text.setValue(String(this.plugin.settings.watchDebounceMs));
        text.onChange(async (value) => {
          this.plugin.settings.watchDebounceMs = clampInteger(Number(value), 0, 60000, DEFAULT_SETTINGS.watchDebounceMs);
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName('Polling fallback')
      .setDesc('Default OFF. Periodically rescan the watched folder for changed notes that may have been missed by file events.')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.enablePolling).onChange(async (value) => {
          this.plugin.settings.enablePolling = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName('Polling interval')
      .setDesc('Polling interval in milliseconds. Used only when polling fallback is enabled.')
      .addText((text) => {
        text.inputEl.type = 'number';
        text.inputEl.min = '5000';
        text.inputEl.max = '600000';
        text.setPlaceholder(String(DEFAULT_SETTINGS.pollingIntervalMs));
        text.setValue(String(this.plugin.settings.pollingIntervalMs));
        text.onChange(async (value) => {
          this.plugin.settings.pollingIntervalMs = clampInteger(Number(value), 5000, 600000, DEFAULT_SETTINGS.pollingIntervalMs);
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName('Fetch URL metadata')
      .setDesc('URL-only notes can fetch title, description, and Open Graph metadata. This can be used with or without article text extraction.')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.fetchUrlMetadata).onChange(async (value) => {
          this.plugin.settings.fetchUrlMetadata = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName('Extract URL article text')
      .setDesc('Fetch static HTML for URL-only notes and try to extract readable article text. JavaScript rendering and PDF extraction are still not supported.')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.extractUrlArticleText).onChange(async (value) => {
          this.plugin.settings.extractUrlArticleText = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName('Max extracted characters')
      .setDesc('Upper bound for extracted article text included in the AI review prompt for URL-only notes.')
      .addText((text) => {
        text.inputEl.type = 'number';
        text.inputEl.min = '1000';
        text.inputEl.max = '50000';
        text.setPlaceholder(String(DEFAULT_SETTINGS.maxExtractedCharacters));
        text.setValue(String(this.plugin.settings.maxExtractedCharacters));
        text.onChange(async (value) => {
          this.plugin.settings.maxExtractedCharacters = clampInteger(Number(value), 1000, 50000, DEFAULT_SETTINGS.maxExtractedCharacters);
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName('Read images')
      .setDesc('Reserved for future image understanding. Image analysis is not implemented yet.')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.readImages).onChange(async (value) => {
          this.plugin.settings.readImages = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName('Read videos')
      .setDesc('Reserved for future video understanding. Video analysis is not implemented yet.')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.readVideos).onChange(async (value) => {
          this.plugin.settings.readVideos = value;
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
            status: result.status,
            error: result.error,
            responseSnippet: buildSafeSnippet(result.responseBody),
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
