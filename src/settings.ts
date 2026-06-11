import { apiVersion, App, normalizePath, Notice, PluginSettingTab, Setting, TFolder } from 'obsidian';
import type InboxCuratorPlugin from '../main';
import { testConnection } from './connectionTest';
import { buildApiKeyMask, deleteApiKey, getApiKey, getApiKeySecretId, hasApiKey, isMaskedApiKeyValue, saveApiKey, isSecretStorageAvailable } from './secrets';
import { t } from './i18n';
import { clearErrorLogs, getErrorLogFolderPath, getErrorLogStats, logError } from './utils/errorLog';
import { clearOperationLogs, getOperationLogFileCount, getOperationLogEntryCount, logOperation } from './utils/operationLog';
import type { LogLevel } from './utils/logFiles';
import type { ContextBudgetPreset } from './utils/contentFilter';
import type { OpenAiCompatibleTokenLimitParam, DetectedOpenAiCompatibleTokenLimitParam } from './openAiCompatible';
import { buildOpenAiCompatibleTokenLimitDetectionKey } from './openAiCompatible';
import { validateFolderPath } from './utils/folder';

export type InboxCuratorProvider = 'openai-compatible' | 'gemini-native' | 'anthropic-native';

export interface InboxCuratorSettings {
  watchedFolder: string;
  reviewOutputFolder: string;
  provider: InboxCuratorProvider;
  endpointUrl: string;
  model: string;
  maxNotesPerRun: number;
  maxConcurrentReviews: number;
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
  optimizeImagesForAi: boolean;
  readVideos: boolean;
  autoExecuteProposedActions: boolean;
  autoExecuteArchive: boolean;
  autoExecuteReadLater: boolean;
  autoExecuteTask: boolean;
  readLaterFolder: string;
  taskFolder: string;
  deleteCandidateFolder: string;
  requestTimeoutMs: number;
  promptLanguage: 'auto' | 'japanese' | 'english' | 'note-language' | 'match-obsidian';
  customReviewPrompt: string;
  suggestedFolderBasePath: string;
  extractPdfText: boolean;
  showProcessingMarkerInFileName: boolean;
  contextBudgetPreset: ContextBudgetPreset;
  customMaxContextTokens: number;
  customMaxInputContentTokens: number;
  customMaxOutputTokens: number;
  customSafetyMarginTokens: number;
  reviewMode: import('./types').ReviewMode;
  openAiCompatibleTokenLimitParam: OpenAiCompatibleTokenLimitParam;
  openAiCompatibleDetectedTokenLimitParam: DetectedOpenAiCompatibleTokenLimitParam;
  openAiCompatibleDetectedTokenLimitAt: string | undefined;
  openAiCompatibleDetectedTokenLimitKey: string | undefined;
  collectionReviewOutputFolder: string;
  collectionReviewUseExistingReviewsFirst: boolean;
  collectionReviewIncludeExcerptWhenNeeded: boolean;
  collectionReviewMaxNotes: number;
  collectionReviewMaxExcerptCharsPerNote: number;
  enableContextMenu: boolean;
  contextMenuReviewCurrentNote: boolean;
  contextMenuExecuteProposedAction: boolean;
  contextMenuCleanupMarkers: boolean;
  contextMenuUndoAutoSort: boolean;
  contextMenuReviewFolderAsCollection: boolean;
  contextMenuProcessWatchedFolder: boolean;
  contextMenuReviewSelectedAsCollection: boolean;
  contextMenuExecuteSelectedActions: boolean;
  contextMenuReviewSelected: boolean;
  logLevel: LogLevel;
}

export const DEFAULT_SETTINGS: InboxCuratorSettings = {
  watchedFolder: 'Inbox',
  reviewOutputFolder: 'AI Reviews',
  provider: 'openai-compatible',
  endpointUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  maxNotesPerRun: 10,
  maxConcurrentReviews: 1,
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
  optimizeImagesForAi: false,
  readVideos: false,
  autoExecuteProposedActions: false,
  autoExecuteArchive: false,
  autoExecuteReadLater: false,
  autoExecuteTask: false,
  readLaterFolder: 'Read Later',
  taskFolder: 'Tasks',
  deleteCandidateFolder: 'Delete Candidates',
  requestTimeoutMs: 60000,
  promptLanguage: 'match-obsidian',
  customReviewPrompt: '',
  suggestedFolderBasePath: '',
  extractPdfText: false,
  showProcessingMarkerInFileName: false,
  contextBudgetPreset: 'standard',
  customMaxContextTokens: 32000,
  customMaxInputContentTokens: 20000,
  customMaxOutputTokens: 4096,
  customSafetyMarginTokens: 3000,
  reviewMode: 'standard',
  // Default is 'standard' to preserve existing behavior.
  // Users who need cheap/weak models should switch to 'simple'.
  openAiCompatibleTokenLimitParam: 'auto',
  openAiCompatibleDetectedTokenLimitParam: 'unknown',
  openAiCompatibleDetectedTokenLimitAt: undefined,
  openAiCompatibleDetectedTokenLimitKey: undefined,
  collectionReviewOutputFolder: 'Collection Reviews',
  collectionReviewUseExistingReviewsFirst: true,
  collectionReviewIncludeExcerptWhenNeeded: true,
  collectionReviewMaxNotes: 30,
  collectionReviewMaxExcerptCharsPerNote: 2000,
  enableContextMenu: true,
  contextMenuReviewCurrentNote: true,
  contextMenuExecuteProposedAction: true,
  contextMenuCleanupMarkers: false,
  contextMenuUndoAutoSort: false,
  contextMenuReviewFolderAsCollection: true,
  contextMenuProcessWatchedFolder: true,
  contextMenuReviewSelectedAsCollection: true,
  contextMenuExecuteSelectedActions: true,
  contextMenuReviewSelected: true,
  logLevel: 'errors',
};

export const MAX_CUSTOM_REVIEW_PROMPT_LENGTH = 3000;

function clampInteger(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.round(value)));
}

function getVaultFolders(app: App): string[] {
  const folders: string[] = [];
  const files = app.vault.getAllLoadedFiles();
  for (const file of files) {
    if (file instanceof TFolder && file.path !== '/') {
      folders.push(file.path);
    }
  }
  return folders.sort((a, b) => a.localeCompare(b));
}

function attachFolderStatusIndicator(
  inputEl: HTMLInputElement,
  app: App,
  getValue: () => string,
  isRequired: boolean,
): () => void {
  const statusEl = inputEl.ownerDocument.createElement('span');
  statusEl.className = 'inbox-curator-folder-status';
  inputEl.insertAdjacentElement('afterend', statusEl);

  const update = () => {
    const path = getValue().trim();
    if (!path) {
      statusEl.textContent = '';
      statusEl.className = 'inbox-curator-folder-status';
      return;
    }
    const ref = app.vault.getAbstractFileByPath(normalizePath(path));
    if (ref instanceof TFolder) {
      statusEl.textContent = '✓';
      statusEl.className = 'inbox-curator-folder-status inbox-curator-folder-status-ok';
    } else if (isRequired) {
      statusEl.textContent = '✗';
      statusEl.className = 'inbox-curator-folder-status inbox-curator-folder-status-missing';
    } else {
      statusEl.textContent = '+';
      statusEl.className = 'inbox-curator-folder-status inbox-curator-folder-status-created';
    }
  };

  update();
  return update;
}

function buildConnectionFailureNotice(status: number | undefined, responseBody: string | undefined, error: string): string {
  const normalizedResponse = responseBody?.toLowerCase() ?? '';

  if (status === 429 && normalizedResponse.includes('prepayment credits are depleted')) {
    return t('settings.connectionTest.failedGoogleCredits');
  }

  if (status) {
    return t('settings.connectionTest.failedHttp', { status });
  }

  return t('settings.connectionTest.failedGeneric', { error });
}

function detectedLabel(detected: DetectedOpenAiCompatibleTokenLimitParam): string {
  if (detected === 'max_tokens' || detected === 'max_completion_tokens') {
    return detected;
  }
  if (detected === 'none') return 'none';
  return 'unknown';
}

function buildSafeSnippet(value: string | undefined, maxLength = 160): string | undefined {
  const normalized = value?.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return undefined;
  }

  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength)}…`;
}

export interface SettingsUiVisibility {
  showAutomaticWatchingDetails: boolean;
  showPollingDetails: boolean;
  showArticleExtractionDetails: boolean;
}

export function getSettingsUiVisibility(settings: InboxCuratorSettings): SettingsUiVisibility {
  return {
    showAutomaticWatchingDetails: settings.enableAutomaticWatching,
    showPollingDetails: settings.enablePolling,
    showArticleExtractionDetails: settings.extractUrlArticleText,
  };
}

export class InboxCuratorSettingTab extends PluginSettingTab {
  plugin: InboxCuratorPlugin;
  private customPromptNoticeDebounce = false;
  private lastConnectionStatus: { ok: boolean; model: string; time: string } | null = null;
  private autoDetailsOpen = false;
  private customPromptDetailsOpen = false;
  private pacingDetailsOpen = false;

  constructor(app: App, plugin: InboxCuratorPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  private createCardContainer(containerEl: HTMLElement, title: string, description?: string): HTMLDivElement {
    const card = containerEl.createDiv({ cls: 'inbox-curator-settings-card' });
    new Setting(card).setName(title).setHeading();
    if (description) {
      card.createEl('p', { text: description, cls: 'inbox-curator-section-desc' });
    }
    return card;
  }

  private applyFolderValidation(value: string, defaultValue: string): { sanitized: string; changed: boolean } {
    const result = validateFolderPath(value, defaultValue);
    if (result.changed && result.reason === 'dot_prefix') {
      new Notice(t('settings.validation.dotPrefix'));
    }
    return { sanitized: result.sanitized, changed: result.changed };
  }

  display(): void {
    const { containerEl } = this;
    const settings = this.plugin.settings;
    const visibility = getSettingsUiVisibility(settings);
    containerEl.empty();

    new Setting(containerEl).setName(t('settings.title')).setHeading();

    const folders = getVaultFolders(this.app);
    const datalistId = 'inbox-curator-folders-list';
    const ownerDoc = containerEl.ownerDocument;
    let datalist = ownerDoc.getElementById(datalistId) as HTMLDataListElement | null;
    if (!datalist) {
      datalist = ownerDoc.createElement('datalist');
      datalist.id = datalistId;
      ownerDoc.body.appendChild(datalist);
    }
    datalist.empty();
    for (const folder of folders) {
      const option = ownerDoc.createElement('option');
      option.value = folder;
      datalist.appendChild(option);
    }

    // メタインフォボックス (警告/ヘルプの整理)
    const metaInfo = containerEl.createDiv({ cls: 'inbox-curator-meta-info' });
    metaInfo.createEl('p', { text: t('settings.subTitle.keySaved') });
    metaInfo.createEl('p', { text: t('settings.subTitle.settingsSaved') });

    // ── 1. Provider & Credentials ──
    const apiCard = this.createCardContainer(containerEl, '🔑 ' + t('settings.provider.title'), t('settings.provider.desc'));

    if (!isSecretStorageAvailable(this.app)) {
      const warningDiv = apiCard.createDiv({
        cls: 'inbox-curator-callout',
      });
      warningDiv.createEl('p', {
        text: t('settings.apiKey.warning.secretStorageUnavailable'),
      });
    }

    new Setting(apiCard)
      .setName(t('settings.provider.label'))
      .setDesc(t('settings.provider.dropdownDesc'))
      .addDropdown((dropdown) =>
        dropdown
          .addOption('openai-compatible', 'OpenAI Compatible')
          .addOption('gemini-native', 'Gemini Native')
          .addOption('anthropic-native', 'Anthropic Native')
          .setValue(settings.provider)
          .onChange(async (value) => {
            settings.provider = value as InboxCuratorProvider;
            const defaultEndpoints: Record<InboxCuratorProvider, string> = {
              'openai-compatible': 'https://api.openai.com/v1',
              'gemini-native': 'https://generativelanguage.googleapis.com',
              'anthropic-native': 'https://api.anthropic.com',
            };
            const defaultModels: Record<InboxCuratorProvider, string> = {
              'openai-compatible': 'gpt-4o-mini',
              'gemini-native': 'gemini-1.5-flash',
              'anthropic-native': 'claude-3-5-sonnet-latest',
            };
            settings.endpointUrl = defaultEndpoints[settings.provider];
            settings.model = defaultModels[settings.provider];
            await this.plugin.saveSettings();
            this.display();
          }),
      );

    if (settings.provider === 'openai-compatible') {
      new Setting(apiCard)
        .setName(t('settings.endpointUrl.label'))
        .setDesc(t('settings.endpointUrl.desc'))
        .addText((text) =>
          text
            .setPlaceholder(DEFAULT_SETTINGS.endpointUrl)
            .setValue(settings.endpointUrl)
            .onChange(async (value) => {
              settings.endpointUrl = value.trim() || DEFAULT_SETTINGS.endpointUrl;
              settings.openAiCompatibleDetectedTokenLimitParam = 'unknown';
              settings.openAiCompatibleDetectedTokenLimitAt = undefined;
              settings.openAiCompatibleDetectedTokenLimitKey = undefined;
              await this.plugin.saveSettings();
            }),
        );

      new Setting(apiCard)
        .setName(t('settings.openAiTokenLimitParam.label'))
        .setDesc(t('settings.openAiTokenLimitParam.desc'))
        .addDropdown((dropdown) =>
          dropdown
            .addOption('auto', t('settings.openAiTokenLimitParam.auto'))
            .addOption('max_tokens', 'max_tokens')
            .addOption('max_completion_tokens', 'max_completion_tokens')
            .addOption('none', t('settings.openAiTokenLimitParam.none'))
            .setValue(settings.openAiCompatibleTokenLimitParam)
            .onChange(async (value) => {
              settings.openAiCompatibleTokenLimitParam = value as OpenAiCompatibleTokenLimitParam;
              await this.plugin.saveSettings();
            }),
        );

      if (settings.openAiCompatibleTokenLimitParam === 'auto') {
        const currentKey = buildOpenAiCompatibleTokenLimitDetectionKey(settings.endpointUrl, settings.model);
        const keyMatches = settings.openAiCompatibleDetectedTokenLimitKey === currentKey;
        const isStale = settings.openAiCompatibleDetectedTokenLimitKey !== undefined && !keyMatches;
        let detectedText: string;
        if (isStale || settings.openAiCompatibleDetectedTokenLimitParam === 'unknown' || !keyMatches) {
          detectedText = t('settings.openAiTokenLimitParam.detectedUnknown');
        } else {
          detectedText = t('settings.openAiTokenLimitParam.detected', { param: detectedLabel(settings.openAiCompatibleDetectedTokenLimitParam) });
        }
        apiCard.createDiv({ cls: 'inbox-curator-meta-info', text: detectedText });
      } else {
        apiCard.createDiv({ cls: 'inbox-curator-meta-info', text: t('settings.openAiTokenLimitParam.manualOverride') });
      }
    }

    new Setting(apiCard)
      .setName(t('settings.model.label'))
      .setDesc(t('settings.model.desc'))
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_SETTINGS.model)
          .setValue(settings.model)
          .onChange(async (value) => {
            settings.model = value.trim() || DEFAULT_SETTINGS.model;
            settings.openAiCompatibleDetectedTokenLimitParam = 'unknown';
            settings.openAiCompatibleDetectedTokenLimitAt = undefined;
            settings.openAiCompatibleDetectedTokenLimitKey = undefined;
            await this.plugin.saveSettings();
          }),
      );

    const apiKeySetting = new Setting(apiCard)
      .setName(t('settings.apiKey.label'))
      .setDesc(t('settings.apiKey.desc', { secretId: getApiKeySecretId(settings.provider) }));

    void hasApiKey(this.app, settings.provider).then((saved) => {
      const badgeClass = saved ? 'status-saved' : 'status-missing';
      const badgeText = saved ? t('settings.apiKey.badge.saved') : t('settings.apiKey.badge.missing');
      apiKeySetting.nameEl.createSpan({
        cls: `inbox-curator-badge ${badgeClass}`,
        text: badgeText,
      });
    });

    let draftValue = '';
    let hasEditedApiKey = false;

    apiKeySetting.addText((text) => {
      text.inputEl.type = 'text';
      text.setPlaceholder(t('settings.apiKey.placeholder'));

      void getApiKey(this.app, settings.provider).then((key) => {
        text.setValue(key ? buildApiKeyMask(key) : '');
      });

      text.inputEl.addEventListener('focus', () => {
        if (isMaskedApiKeyValue(text.inputEl.value)) {
          text.setValue('');
        }
      });

      text.inputEl.addEventListener('blur', () => {
        const trimmed = text.inputEl.value.trim();
        if (trimmed === '' || isMaskedApiKeyValue(trimmed)) {
          void getApiKey(this.app, settings.provider).then((key) => {
            if (key) {
              text.setValue(buildApiKeyMask(key));
            } else {
              text.setValue('');
            }
            draftValue = '';
            hasEditedApiKey = false;
          });
        }
      });

      text.onChange((value) => {
        const trimmed = value.trim();
        if (isMaskedApiKeyValue(trimmed)) {
          draftValue = '';
          hasEditedApiKey = false;
          return;
        }

        hasEditedApiKey = true;
        draftValue = trimmed;
      });
    });

    apiKeySetting.addButton((button) =>
      button.setButtonText(t('settings.apiKey.button.save')).onClick(() => { void (async () => {
        if (!hasEditedApiKey || !draftValue || isMaskedApiKeyValue(draftValue)) {
          new Notice(t('settings.apiKey.noKey'));
          return;
        }

        try {
          await saveApiKey(this.app, settings.provider, draftValue);
          draftValue = '';
          hasEditedApiKey = false;
          this.display();
          new Notice(t('settings.apiKey.savedNotice'));
        } catch (error) {
          new Notice(t('notice.apiKeySaveFailed'));
          void logError(this.app, 'ERROR', 'Inbox Curator API key save failed', {
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      })(); }),
    );

    apiKeySetting.addButton((button) =>
      button.setButtonText(t('settings.apiKey.button.delete')).setWarning().onClick(() => { void (async () => {
        try {
          await deleteApiKey(this.app, settings.provider);
          draftValue = '';
          hasEditedApiKey = false;
          this.display();
          new Notice(t('settings.apiKey.deletedNotice'));
        } catch (error) {
          new Notice(t('notice.apiKeyDeleteFailed'));
          void logError(this.app, 'ERROR', 'Inbox Curator API key delete failed', {
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      })(); }),
    );

    new Setting(apiCard)
      .setName(t('settings.connectionTest.label'))
      .setDesc(t('settings.connectionTest.desc'))
      .addButton((button) =>
        button.setButtonText(t('settings.connectionTest.button')).onClick(() => { void (async () => {
        try {
          const defaultEndpoints: Record<InboxCuratorProvider, string> = {
            'openai-compatible': 'https://api.openai.com/v1',
            'gemini-native': 'https://generativelanguage.googleapis.com',
            'anthropic-native': 'https://api.anthropic.com',
          };
          const defaultModels: Record<InboxCuratorProvider, string> = {
            'openai-compatible': 'gpt-4o-mini',
            'gemini-native': 'gemini-1.5-flash',
            'anthropic-native': 'claude-3-5-sonnet-latest',
          };

          const apiKeyCandidate = hasEditedApiKey && draftValue ? draftValue : await getApiKey(this.app, settings.provider);
          if (!apiKeyCandidate || isMaskedApiKeyValue(apiKeyCandidate)) {
            new Notice(t('settings.connectionTest.failedMissingKey'));
            return;
          }

          const result = await testConnection({
            provider: settings.provider,
            endpointUrl: settings.endpointUrl.trim() || defaultEndpoints[settings.provider],
            model: settings.model.trim() || defaultModels[settings.provider],
            apiKey: apiKeyCandidate,
            timeoutMs: settings.requestTimeoutMs,
            openAiTokenLimitParam: settings.openAiCompatibleTokenLimitParam,
          });

          if (result.ok === true) {
            this.lastConnectionStatus = { ok: true, model: settings.model, time: new Date().toISOString() };

            void logOperation(this.app, {
              timestamp: new Date().toISOString(),
              level: 'INFO',
              event: 'connection_test_succeeded',
              provider: settings.provider,
              model: settings.model,
              details: result.detectedTokenLimitParam ? { detectedTokenParam: result.detectedTokenLimitParam } : undefined,
            });

            // Save detected token limit param for OpenAI-compatible (auto mode only)
            if (result.detectedTokenLimitParam && settings.openAiCompatibleTokenLimitParam === 'auto') {
              settings.openAiCompatibleDetectedTokenLimitParam = result.detectedTokenLimitParam;
              settings.openAiCompatibleDetectedTokenLimitAt = new Date().toISOString();
              settings.openAiCompatibleDetectedTokenLimitKey = buildOpenAiCompatibleTokenLimitDetectionKey(settings.endpointUrl, settings.model);
              await this.plugin.saveSettings();
            }

            const detectedMsg = result.detectedTokenLimitParam
              ? '. ' + t('settings.connectionTest.tokenLimitDetected', { param: detectedLabel(result.detectedTokenLimitParam) })
              : '';
            if (hasEditedApiKey && draftValue) {
              new Notice(t('settings.connectionTest.successUnsaved') + detectedMsg);
            } else {
              new Notice(t('settings.connectionTest.success') + detectedMsg);
            }
          } else {
            this.lastConnectionStatus = { ok: false, model: settings.model, time: new Date().toISOString() };
            new Notice(buildConnectionFailureNotice(result.status, result.responseBody, result.error));
            void logOperation(this.app, {
              timestamp: new Date().toISOString(),
              level: 'ERROR',
              event: 'connection_test_failed',
              provider: settings.provider,
              model: settings.model,
              statusCode: result.status,
              message: result.error,
            });
            void logError(this.app, 'ERROR', 'Inbox Curator connection test failed', {
              provider: settings.provider,
              endpointUrl: settings.endpointUrl,
              model: settings.model,
              status: result.status,
              error: result.error,
              responseSnippet: buildSafeSnippet(result.responseBody),
            });
          }
          this.display();
        } catch (error) {
          this.lastConnectionStatus = { ok: false, model: settings.model, time: new Date().toISOString() };
          new Notice(t('settings.connectionTest.failedGeneric', { error: error instanceof Error ? error.message : 'Unknown error' }));
          void logError(this.app, 'ERROR', 'Inbox Curator connection test failed', {
            error: error instanceof Error ? error.message : 'Unknown error',
          });
          this.display();
        }
      })(); }),
      );

    const lastStatusText = this.lastConnectionStatus
      ? t('settings.connectionTest.lastStatus', {
          status: `${this.lastConnectionStatus.ok ? '✅' : '❌'} ${this.lastConnectionStatus.model} (${new Date(this.lastConnectionStatus.time).toLocaleTimeString()})`,
        })
      : t('settings.connectionTest.lastStatusNone');
    apiCard.createDiv({ cls: 'inbox-curator-meta-info', text: lastStatusText });

    // ── 2. Logs ──
    const logCard = this.createCardContainer(containerEl, '📋 ' + t('settings.logs.sectionTitle'), t('settings.logs.sectionDesc'));

    new Setting(logCard)
      .setName(t('settings.logs.level.label'))
      .setDesc(t('settings.logs.level.desc'))
      .addDropdown((dropdown) =>
        dropdown
          .addOption('off', t('settings.logs.level.off'))
          .addOption('errors', t('settings.logs.level.errors'))
          .addOption('operations', t('settings.logs.level.operations'))
          .setValue(settings.logLevel)
          .onChange(async (value) => {
            settings.logLevel = value as LogLevel;
            await this.plugin.saveSettings();
          }),
      );

    const logSetting = new Setting(logCard);
    logSetting.settingEl.addClass('inbox-curator-error-log-setting');
    logSetting
      .addButton((button) =>
        button.setButtonText(t('settings.logs.openButton')).onClick(() => {
          Promise.resolve().then(async () => {
            const logFolder = getErrorLogFolderPath();
            const adapter = this.app.vault.adapter as unknown as { getFullPath(path: string): string };
            const fullPath = adapter.getFullPath(normalizePath(logFolder));
            try {
                interface DesktopApp {
                  showInFolder?(path: string): void;
                  openWithDefaultApp?(path: string): void;
                }
                const desktopApp = this.app as unknown as DesktopApp;
                if (desktopApp.showInFolder) {
                  desktopApp.showInFolder(fullPath);
                } else if (desktopApp.openWithDefaultApp) {
                  desktopApp.openWithDefaultApp(fullPath);
              } else {
                window.open(`file://${fullPath}`);
              }
            } catch {
              new Notice(`Log folder: ${fullPath}`);
            }
          }).catch(console.error);
        }),
      )
      .addButton((button) =>
        button.setButtonText(t('settings.logs.clearButton')).onClick(() => {
          Promise.resolve().then(async () => {
            try {
              await clearErrorLogs(this.app);
              await clearOperationLogs(this.app);
              new Notice(t('settings.logs.clearedNotice'));
              this.display();
            } catch (error) {
              new Notice(t('settings.logs.clearFailedNotice'));
              void logError(this.app, 'ERROR', 'Inbox Curator log clear failed', {
                error: error instanceof Error ? error.message : 'Unknown error',
              });
            }
          }).catch(console.error);
        }),
      );

    void getErrorLogStats(this.app).then(async (stats) => {
      const opFileCount = await getOperationLogFileCount(this.app);
      const opEntryCount = await getOperationLogEntryCount(this.app);
      const lines: string[] = [];
      if (stats.totalEntries === 0 && opEntryCount === 0) {
        lines.push(t('settings.logs.noLogs'));
      } else {
        lines.push(t('settings.logs.errorLogStatus', { total: stats.totalEntries, today: stats.todayEntries }));
        if (settings.logLevel === 'operations') {
          lines.push(t('settings.logs.operationLogStatus', { files: opFileCount, entries: opEntryCount }));
        }
      }
      logSetting.setDesc(lines.join('\n'));
    });

    // ── 3. Folders & Scope ──
    const scopeCard = this.createCardContainer(containerEl, '📁 ' + t('settings.folders.title'), t('settings.folders.desc'));

    let watchedFolderStatusEl: HTMLElement | null = null;
    const updateWatchedFolderStatus = () => {
      if (!watchedFolderStatusEl) return;
      const path = settings.watchedFolder.trim();
      if (!path) {
        watchedFolderStatusEl.textContent = '';
        watchedFolderStatusEl.className = 'inbox-curator-folder-status';
        return;
      }
      const ref = this.app.vault.getAbstractFileByPath(normalizePath(path));
      if (ref instanceof TFolder) {
        watchedFolderStatusEl.textContent = '\u2713';
        watchedFolderStatusEl.className = 'inbox-curator-folder-status inbox-curator-folder-status-ok';
      } else {
        watchedFolderStatusEl.textContent = '\u2717';
        watchedFolderStatusEl.className = 'inbox-curator-folder-status inbox-curator-folder-status-missing';
      }
    };
    const watchedFolderSetting = new Setting(scopeCard)
      .setName(t('settings.watchedFolder.label'))
      .setDesc(t('settings.watchedFolder.desc'))
      .addText((text) => {
        text
          .setPlaceholder(t('settings.watchedFolder.placeholder'))
          .setValue(settings.watchedFolder)
          .onChange(async (value) => {
            const result = this.applyFolderValidation(value, DEFAULT_SETTINGS.watchedFolder);
            if (result.changed) {
              text.setValue(result.sanitized);
            }
            settings.watchedFolder = result.sanitized;
            await this.plugin.saveSettings();
            updateWatchedFolderStatus();
          });
        text.inputEl.setAttribute('list', datalistId);
        watchedFolderStatusEl = text.inputEl.ownerDocument.createElement('span');
        watchedFolderStatusEl.className = 'inbox-curator-folder-status';
        text.inputEl.insertAdjacentElement('afterend', watchedFolderStatusEl);
        updateWatchedFolderStatus();
      });

    let reviewOutputStatusEl: HTMLElement | null = null;
    const updateReviewOutputStatus = () => {
      if (!reviewOutputStatusEl) return;
      const path = settings.reviewOutputFolder.trim();
      if (!path) {
        reviewOutputStatusEl.textContent = '';
        reviewOutputStatusEl.className = 'inbox-curator-folder-status';
        return;
      }
      const ref = this.app.vault.getAbstractFileByPath(normalizePath(path));
      if (ref instanceof TFolder) {
        reviewOutputStatusEl.textContent = '\u2713';
        reviewOutputStatusEl.className = 'inbox-curator-folder-status inbox-curator-folder-status-ok';
      } else {
        reviewOutputStatusEl.textContent = '+';
        reviewOutputStatusEl.className = 'inbox-curator-folder-status inbox-curator-folder-status-created';
      }
    };
    const reviewOutputSetting = new Setting(scopeCard)
      .setName(t('settings.reviewOutputFolder.label'))
      .setDesc(t('settings.reviewOutputFolder.desc'))
      .addText((text) => {
        text
          .setPlaceholder(t('settings.reviewOutputFolder.placeholder'))
          .setValue(settings.reviewOutputFolder)
          .onChange(async (value) => {
            const result = this.applyFolderValidation(value, DEFAULT_SETTINGS.reviewOutputFolder);
            if (result.changed) {
              text.setValue(result.sanitized);
            }
            settings.reviewOutputFolder = result.sanitized;
            await this.plugin.saveSettings();
            updateReviewOutputStatus();
          });
        text.inputEl.setAttribute('list', datalistId);
        reviewOutputStatusEl = text.inputEl.ownerDocument.createElement('span');
        reviewOutputStatusEl.className = 'inbox-curator-folder-status';
        text.inputEl.insertAdjacentElement('afterend', reviewOutputStatusEl);
        updateReviewOutputStatus();
      });

    let suggestedFolderStatusEl: HTMLElement | null = null;
    const updateSuggestedFolderStatus = () => {
      if (!suggestedFolderStatusEl) return;
      const path = settings.suggestedFolderBasePath.trim();
      if (!path) {
        suggestedFolderStatusEl.textContent = '';
        suggestedFolderStatusEl.className = 'inbox-curator-folder-status';
        return;
      }
      const ref = this.app.vault.getAbstractFileByPath(normalizePath(path));
      if (ref instanceof TFolder) {
        suggestedFolderStatusEl.textContent = '\u2713';
        suggestedFolderStatusEl.className = 'inbox-curator-folder-status inbox-curator-folder-status-ok';
      } else {
        suggestedFolderStatusEl.textContent = '+';
        suggestedFolderStatusEl.className = 'inbox-curator-folder-status inbox-curator-folder-status-created';
      }
    };
    const suggestedFolderSetting = new Setting(scopeCard)
      .setName(t('settings.suggestedFolderBasePath.label'))
      .setDesc(t('settings.suggestedFolderBasePath.desc'))
      .addText((text) => {
        text
          .setPlaceholder(t('settings.suggestedFolderBasePath.placeholder'))
          .setValue(settings.suggestedFolderBasePath)
          .onChange(async (value) => {
            settings.suggestedFolderBasePath = value.trim();
            await this.plugin.saveSettings();
            updateSuggestedFolderStatus();
          });
        text.inputEl.setAttribute('list', datalistId);
        suggestedFolderStatusEl = text.inputEl.ownerDocument.createElement('span');
        suggestedFolderStatusEl.className = 'inbox-curator-folder-status';
        text.inputEl.insertAdjacentElement('afterend', suggestedFolderStatusEl);
        updateSuggestedFolderStatus();
      });

    let deleteCandidateStatusEl: HTMLElement | null = null;
    const updateDeleteCandidateStatus = () => {
      if (!deleteCandidateStatusEl) return;
      const path = settings.deleteCandidateFolder.trim();
      if (!path) {
        deleteCandidateStatusEl.textContent = '';
        deleteCandidateStatusEl.className = 'inbox-curator-folder-status';
        return;
      }
      const ref = this.app.vault.getAbstractFileByPath(normalizePath(path));
      if (ref instanceof TFolder) {
        deleteCandidateStatusEl.textContent = '\u2713';
        deleteCandidateStatusEl.className = 'inbox-curator-folder-status inbox-curator-folder-status-ok';
      } else {
        deleteCandidateStatusEl.textContent = '+';
        deleteCandidateStatusEl.className = 'inbox-curator-folder-status inbox-curator-folder-status-created';
      }
    };
    const deleteCandidateSetting = new Setting(scopeCard)
      .setName(t('settings.deleteCandidateFolder.label'))
      .setDesc(t('settings.deleteCandidateFolder.desc'))
      .addText((text) => {
        text
          .setPlaceholder('Delete Candidates')
          .setValue(settings.deleteCandidateFolder)
          .onChange(async (value) => {
            const result = this.applyFolderValidation(value, DEFAULT_SETTINGS.deleteCandidateFolder);
            if (result.changed) {
              text.setValue(result.sanitized);
            }
            settings.deleteCandidateFolder = result.sanitized;
            await this.plugin.saveSettings();
            updateDeleteCandidateStatus();
          });
        text.inputEl.setAttribute('list', datalistId);
        deleteCandidateStatusEl = text.inputEl.ownerDocument.createElement('span');
        deleteCandidateStatusEl.className = 'inbox-curator-folder-status';
        text.inputEl.insertAdjacentElement('afterend', deleteCandidateStatusEl);
        updateDeleteCandidateStatus();
      });

    // ── 4. Automation ──
    const autoCard = this.createCardContainer(containerEl, '⚡ ' + t('settings.automation.title'), t('settings.automation.desc'));

    new Setting(autoCard)
      .setName(t('settings.autoWatch.label'))
      .setDesc(t('settings.autoWatch.desc'))
      .addToggle((toggle) =>
        toggle.setValue(settings.enableAutomaticWatching).onChange(async (value) => {
          settings.enableAutomaticWatching = value;
          await this.plugin.saveSettings();
          this.display();
        }),
      );

    new Setting(autoCard).setName(t('settings.autoExecute.sectionTitle')).setHeading();

    new Setting(autoCard)
      .setName(t('settings.autoExecuteArchive.label'))
      .setDesc(t('settings.autoExecuteArchive.desc'))
      .addToggle((toggle) =>
        toggle.setValue(settings.autoExecuteArchive).onChange(async (value) => {
          settings.autoExecuteArchive = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(autoCard)
      .setName(t('settings.autoExecuteReadLater.label'))
      .setDesc(t('settings.autoExecuteReadLater.desc'))
      .addToggle((toggle) =>
        toggle.setValue(settings.autoExecuteReadLater).onChange(async (value) => {
          settings.autoExecuteReadLater = value;
          await this.plugin.saveSettings();
          this.display();
        }),
      );

    if (settings.autoExecuteReadLater) {
      let readLaterStatusEl: HTMLElement | null = null;
      const updateReadLaterStatus = () => {
        if (!readLaterStatusEl) return;
        const path = settings.readLaterFolder.trim();
        if (!path) {
          readLaterStatusEl.textContent = '';
          readLaterStatusEl.className = 'inbox-curator-folder-status';
          return;
        }
        const ref = this.app.vault.getAbstractFileByPath(normalizePath(path));
        if (ref instanceof TFolder) {
          readLaterStatusEl.textContent = '\u2713';
          readLaterStatusEl.className = 'inbox-curator-folder-status inbox-curator-folder-status-ok';
        } else {
          readLaterStatusEl.textContent = '+';
          readLaterStatusEl.className = 'inbox-curator-folder-status inbox-curator-folder-status-created';
        }
      };
      const readLaterSetting = new Setting(autoCard)
        .setName(t('settings.readLaterFolder.label'))
        .setDesc(t('settings.readLaterFolder.desc'))
        .addText((text) => {
          text
            .setPlaceholder('Read Later')
            .setValue(settings.readLaterFolder)
            .onChange(async (value) => {
              const result = this.applyFolderValidation(value, DEFAULT_SETTINGS.readLaterFolder);
              if (result.changed) {
                text.setValue(result.sanitized);
              }
              settings.readLaterFolder = result.sanitized;
              await this.plugin.saveSettings();
              updateReadLaterStatus();
            });
          text.inputEl.setAttribute('list', datalistId);
          readLaterStatusEl = text.inputEl.ownerDocument.createElement('span');
          readLaterStatusEl.className = 'inbox-curator-folder-status';
          text.inputEl.insertAdjacentElement('afterend', readLaterStatusEl);
          updateReadLaterStatus();
        });
    }

    new Setting(autoCard)
      .setName(t('settings.autoExecuteTask.label'))
      .setDesc(t('settings.autoExecuteTask.desc'))
      .addToggle((toggle) =>
        toggle.setValue(settings.autoExecuteTask).onChange(async (value) => {
          settings.autoExecuteTask = value;
          await this.plugin.saveSettings();
          this.display();
        }),
      );

    if (settings.autoExecuteTask) {
      let taskFolderStatusEl: HTMLElement | null = null;
      const updateTaskFolderStatus = () => {
        if (!taskFolderStatusEl) return;
        const path = settings.taskFolder.trim();
        if (!path) {
          taskFolderStatusEl.textContent = '';
          taskFolderStatusEl.className = 'inbox-curator-folder-status';
          return;
        }
        const ref = this.app.vault.getAbstractFileByPath(normalizePath(path));
        if (ref instanceof TFolder) {
          taskFolderStatusEl.textContent = '\u2713';
          taskFolderStatusEl.className = 'inbox-curator-folder-status inbox-curator-folder-status-ok';
        } else {
          taskFolderStatusEl.textContent = '+';
          taskFolderStatusEl.className = 'inbox-curator-folder-status inbox-curator-folder-status-created';
        }
      };
      const taskFolderSetting = new Setting(autoCard)
        .setName(t('settings.taskFolder.label'))
        .setDesc(t('settings.taskFolder.desc'))
        .addText((text) => {
          text
            .setPlaceholder('Tasks')
            .setValue(settings.taskFolder)
            .onChange(async (value) => {
              const result = this.applyFolderValidation(value, DEFAULT_SETTINGS.taskFolder);
              if (result.changed) {
                text.setValue(result.sanitized);
              }
              settings.taskFolder = result.sanitized;
              await this.plugin.saveSettings();
              updateTaskFolderStatus();
            });
          text.inputEl.setAttribute('list', datalistId);
          taskFolderStatusEl = text.inputEl.ownerDocument.createElement('span');
          taskFolderStatusEl.className = 'inbox-curator-folder-status';
          text.inputEl.insertAdjacentElement('afterend', taskFolderStatusEl);
          updateTaskFolderStatus();
        });
    }



    autoCard.createEl('p', {
      text: t('settings.safety.note'),
      cls: 'inbox-curator-safety-note',
    });

    const autoDetails = autoCard.createEl('details');
    if (this.autoDetailsOpen) {
      autoDetails.setAttribute('open', '');
    }
    autoDetails.addEventListener('toggle', () => {
      this.autoDetailsOpen = autoDetails.hasAttribute('open');
    });
    autoDetails.createEl('summary', { text: t('settings.autoWatch.label'), cls: 'inbox-curator-sub-section-header' });

    if (visibility.showAutomaticWatchingDetails) {
      new Setting(autoDetails)
        .setName(t('settings.autoReviewCreate.label'))
        .setDesc(t('settings.autoReviewCreate.desc'))
        .addToggle((toggle) =>
          toggle.setValue(settings.autoReviewOnCreate).onChange(async (value) => {
            settings.autoReviewOnCreate = value;
            await this.plugin.saveSettings();
          }),
        );

      new Setting(autoDetails)
        .setName(t('settings.autoReviewModify.label'))
        .setDesc(t('settings.autoReviewModify.desc'))
        .addToggle((toggle) =>
          toggle.setValue(settings.autoReviewOnModify).onChange(async (value) => {
            settings.autoReviewOnModify = value;
            await this.plugin.saveSettings();
          }),
        );

      new Setting(autoDetails)
        .setName(t('settings.watchDebounce.label'))
        .setDesc(t('settings.watchDebounce.desc'))
        .addText((text) => {
          text.inputEl.type = 'number';
          text.inputEl.min = '0';
          text.inputEl.max = '60000';
          text.setPlaceholder(String(DEFAULT_SETTINGS.watchDebounceMs));
          text.setValue(String(settings.watchDebounceMs));
          text.onChange(async (value) => {
            settings.watchDebounceMs = clampInteger(Number(value), 0, 60000, DEFAULT_SETTINGS.watchDebounceMs);
            await this.plugin.saveSettings();
          });
        });
    }

    new Setting(autoDetails)
      .setName(t('settings.pollingFallback.label'))
      .setDesc(t('settings.pollingFallback.desc'))
      .addToggle((toggle) =>
        toggle.setValue(settings.enablePolling).onChange(async (value) => {
          settings.enablePolling = value;
          await this.plugin.saveSettings();
          this.display();
        }),
      );

    if (visibility.showPollingDetails) {
      new Setting(autoDetails)
        .setName(t('settings.pollingInterval.label'))
        .setDesc(t('settings.pollingInterval.desc'))
        .addText((text) => {
          text.inputEl.type = 'number';
          text.inputEl.min = '5000';
          text.inputEl.max = '600000';
          text.setPlaceholder(String(DEFAULT_SETTINGS.pollingIntervalMs));
          text.setValue(String(settings.pollingIntervalMs));
          text.onChange(async (value) => {
            settings.pollingIntervalMs = clampInteger(Number(value), 5000, 600000, DEFAULT_SETTINGS.pollingIntervalMs);
            await this.plugin.saveSettings();
          });
        });
    }

    new Setting(autoDetails)
      .setName(t('settings.processingMarker.label'))
      .setDesc(t('settings.processingMarker.desc'))
      .addToggle((toggle) =>
        toggle.setValue(settings.showProcessingMarkerInFileName).onChange(async (value) => {
          settings.showProcessingMarkerInFileName = value;
          await this.plugin.saveSettings();
          if (!value) {
            await this.plugin.cleanupEmojiPrefixFiles();
          }
        }),
      );

    // ── 5. URL & Context Extraction ──
    const urlCard = this.createCardContainer(containerEl, '🔗 ' + t('settings.urlExtraction.title'), t('settings.urlExtraction.desc'));

    new Setting(urlCard)
      .setName(t('settings.fetchMetadata.label'))
      .setDesc(t('settings.fetchMetadata.desc'))
      .addToggle((toggle) =>
        toggle.setValue(settings.fetchUrlMetadata).onChange(async (value) => {
          settings.fetchUrlMetadata = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(urlCard)
      .setName(t('settings.extractArticle.label'))
      .setDesc(t('settings.extractArticle.desc'))
      .addToggle((toggle) =>
        toggle.setValue(settings.extractUrlArticleText).onChange(async (value) => {
          settings.extractUrlArticleText = value;
          await this.plugin.saveSettings();
          this.display();
        }),
      );

    if (visibility.showArticleExtractionDetails) {
      new Setting(urlCard)
        .setName(t('settings.maxExtractedChars.label'))
        .setDesc(t('settings.maxExtractedChars.desc'))
        .addText((text) => {
          text.inputEl.type = 'number';
          text.inputEl.min = '1000';
          text.inputEl.max = '50000';
          text.setPlaceholder(String(DEFAULT_SETTINGS.maxExtractedCharacters));
          text.setValue(String(settings.maxExtractedCharacters));
          text.onChange(async (value) => {
            settings.maxExtractedCharacters = clampInteger(Number(value), 1000, 50000, DEFAULT_SETTINGS.maxExtractedCharacters);
            await this.plugin.saveSettings();
          });
        });
    }

    // ── 6. Attachments & Media ──
    const attachCard = this.createCardContainer(containerEl, '🖼️ ' + t('settings.attachments.title'), t('settings.attachments.desc'));

    new Setting(attachCard)
      .setName(t('settings.readImages.label'))
      .setDesc(t('settings.readImages.desc'))
      .addToggle((toggle) =>
        toggle.setValue(settings.readImages).onChange(async (value) => {
          settings.readImages = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(attachCard)
      .setName(t('settings.optimizeImagesForAi.label'))
      .setDesc(t('settings.optimizeImagesForAi.desc'))
      .addToggle((toggle) =>
        toggle.setValue(settings.optimizeImagesForAi).onChange(async (value) => {
          settings.optimizeImagesForAi = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(attachCard)
      .setName(t('settings.readVideos.label'))
      .setDesc(t('settings.readVideos.desc'))
      .addToggle((toggle) =>
        toggle.setValue(settings.readVideos).onChange(async (value) => {
          settings.readVideos = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(attachCard)
      .setName(t('settings.extractPdfText.label'))
      .setDesc(t('settings.extractPdfText.desc'))
      .addToggle((toggle) =>
        toggle.setValue(settings.extractPdfText).onChange(async (value) => {
          settings.extractPdfText = value;
          await this.plugin.saveSettings();
        }),
      );

    const attachmentsCallout = attachCard.createDiv({ cls: 'inbox-curator-callout inbox-curator-callout-info' });
    attachmentsCallout.createEl('p', { text: t('settings.pdfNote') });
    attachmentsCallout.createEl('p', { text: t('settings.attachments.limits') });

    // ── 7. Collection Review ──
    const collectionCard = this.createCardContainer(containerEl, '📚 ' + t('settings.collectionReview.title'), t('settings.collectionReview.desc'));

    let collectionOutputStatusEl: HTMLElement | null = null;
    const updateCollectionOutputStatus = () => {
      if (!collectionOutputStatusEl) return;
      const path = settings.collectionReviewOutputFolder.trim();
      if (!path) {
        collectionOutputStatusEl.textContent = '';
        collectionOutputStatusEl.className = 'inbox-curator-folder-status';
        return;
      }
      const ref = this.app.vault.getAbstractFileByPath(normalizePath(path));
      if (ref instanceof TFolder) {
        collectionOutputStatusEl.textContent = '\u2713';
        collectionOutputStatusEl.className = 'inbox-curator-folder-status inbox-curator-folder-status-ok';
      } else {
        collectionOutputStatusEl.textContent = '+';
        collectionOutputStatusEl.className = 'inbox-curator-folder-status inbox-curator-folder-status-created';
      }
    };
    const collectionOutputSetting = new Setting(collectionCard)
      .setName(t('settings.collectionReview.outputFolder.label'))
      .setDesc(t('settings.collectionReview.outputFolder.desc'))
      .addText((text) => {
        text
          .setPlaceholder('Collection Reviews')
          .setValue(settings.collectionReviewOutputFolder)
          .onChange(async (value) => {
            const result = this.applyFolderValidation(value, DEFAULT_SETTINGS.collectionReviewOutputFolder);
            if (result.changed) {
              text.setValue(result.sanitized);
            }
            settings.collectionReviewOutputFolder = result.sanitized;
            await this.plugin.saveSettings();
            updateCollectionOutputStatus();
          });
        text.inputEl.setAttribute('list', datalistId);
        collectionOutputStatusEl = text.inputEl.ownerDocument.createElement('span');
        collectionOutputStatusEl.className = 'inbox-curator-folder-status';
        text.inputEl.insertAdjacentElement('afterend', collectionOutputStatusEl);
        updateCollectionOutputStatus();
      });

    new Setting(collectionCard)
      .setName(t('settings.collectionReview.useExistingReviewsFirst.label'))
      .setDesc(t('settings.collectionReview.useExistingReviewsFirst.desc'))
      .addToggle((toggle) =>
        toggle.setValue(settings.collectionReviewUseExistingReviewsFirst).onChange(async (value) => {
          settings.collectionReviewUseExistingReviewsFirst = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(collectionCard)
      .setName(t('settings.collectionReview.includeExcerptWhenNeeded.label'))
      .setDesc(t('settings.collectionReview.includeExcerptWhenNeeded.desc'))
      .addToggle((toggle) =>
        toggle.setValue(settings.collectionReviewIncludeExcerptWhenNeeded).onChange(async (value) => {
          settings.collectionReviewIncludeExcerptWhenNeeded = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(collectionCard)
      .setName(t('settings.collectionReview.maxNotes.label'))
      .setDesc(t('settings.collectionReview.maxNotes.desc'))
      .addText((text) => {
        text.inputEl.type = 'number';
        text.inputEl.min = '2';
        text.inputEl.max = '100';
        text.setPlaceholder(String(DEFAULT_SETTINGS.collectionReviewMaxNotes));
        text.setValue(String(settings.collectionReviewMaxNotes));
        text.onChange(async (value) => {
          settings.collectionReviewMaxNotes = clampInteger(Number(value), 2, 100, DEFAULT_SETTINGS.collectionReviewMaxNotes);
          await this.plugin.saveSettings();
        });
      });

    new Setting(collectionCard)
      .setName(t('settings.collectionReview.maxExcerptChars.label'))
      .setDesc(t('settings.collectionReview.maxExcerptChars.desc'))
      .addText((text) => {
        text.inputEl.type = 'number';
        text.inputEl.min = '200';
        text.inputEl.max = '10000';
        text.setPlaceholder(String(DEFAULT_SETTINGS.collectionReviewMaxExcerptCharsPerNote));
        text.setValue(String(settings.collectionReviewMaxExcerptCharsPerNote));
        text.onChange(async (value) => {
          settings.collectionReviewMaxExcerptCharsPerNote = clampInteger(Number(value), 200, 10000, DEFAULT_SETTINGS.collectionReviewMaxExcerptCharsPerNote);
          await this.plugin.saveSettings();
        });
      });

    // ── 8. Context Menu ──
    const contextCard = this.createCardContainer(containerEl, '🖱️ ' + t('settings.contextMenu.title'), t('settings.contextMenu.desc'));

    new Setting(contextCard)
      .setName(t('settings.contextMenu.enable.label'))
      .setDesc(t('settings.contextMenu.enable.desc'))
      .addToggle((toggle) =>
        toggle.setValue(settings.enableContextMenu).onChange(async (value) => {
          settings.enableContextMenu = value;
          await this.plugin.saveSettings();
          this.display();
        }),
      );

    const ctxVisible = settings.enableContextMenu;

    new Setting(contextCard)
      .setName(t('settings.contextMenu.reviewCurrentNote.label'))
      .setDesc(t('settings.contextMenu.reviewCurrentNote.desc'))
      .addToggle((toggle) =>
        toggle.setValue(settings.contextMenuReviewCurrentNote).onChange(async (value) => {
          settings.contextMenuReviewCurrentNote = value;
          await this.plugin.saveSettings();
        }),
      )
      .setDisabled(!ctxVisible);

    new Setting(contextCard)
      .setName(t('settings.contextMenu.executeProposedAction.label'))
      .setDesc(t('settings.contextMenu.executeProposedAction.desc'))
      .addToggle((toggle) =>
        toggle.setValue(settings.contextMenuExecuteProposedAction).onChange(async (value) => {
          settings.contextMenuExecuteProposedAction = value;
          await this.plugin.saveSettings();
        }),
      )
      .setDisabled(!ctxVisible);

    new Setting(contextCard)
      .setName(t('settings.contextMenu.cleanupMarkers.label'))
      .setDesc(t('settings.contextMenu.cleanupMarkers.desc'))
      .addToggle((toggle) =>
        toggle.setValue(settings.contextMenuCleanupMarkers).onChange(async (value) => {
          settings.contextMenuCleanupMarkers = value;
          await this.plugin.saveSettings();
        }),
      )
      .setDisabled(!ctxVisible);

    new Setting(contextCard)
      .setName(t('settings.contextMenu.undoAutoSort.label'))
      .setDesc(t('settings.contextMenu.undoAutoSort.desc'))
      .addToggle((toggle) =>
        toggle.setValue(settings.contextMenuUndoAutoSort).onChange(async (value) => {
          settings.contextMenuUndoAutoSort = value;
          await this.plugin.saveSettings();
        }),
      )
      .setDisabled(!ctxVisible);

    new Setting(contextCard)
      .setName(t('settings.contextMenu.reviewFolderAsCollection.label'))
      .setDesc(t('settings.contextMenu.reviewFolderAsCollection.desc'))
      .addToggle((toggle) =>
        toggle.setValue(settings.contextMenuReviewFolderAsCollection).onChange(async (value) => {
          settings.contextMenuReviewFolderAsCollection = value;
          await this.plugin.saveSettings();
        }),
      )
      .setDisabled(!ctxVisible);

    new Setting(contextCard)
      .setName(t('settings.contextMenu.processWatchedFolder.label'))
      .setDesc(t('settings.contextMenu.processWatchedFolder.desc'))
      .addToggle((toggle) =>
        toggle.setValue(settings.contextMenuProcessWatchedFolder).onChange(async (value) => {
          settings.contextMenuProcessWatchedFolder = value;
          await this.plugin.saveSettings();
        }),
      )
      .setDisabled(!ctxVisible);

    new Setting(contextCard)
      .setName(t('settings.contextMenu.reviewSelectedAsCollection.label'))
      .setDesc(t('settings.contextMenu.reviewSelectedAsCollection.desc'))
      .addToggle((toggle) =>
        toggle.setValue(settings.contextMenuReviewSelectedAsCollection).onChange(async (value) => {
          settings.contextMenuReviewSelectedAsCollection = value;
          await this.plugin.saveSettings();
        }),
      )
      .setDisabled(!ctxVisible);

    new Setting(contextCard)
      .setName(t('settings.contextMenu.reviewSelected.label'))
      .setDesc(t('settings.contextMenu.reviewSelected.desc'))
      .addToggle((toggle) =>
        toggle.setValue(settings.contextMenuReviewSelected).onChange(async (value) => {
          settings.contextMenuReviewSelected = value;
          await this.plugin.saveSettings();
        }),
      )
      .setDisabled(!ctxVisible);

    new Setting(contextCard)
      .setName(t('settings.contextMenu.executeSelectedActions.label'))
      .setDesc(t('settings.contextMenu.executeSelectedActions.desc'))
      .addToggle((toggle) =>
        toggle.setValue(settings.contextMenuExecuteSelectedActions).onChange(async (value) => {
          settings.contextMenuExecuteSelectedActions = value;
          await this.plugin.saveSettings();
        }),
      )
      .setDisabled(!ctxVisible);

    // ── 9. Review Behavior ──
    const behaviorCard = this.createCardContainer(containerEl, '🧠 ' + t('settings.behavior.title'), t('settings.behavior.desc'));

    new Setting(behaviorCard)
      .setName(t('settings.promptLanguage.label'))
      .setDesc(t('settings.promptLanguage.desc'))
      .addDropdown((dropdown) =>
        dropdown
          .addOption('match-obsidian', t('settings.promptLanguage.matchObsidian'))
          .addOption('auto', t('settings.promptLanguage.auto'))
          .addOption('japanese', t('settings.promptLanguage.japanese'))
          .addOption('english', t('settings.promptLanguage.english'))
          .addOption('note-language', t('settings.promptLanguage.noteLanguage'))
          .setValue(settings.promptLanguage)
          .onChange(async (value) => {
            settings.promptLanguage = value as InboxCuratorSettings['promptLanguage'];
            await this.plugin.saveSettings();
          }),
      );

    new Setting(behaviorCard)
      .setName(t('settings.reviewMode.label'))
      .setDesc(t('settings.reviewMode.desc'))
      .addDropdown((dropdown) =>
        dropdown
          .addOption('standard', t('settings.reviewMode.standard'))
          .addOption('simple', t('settings.reviewMode.simple'))
          .addOption('safe', t('settings.reviewMode.safe'))
          .setValue(settings.reviewMode)
          .onChange(async (value) => {
            settings.reviewMode = value as import('./types').ReviewMode;
            await this.plugin.saveSettings();
          }),
      );

    const customPromptContainer = behaviorCard.createDiv({
      cls: 'inbox-curator-custom-prompt-setting',
    });

    new Setting(customPromptContainer).setName(t('settings.customReviewPrompt.label')).setHeading();

    customPromptContainer.createEl('p', {
      text: t('settings.customReviewPrompt.desc'),
      cls: 'setting-item-description',
    });

    const textArea = customPromptContainer.createEl('textarea', {
      cls: 'inbox-curator-custom-prompt-textarea',
      attr: {
        placeholder: t('settings.customReviewPrompt.placeholder'),
        rows: '6',
      },
    });

    textArea.value = settings.customReviewPrompt ?? '';

    const footer = customPromptContainer.createDiv({
      cls: 'inbox-curator-custom-prompt-footer',
    });

    const details = footer.createEl('details', {
      cls: 'inbox-curator-custom-prompt-details',
    });
    if (this.customPromptDetailsOpen) {
      details.setAttribute('open', '');
    }
    details.addEventListener('toggle', () => {
      this.customPromptDetailsOpen = details.hasAttribute('open');
    });

    details.createEl('summary', {
      text: t('settings.customReviewPrompt.showExamples'),
      cls: 'inbox-curator-custom-prompt-summary',
    });

    const examples = details.createDiv({
      cls: 'inbox-curator-custom-prompt-examples',
    });

    examples.createEl('div', { text: t('settings.customReviewPrompt.examplesLabel'), cls: 'inbox-curator-custom-prompt-examples-title' });
    examples.createEl('div', { text: `- ${t('settings.customReviewPrompt.exampleStrict')}` });
    examples.createEl('div', { text: `- ${t('settings.customReviewPrompt.exampleMove')}` });
    examples.createEl('div', { text: `- ${t('settings.customReviewPrompt.exampleTechnical')}` });

    const counter = footer.createEl('span', {
      cls: 'inbox-curator-custom-prompt-counter',
    });

    const updateCounter = () => {
      counter.textContent = `${textArea.value.length} / ${MAX_CUSTOM_REVIEW_PROMPT_LENGTH}`;
    };

    updateCounter();


    textArea.addEventListener('input', () => {
      Promise.resolve().then(async () => {
        let value = textArea.value;
        let trimmed = false;

        if (value.length > MAX_CUSTOM_REVIEW_PROMPT_LENGTH) {
          value = value.slice(0, MAX_CUSTOM_REVIEW_PROMPT_LENGTH);
          textArea.value = value;
          trimmed = true;
        }

        settings.customReviewPrompt = value;
        await this.plugin.saveSettings();
        updateCounter();

        if (trimmed) {
          if (!this.customPromptNoticeDebounce) {
            new Notice(t('settings.customReviewPrompt.truncated', { maxLength: MAX_CUSTOM_REVIEW_PROMPT_LENGTH }));
            this.customPromptNoticeDebounce = true;
            window.setTimeout(() => {
              this.customPromptNoticeDebounce = false;
            }, 3000);
          }
        }
      }).catch(console.error);
    });

    // ── 9. AI Context Size ──
    const budgetCard = this.createCardContainer(containerEl, '🧠 ' + t('settings.contextBudget.title'), t('settings.contextBudget.desc'));

    new Setting(budgetCard)
      .setName(t('settings.contextBudget.preset.label'))
      .addDropdown((dropdown) =>
        dropdown
          .addOption('small', t('settings.contextBudget.small'))
          .addOption('standard', t('settings.contextBudget.standard'))
          .addOption('large', t('settings.contextBudget.large'))
          .addOption('custom', t('settings.contextBudget.custom'))
          .setValue(settings.contextBudgetPreset)
          .onChange(async (value) => {
            settings.contextBudgetPreset = value as ContextBudgetPreset;
            await this.plugin.saveSettings();
            this.display();
          }),
      );

    if (settings.contextBudgetPreset === 'custom') {
      new Setting(budgetCard)
        .setName(t('settings.contextBudget.customMaxContext'))
        .setDesc(t('settings.contextBudget.customMaxContext.desc'))
        .addText((text) => {
          text.inputEl.type = 'number';
          text.inputEl.min = '4096';
          text.inputEl.max = '1000000';
          text.setPlaceholder(String(DEFAULT_SETTINGS.customMaxContextTokens));
          text.setValue(String(settings.customMaxContextTokens));
          text.onChange(async (value) => {
            settings.customMaxContextTokens = clampInteger(Number(value), 4096, 1000000, DEFAULT_SETTINGS.customMaxContextTokens);
            await this.plugin.saveSettings();
          });
        });

      new Setting(budgetCard)
        .setName(t('settings.contextBudget.customMaxInput'))
        .setDesc(t('settings.contextBudget.customMaxInput.desc'))
        .addText((text) => {
          text.inputEl.type = 'number';
          text.inputEl.min = '1000';
          text.inputEl.max = '500000';
          text.setPlaceholder(String(DEFAULT_SETTINGS.customMaxInputContentTokens));
          text.setValue(String(settings.customMaxInputContentTokens));
          text.onChange(async (value) => {
            settings.customMaxInputContentTokens = clampInteger(Number(value), 1000, 500000, DEFAULT_SETTINGS.customMaxInputContentTokens);
            await this.plugin.saveSettings();
          });
        });

      new Setting(budgetCard)
        .setName(t('settings.contextBudget.customMaxOutput'))
        .setDesc(t('settings.contextBudget.customMaxOutput.desc'))
        .addText((text) => {
          text.inputEl.type = 'number';
          text.inputEl.min = '256';
          text.inputEl.max = '65536';
          text.setPlaceholder(String(DEFAULT_SETTINGS.customMaxOutputTokens));
          text.setValue(String(settings.customMaxOutputTokens));
          text.onChange(async (value) => {
            settings.customMaxOutputTokens = clampInteger(Number(value), 256, 65536, DEFAULT_SETTINGS.customMaxOutputTokens);
            await this.plugin.saveSettings();
          });
        });

      new Setting(budgetCard)
        .setName(t('settings.contextBudget.customSafetyMargin'))
        .setDesc(t('settings.contextBudget.customSafetyMargin.desc'))
        .addText((text) => {
          text.inputEl.type = 'number';
          text.inputEl.min = '0';
          text.inputEl.max = '100000';
          text.setPlaceholder(String(DEFAULT_SETTINGS.customSafetyMarginTokens));
          text.setValue(String(settings.customSafetyMarginTokens));
          text.onChange(async (value) => {
            settings.customSafetyMarginTokens = clampInteger(Number(value), 0, 100000, DEFAULT_SETTINGS.customSafetyMarginTokens);
            await this.plugin.saveSettings();
          });
        });
    }

    budgetCard.createEl('p', { text: t('settings.contextBudget.localLLMGuidance'), cls: 'inbox-curator-meta-info' });

    // ── 10. Request Pacing (Advanced) ──
    const pacingCard = this.createCardContainer(containerEl, '⏱️ ' + t('settings.pacing.title'), t('settings.pacing.desc'));

    const pacingDetails = pacingCard.createEl('details');
    if (this.pacingDetailsOpen) {
      pacingDetails.setAttribute('open', '');
    }
    pacingDetails.addEventListener('toggle', () => {
      this.pacingDetailsOpen = pacingDetails.hasAttribute('open');
    });
    pacingDetails.createEl('summary', { text: t('settings.pacing.title'), cls: 'inbox-curator-sub-section-header' });

    new Setting(pacingDetails)
      .setName(t('settings.maxNotes.label'))
      .setDesc(t('settings.maxNotes.desc'))
      .addText((text) => {
        text.inputEl.type = 'number';
        text.inputEl.min = '1';
        text.inputEl.max = '100';
        text.setPlaceholder(String(DEFAULT_SETTINGS.maxNotesPerRun));
        text.setValue(String(settings.maxNotesPerRun));
        text.onChange(async (value) => {
          settings.maxNotesPerRun = clampInteger(Number(value), 1, 100, DEFAULT_SETTINGS.maxNotesPerRun);
          await this.plugin.saveSettings();
        });
      });

    new Setting(pacingDetails)
      .setName(t('settings.maxConcurrent.label'))
      .setDesc(t('settings.maxConcurrent.desc'))
      .addText((text) => {
        text.inputEl.type = 'number';
        text.inputEl.min = '1';
        text.inputEl.max = '8';
        text.setPlaceholder(String(DEFAULT_SETTINGS.maxConcurrentReviews));
        text.setValue(String(settings.maxConcurrentReviews));
        text.onChange(async (value) => {
          settings.maxConcurrentReviews = clampInteger(Number(value), 1, 8, DEFAULT_SETTINGS.maxConcurrentReviews);
          await this.plugin.saveSettings();
        });
      });

    new Setting(pacingDetails)
      .setName(t('settings.requestsPerMinute.label'))
      .setDesc(t('settings.requestsPerMinute.desc'))
      .addText((text) => {
        text.inputEl.type = 'number';
        text.inputEl.min = '1';
        text.inputEl.max = '60';
        text.setPlaceholder(String(DEFAULT_SETTINGS.requestsPerMinute));
        text.setValue(String(settings.requestsPerMinute));
        text.onChange(async (value) => {
          settings.requestsPerMinute = clampInteger(Number(value), 1, 60, DEFAULT_SETTINGS.requestsPerMinute);
          await this.plugin.saveSettings();
        });
      });

    new Setting(pacingDetails)
      .setName(t('settings.delayBetweenRequests.label'))
      .setDesc(t('settings.delayBetweenRequests.desc'))
      .addText((text) => {
        text.inputEl.type = 'number';
        text.inputEl.min = '0';
        text.inputEl.max = '60000';
        text.setPlaceholder(String(DEFAULT_SETTINGS.delayBetweenRequestsMs));
        text.setValue(String(settings.delayBetweenRequestsMs));
        text.onChange(async (value) => {
          settings.delayBetweenRequestsMs = clampInteger(Number(value), 0, 60000, DEFAULT_SETTINGS.delayBetweenRequestsMs);
          await this.plugin.saveSettings();
        });
      });

    new Setting(pacingDetails)
      .setName(t('settings.requestTimeout.label'))
      .setDesc(t('settings.requestTimeout.desc'))
      .addText((text) => {
        text.inputEl.type = 'number';
        text.inputEl.min = '1000';
        text.inputEl.max = '300000';
        text.setPlaceholder(String(DEFAULT_SETTINGS.requestTimeoutMs));
        text.setValue(String(settings.requestTimeoutMs));
        text.onChange(async (value) => {
          settings.requestTimeoutMs = clampInteger(Number(value), 1000, 300000, DEFAULT_SETTINGS.requestTimeoutMs);
          await this.plugin.saveSettings();
        });
      });

    // ── 11. Plugin Info ──
    this.renderPluginInfoSection(containerEl);
  }

  private renderPluginInfoSection(containerEl: HTMLElement): void {
    const manifest = this.plugin.manifest;
    const settings = this.plugin.settings;

    const section = containerEl.createDiv({ cls: 'inbox-curator-plugin-info' });

    new Setting(section).setName(t('settings.pluginInfo.title')).setHeading();

    section.createDiv({ cls: 'inbox-curator-plugin-info-row', text: `${t('settings.pluginInfo.version')}: ${manifest.version}` });
    section.createDiv({ cls: 'inbox-curator-plugin-info-row', text: `${t('settings.pluginInfo.pluginId')}: ${manifest.id}` });
    section.createDiv({ cls: 'inbox-curator-plugin-info-row', text: `${t('settings.pluginInfo.minObsidianVersion')}: ${manifest.minAppVersion}` });

    section.createDiv({ cls: 'inbox-curator-plugin-info-update', text: t('settings.pluginInfo.updateNotice') });

    const buttonGroup = section.createDiv({ cls: 'inbox-curator-plugin-info-buttons' });

    this.createPluginInfoButton(buttonGroup, t('settings.pluginInfo.faq'), () => {
      this.openExternalUrl('https://inbox-curator.antidot.jp/');
    });

    this.createPluginInfoButton(buttonGroup, t('settings.pluginInfo.releaseNotes'), () => {
      this.openExternalUrl('https://github.com/kzyiym/inbox-curator/releases');
    });

    this.createPluginInfoButton(buttonGroup, t('settings.pluginInfo.reportIssue'), () => {
      this.openExternalUrl('https://github.com/kzyiym/inbox-curator/issues');
    });

    this.createPluginInfoButton(buttonGroup, t('settings.pluginInfo.copyDebugInfo'), () => {
      void this.copyDebugInfo();
    });
  }

  private createPluginInfoButton(container: HTMLElement, label: string, onClick: () => void): void {
    const btn = container.createEl('button', { text: label, cls: 'inbox-curator-plugin-info-btn' });
    btn.addEventListener('click', onClick);
  }

  private openExternalUrl(url: string): void {
    try {
      const { shell } = require('electron');
      shell.openExternal(url);
    } catch {
      window.open(url, '_blank');
    }
  }

  private async copyDebugInfo(): Promise<void> {
    const settings = this.plugin.settings;
    const info = [
      '## Inbox Curator Debug Info',
      '',
      `- Plugin version: ${this.plugin.manifest.version}`,
      `- Plugin ID: ${this.plugin.manifest.id}`,
      `- Min Obsidian version: ${this.plugin.manifest.minAppVersion}`,
      `- Obsidian API version: ${apiVersion}`,
      `- Platform: desktop`,
      `- Provider: ${settings.provider}`,
      `- Model: ${settings.model}`,
      `- Review mode: ${settings.reviewMode}`,
      `- Automatic watching: ${settings.enableAutomaticWatching}`,
      `- Auto-review on create: ${settings.autoReviewOnCreate}`,
      `- Auto-review on modify: ${settings.autoReviewOnModify}`,
      `- Auto-execute archive: ${settings.autoExecuteArchive}`,
      `- Auto-execute read later: ${settings.autoExecuteReadLater}`,
      `- Auto-execute task: ${settings.autoExecuteTask}`,
      `- Log level: ${settings.logLevel}`,
    ].join('\n');

    try {
      await navigator.clipboard.writeText(info);
      new Notice(t('notice.debugInfoCopied'));
    } catch {
      new Notice(t('notice.debugInfoCopyFailed'));
    }
  }
}
