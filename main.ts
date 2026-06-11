import { MarkdownView, Notice, Plugin, TFile, TFolder, normalizePath } from 'obsidian';
import { registerInboxCuratorCommands } from './src/commands';
import { readAiReviewSourceHash } from './src/frontmatter';
import { ProcessingNoticeManager } from './src/processingNotice';
import { createReviewJob, generateRunId } from './src/queue/job';
import { ReviewRateLimiter } from './src/queue/rateLimiter';
import { ReviewQueue } from './src/queue/reviewQueue';
import type { ReviewJob, ReviewJobResult, ReviewJobSource, ReviewQueueLogEntry } from './src/queue/queueTypes';
import { buildReviewSourceInfo, runReviewPipeline, type ReviewPipelineOptions } from './src/reviewPipeline';
import { DEFAULT_SETTINGS, InboxCuratorSettings, InboxCuratorSettingTab } from './src/settings';
import { executeProposedAction } from './src/actionLayer';
import { appendAutoExecuteResult } from './src/reviewWriter';
import { canAutoExecuteReviewAction, type ReviewAction, type ReviewConfidence } from './src/reviewNormalizer';
import { t } from './src/i18n';
import { clearSessionApiKeys, getApiKey, hasApiKey } from './src/secrets';
import { logError } from './src/utils/errorLog';
import { logOperation } from './src/utils/operationLog';
import { appendAutoSortActionRecord, type AutoSortActionRecord } from './src/utils/autoSortHistory';
import { undoLastAutoSortRun } from './src/undoAutoSort';
import { setLogLevelGetter } from './src/utils/logFiles';
import { resolveReviewContextBudget } from './src/utils/contentFilter';
import { resolveEffectiveOpenAiTokenLimitParam, buildOpenAiCompatibleTokenLimitDetectionKey } from './src/openAiCompatible';
import { getFolderMarkdownFilesForCollectionReview, runCollectionReviewPipeline } from './src/collectionReview';
import { validateFolderPath } from './src/utils/folder';

type AutomaticReviewReason = 'create' | 'modify' | 'poll';

interface WatchedFolderProcessingSummary {
  processed: number;
  skipped: number;
  failed: number;
  remaining: number;
}

interface QueuedReviewTask {
  file: TFile;
  resultPromise: Promise<ReviewJobResult>;
}

interface AutomaticEnqueueResult {
  accepted: boolean;
  skipped?: boolean;
  duplicate?: boolean;
  error?: string;
  promise?: Promise<ReviewJobResult>;
}

type FileSkipCacheEntry = {
  mtime: number;
  reviewHash: string;
};

export default class InboxCuratorPlugin extends Plugin {
  settings: InboxCuratorSettings = DEFAULT_SETTINGS;
  isUnloaded = false;
  private processingInProgress = false;
  private readonly processingNotice = new ProcessingNoticeManager();
  private reviewQueue!: ReviewQueue;
  private reviewRateLimiter = new ReviewRateLimiter();
  private readonly automaticReviewTimers = new Map<string, number>();
  private readonly fileSkipCache = new Map<string, FileSkipCacheEntry>();
  private pollingIntervalId: number | null = null;
  private pollingInProgress = false;
  // Processing marker renames are UI-only file-name changes.
  // Obsidian may emit rename/modify events for them, so these paths are
  // temporarily skipped to avoid re-enqueueing the same note.
  // Both original path and marker path are added before rename.
  // The rename event handler clears stale entries, and the consumer
  // (scheduleAutomaticReview / tryEnqueueAutomaticReview) removes them on hit.
  // This ordering is intentional — do not rearrange without tracing the event sequence.
  private readonly processingMarkerRenameSkipCache = new Set<string>();

  private static readonly PROCESSING_FILE_MARKER = '🤖 ';

  private hasProcessingFileMarker(fileName: string): boolean {
    return fileName.startsWith(InboxCuratorPlugin.PROCESSING_FILE_MARKER);
  }

  private isProcessingMarkerPath(path: string): boolean {
    const fileName = path.split('/').pop() ?? '';
    return fileName.startsWith(InboxCuratorPlugin.PROCESSING_FILE_MARKER);
  }

  async onload(): Promise<void> {
    this.isUnloaded = false;
    await this.loadSettings();
    setLogLevelGetter(() => this.settings.logLevel);

    void logOperation(this.app, { timestamp: new Date().toISOString(), level: 'INFO', event: 'plugin_loaded' });

    await this.cleanupEmojiPrefixFiles(true);

    this.reviewQueue = new ReviewQueue(async (job) => this.runQueuedReviewJob(job), {
      rateLimiter: this.reviewRateLimiter,
      maxConcurrentJobs: this.settings.maxConcurrentReviews,
      onRetry: (job, attempt, delayMs, result) => {
        this.logQueuedReviewRetry(job, attempt, delayMs, result.error);
        void logOperation(this.app, {
          timestamp: new Date().toISOString(),
          level: 'WARN',
          event: 'queue_retried',
          operationId: job.operationId,
          notePath: job.notePath,
          details: { retryCount: attempt, delayMs, reason: result.error ?? 'unknown' },
        });
      },
      // # Operation log verification guide
      //
      // After manual testing, check `.inbox-curator/logs/operations-*.ndjson`:
      //
      //   1. RUN_ID sharing — filter by `runId`:
      //      - `processWatchedFolder` → same `runId` across all jobs in the batch
      //      - `runPollingSweep`     → same `runId` across all jobs in the sweep
      //      - single review / auto-create / auto-modify → each gets a unique `runId`
      //
      //   2. No double dispatch for same `notePath`:
      //      - First enqueue → `enqueue_accepted`
      //      - Second enqueue (same path while first is pending/running) → `enqueue_skipped`
      //        with `skippedReason: "already_queued_or_running"`
      //
      //   3. Source discrimination — `details.source`:
      //      - `manual-folder`  → processWatchedFolder (manual button)
      //      - `manual-current` → reviewFile (single note command)
      //      - `auto-create`    → vault `create` event
      //      - `auto-modify`    → vault `modify` event
      //      - `polling`        → runPollingSweep
      //
      //   4. Max concurrency — `runningCount` never exceeds `maxConcurrentJobs`
      //
      //   5. Cleanup on failure — `job_failed` followed by state reset:
      //      `runningCount` drops and same `notePath` becomes enqueueable again
      onLog: (entry: ReviewQueueLogEntry): void => {
        void logOperation(this.app, {
          timestamp: entry.timestamp,
          level: entry.level,
          event: entry.event,
          operationId: entry.jobId,
          notePath: entry.notePath,
          details: {
            runId: entry.runId ?? null,
            source: entry.source ?? null,
            pendingCount: entry.pendingCount ?? null,
            runningCount: entry.runningCount ?? null,
            maxConcurrentJobs: entry.maxConcurrentJobs ?? null,
            queuedOrRunningCount: entry.queuedOrRunningCount ?? null,
            skippedReason: entry.skippedReason ?? null,
            durationMs: entry.durationMs ?? null,
            errorMessage: entry.errorMessage ?? null,
          },
        });
        // Also write human-readable entries to error log so they appear
        // at both 'errors' and 'operations' log levels.
        if (entry.event === 'job_succeeded' && entry.notePath) {
          void logError(this.app, 'WARN', `Review completed: ${entry.notePath}`, {
            durationMs: entry.durationMs,
            source: entry.source,
          });
        }
        if (entry.event === 'job_failed' && entry.notePath) {
          void logError(this.app, 'ERROR', `Review failed: ${entry.notePath}`, {
            error: entry.errorMessage,
            source: entry.source,
          });
        }
      },
      onStatus: (status) => {
        if (this.processingInProgress) return;
        if (status.running > 0 && status.currentPath) {
          const fileName = status.currentPath.split('/').pop() ?? '';
          const cleanName = this.hasProcessingFileMarker(fileName)
            ? fileName.slice(InboxCuratorPlugin.PROCESSING_FILE_MARKER.length)
            : fileName;
          const truncatedName = cleanName.length > 24 ? cleanName.slice(0, 22) + '…' : cleanName;
          this.processingNotice.show(`Reviewing ${truncatedName} (${status.running}/${status.pending})`);
        } else if (status.running === 0 && status.pending === 0) {
          this.processingNotice.clear();
        }
      },
    });

    this.registerEvent(this.app.vault.on('create', (file) => {
      if (file instanceof TFile) {
        void this.handleWatchedFolderCreate(file);
      }
    }));
    this.registerEvent(this.app.vault.on('modify', (file) => {
      if (file instanceof TFile) {
        void this.handleWatchedFolderModify(file);
      }
    }));
    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
      this.fileSkipCache.delete(oldPath);
      this.processingMarkerRenameSkipCache.delete(oldPath);
      if (file instanceof TFile) {
        this.processingMarkerRenameSkipCache.delete(file.path);
      }
    }));
    this.registerEvent(this.app.vault.on('delete', (file) => {
      this.fileSkipCache.delete(file.path);
    }));

    this.addSettingTab(new InboxCuratorSettingTab(this.app, this));
    registerInboxCuratorCommands(this);

    this.registerEvent(
      this.app.workspace.on('files-menu', (menu, files) => {
        if (!this.settings.enableContextMenu) return;
        const mdFiles = files.filter((f): f is TFile => f instanceof TFile && f.extension === 'md');

        if (mdFiles.length === 0) return;

        if (mdFiles.length >= 2 && this.settings.contextMenuReviewSelectedAsCollection) {
          menu.addItem((item) => {
            item
              .setTitle(t('fileMenu.reviewSelectedAsCollection'))
              .setIcon('folder-sync')
              .onClick(async () => {
                await this.runCollectionReviewFlow(mdFiles, 'selected_notes', '');
              });
          });
        }

        if (this.settings.contextMenuReviewSelected && mdFiles.length >= 1) {
          menu.addItem((item) => {
            item
              .setTitle(t('fileMenu.reviewEachSelected'))
              .setIcon('file')
              .onClick(async () => {
                await this.reviewMultipleFiles(mdFiles);
              });
          });
        }

        if (this.settings.contextMenuExecuteSelectedActions && mdFiles.length >= 1) {
          menu.addItem((item) => {
            item
              .setTitle(t('fileMenu.executeSelectedActions'))
              .setIcon('checkmark')
              .onClick(async () => {
                await this.executeProposedActionsForFiles(mdFiles);
              });
          });
        }

        if (this.settings.contextMenuCleanupMarkers && mdFiles.length >= 1) {
          menu.addItem((item) => {
            item
              .setTitle(t('fileMenu.cleanupMarkers'))
              .setIcon('trash')
              .onClick(async () => {
                await this.cleanupMarkersForFiles(mdFiles);
              });
          });
        }
      })
    );

    this.registerEvent(
      this.app.workspace.on('file-menu', (menu, file) => {
        if (!this.settings.enableContextMenu) return;

        if (file instanceof TFile && file.extension === 'md') {
          if (this.settings.contextMenuReviewCurrentNote) {
            menu.addItem((item) => {
              item
                .setTitle(t('fileMenu.reviewCurrentNote'))
                .setIcon('file')
                .onClick(async () => {
                  await this.reviewFile(file);
                });
            });
          }
          if (this.settings.contextMenuExecuteProposedAction) {
            menu.addItem((item) => {
              item
                .setTitle(t('fileMenu.executeProposedAction'))
                .setIcon('checkmark')
                .onClick(async () => {
                  await this.executeProposedActionForFile(file);
                });
            });
          }
        }

        if (file instanceof TFolder) {
          if (this.settings.contextMenuReviewFolderAsCollection) {
            menu.addItem((item) => {
              item
                .setTitle(t('fileMenu.reviewFolderAsCollection'))
                .setIcon('folder-sync')
                .onClick(async () => {
                  const crFiles = await getFolderMarkdownFilesForCollectionReview(this.app, file.path, {
                    outputFolder: this.settings.collectionReviewOutputFolder,
                    provider: this.settings.provider,
                    endpointUrl: this.settings.endpointUrl,
                    model: this.settings.model,
                    apiKey: '',
                    maxNotes: this.settings.collectionReviewMaxNotes,
                    maxExcerptCharsPerNote: this.settings.collectionReviewMaxExcerptCharsPerNote,
                    useExistingReviewsFirst: this.settings.collectionReviewUseExistingReviewsFirst,
                    includeExcerptWhenNeeded: this.settings.collectionReviewIncludeExcerptWhenNeeded,
                    promptLanguage: this.resolveCollectionReviewPromptLanguage(),
                    requestTimeoutMs: this.settings.requestTimeoutMs,
                    maxOutputTokens: 4096,
                    isUnloaded: () => this.isUnloaded,
                  });
                  if (crFiles.length >= 2) {
                    await this.runCollectionReviewFlow(crFiles, 'folder', file.path);
                  } else {
                    new Notice(t('notice.collectionReview.tooFew'));
                  }
                });
            });
          }
          if (this.settings.contextMenuProcessWatchedFolder) {
            menu.addItem((item) => {
              item
                .setTitle(t('fileMenu.processWatchedFolder'))
                .setIcon('play')
                .onClick(async () => {
                  await this.processWatchedFolder();
                });
            });
          }
        }

        if (this.settings.contextMenuCleanupMarkers) {
          menu.addItem((item) => {
            item
              .setTitle(t('fileMenu.cleanupMarkers'))
              .setIcon('trash')
              .onClick(async () => {
                await this.cleanupEmojiPrefixFiles();
                new Notice(t('notice.cleanupMarkersNone'));
              });
          });
        }

        if (this.settings.contextMenuUndoAutoSort) {
          menu.addItem((item) => {
            item
              .setTitle(t('fileMenu.undoAutoSort'))
              .setIcon('undo')
              .onClick(async () => {
                await undoLastAutoSortRun(this.app);
              });
          });
        }
      })
    );
    
    const statusBarEl = this.addStatusBarItem();
    this.processingNotice.setStatusBarElement(statusBarEl);

    this.configurePolling();
  }

  onunload(): void {
    this.isUnloaded = true;
    void logOperation(this.app, { timestamp: new Date().toISOString(), level: 'INFO', event: 'plugin_unloaded' });
    this.clearAutomaticReviewTimers();
    this.stopPolling();
    this.reviewQueue?.stop();
    this.reviewRateLimiter.reset();
    this.fileSkipCache.clear();
    clearSessionApiKeys();
    this.finishProcessing();
    void this.cleanupEmojiPrefixFiles();
  }

  async loadSettings(): Promise<void> {
    const saved = (await this.loadData()) as Partial<InboxCuratorSettings> | null;
    this.settings = { ...DEFAULT_SETTINGS, ...(saved ?? {}) };

    // Backwards compatibility migration
    if (saved && saved.autoExecuteProposedActions === true && saved.autoExecuteArchive === undefined) {
      this.settings.autoExecuteArchive = true;
    }

    // Sanitize folder paths (reject dot-prefix from manual data.json edits)
    const folderFields: { field: keyof InboxCuratorSettings; default: string }[] = [
      { field: 'watchedFolder', default: DEFAULT_SETTINGS.watchedFolder },
      { field: 'reviewOutputFolder', default: DEFAULT_SETTINGS.reviewOutputFolder },
      { field: 'collectionReviewOutputFolder', default: DEFAULT_SETTINGS.collectionReviewOutputFolder },
      { field: 'readLaterFolder', default: DEFAULT_SETTINGS.readLaterFolder },
      { field: 'taskFolder', default: DEFAULT_SETTINGS.taskFolder },
      { field: 'deleteCandidateFolder', default: DEFAULT_SETTINGS.deleteCandidateFolder },
    ];
    let foldersSanitized = false;
    for (const { field, default: def } of folderFields) {
      const current = (this.settings as any)[field] as string;
      const result = validateFolderPath(current, def);
      if (result.changed) {
        (this.settings as any)[field] = result.sanitized;
        foldersSanitized = true;
      }
    }
    if (foldersSanitized) {
      await this.saveSettings();
    }
  }

  async saveSettings(): Promise<void> {
    const oldWatchedFolder = this.settings.watchedFolder;
    await this.saveData({
      watchedFolder: this.settings.watchedFolder,
      reviewOutputFolder: this.settings.reviewOutputFolder,
      provider: this.settings.provider,
      endpointUrl: this.settings.endpointUrl,
      model: this.settings.model,
      maxNotesPerRun: this.settings.maxNotesPerRun,
      maxConcurrentReviews: this.settings.maxConcurrentReviews,
      requestsPerMinute: this.settings.requestsPerMinute,
      delayBetweenRequestsMs: this.settings.delayBetweenRequestsMs,
      enableAutomaticWatching: this.settings.enableAutomaticWatching,
      autoReviewOnCreate: this.settings.autoReviewOnCreate,
      autoReviewOnModify: this.settings.autoReviewOnModify,
      watchDebounceMs: this.settings.watchDebounceMs,
      enablePolling: this.settings.enablePolling,
      pollingIntervalMs: this.settings.pollingIntervalMs,
      fetchUrlMetadata: this.settings.fetchUrlMetadata,
      extractUrlArticleText: this.settings.extractUrlArticleText,
      maxExtractedCharacters: this.settings.maxExtractedCharacters,
      readImages: this.settings.readImages,
      optimizeImagesForAi: this.settings.optimizeImagesForAi,
      readVideos: this.settings.readVideos,
      autoExecuteProposedActions: this.settings.autoExecuteProposedActions,
      autoExecuteArchive: this.settings.autoExecuteArchive,
      autoExecuteReadLater: this.settings.autoExecuteReadLater,
      autoExecuteTask: this.settings.autoExecuteTask,
      autoExecuteDeleteCandidate: this.settings.autoExecuteDeleteCandidate,
      readLaterFolder: this.settings.readLaterFolder,
      taskFolder: this.settings.taskFolder,
      deleteCandidateFolder: this.settings.deleteCandidateFolder,
      requestTimeoutMs: this.settings.requestTimeoutMs,
      promptLanguage: this.settings.promptLanguage,
      customReviewPrompt: this.settings.customReviewPrompt,
      suggestedFolderBasePath: this.settings.suggestedFolderBasePath,
      extractPdfText: this.settings.extractPdfText,
      showProcessingMarkerInFileName: this.settings.showProcessingMarkerInFileName,
      contextBudgetPreset: this.settings.contextBudgetPreset,
      customMaxContextTokens: this.settings.customMaxContextTokens,
      customMaxInputContentTokens: this.settings.customMaxInputContentTokens,
      customMaxOutputTokens: this.settings.customMaxOutputTokens,
      customSafetyMarginTokens: this.settings.customSafetyMarginTokens,
      reviewMode: this.settings.reviewMode,
      openAiCompatibleTokenLimitParam: this.settings.openAiCompatibleTokenLimitParam,
      openAiCompatibleDetectedTokenLimitParam: this.settings.openAiCompatibleDetectedTokenLimitParam,
      openAiCompatibleDetectedTokenLimitAt: this.settings.openAiCompatibleDetectedTokenLimitAt,
      openAiCompatibleDetectedTokenLimitKey: this.settings.openAiCompatibleDetectedTokenLimitKey,
      collectionReviewOutputFolder: this.settings.collectionReviewOutputFolder,
      collectionReviewUseExistingReviewsFirst: this.settings.collectionReviewUseExistingReviewsFirst,
      collectionReviewIncludeExcerptWhenNeeded: this.settings.collectionReviewIncludeExcerptWhenNeeded,
      collectionReviewMaxNotes: this.settings.collectionReviewMaxNotes,
      collectionReviewMaxExcerptCharsPerNote: this.settings.collectionReviewMaxExcerptCharsPerNote,
      enableContextMenu: this.settings.enableContextMenu,
      contextMenuReviewCurrentNote: this.settings.contextMenuReviewCurrentNote,
      contextMenuExecuteProposedAction: this.settings.contextMenuExecuteProposedAction,
      contextMenuCleanupMarkers: this.settings.contextMenuCleanupMarkers,
      contextMenuUndoAutoSort: this.settings.contextMenuUndoAutoSort,
      contextMenuReviewFolderAsCollection: this.settings.contextMenuReviewFolderAsCollection,
      contextMenuProcessWatchedFolder: this.settings.contextMenuProcessWatchedFolder,
      contextMenuReviewSelectedAsCollection: this.settings.contextMenuReviewSelectedAsCollection,
      contextMenuExecuteSelectedActions: this.settings.contextMenuExecuteSelectedActions,
      contextMenuReviewSelected: this.settings.contextMenuReviewSelected,
      logLevel: this.settings.logLevel,
    });
 
    if (oldWatchedFolder !== this.settings.watchedFolder) {
      this.fileSkipCache.clear();
    }

    this.reviewQueue?.setMaxConcurrentJobs(this.settings.maxConcurrentReviews);
    this.clearAutomaticReviewTimers();
    this.configurePolling();
  }

  private updateProcessingStatus(text: string): void {
    this.processingNotice.update(text);
  }

  private buildShortReviewError(message: string): string {
    const normalized = message.replace(/\s+/g, ' ').trim();
    if (!normalized) {
      return t('notice.reviewFailed');
    }

    const maxLength = 120;
    const clipped = normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength)}…`;
    return t('notice.reviewFailedDetail', { error: clipped });
  }

  private tryBeginProcessing(noticeText: string): boolean {
    if (this.processingInProgress) {
      new Notice(t('notice.reviewAlreadyInProgress'));
      return false;
    }

    this.processingInProgress = true;
    this.processingNotice.show(noticeText);
    return true;
  }

  private finishProcessing(): void {
    this.processingInProgress = false;
    this.processingNotice.clear();
  }

  private getReviewPipelineOptions(): ReviewPipelineOptions {
    const budget = resolveReviewContextBudget(
      this.settings.contextBudgetPreset,
      this.settings.contextBudgetPreset === 'custom'
        ? {
            maxContextTokens: this.settings.customMaxContextTokens,
            maxInputContentTokens: this.settings.customMaxInputContentTokens,
            maxOutputTokens: this.settings.customMaxOutputTokens,
            safetyMarginTokens: this.settings.customSafetyMarginTokens,
          }
        : undefined,
    );
    return {
      outputFolder: this.settings.reviewOutputFolder,
      provider: this.settings.provider,
      endpointUrl: this.settings.endpointUrl,
      model: this.settings.model,
      fetchUrlMetadata: this.settings.fetchUrlMetadata,
      extractUrlArticleText: this.settings.extractUrlArticleText,
      maxExtractedCharacters: this.settings.maxExtractedCharacters,
      readImages: this.settings.readImages,
      optimizeImagesForAi: this.settings.optimizeImagesForAi,
      readVideos: this.settings.readVideos,
      reviewMode: this.settings.reviewMode,
      requestTimeoutMs: this.settings.requestTimeoutMs,
      promptLanguage: this.settings.promptLanguage,
      customReviewPrompt: this.settings.customReviewPrompt,
      extractPdfText: this.settings.extractPdfText,
      isUnloaded: () => this.isUnloaded,
      maxInputContentChars: budget.maxInputContentChars,
      maxOutputTokens: budget.maxOutputTokens,
      openAiTokenLimitParam: resolveEffectiveOpenAiTokenLimitParam(
        this.settings.openAiCompatibleTokenLimitParam,
        this.settings.openAiCompatibleDetectedTokenLimitParam,
        this.settings.openAiCompatibleDetectedTokenLimitKey,
        buildOpenAiCompatibleTokenLimitDetectionKey(this.settings.endpointUrl, this.settings.model),
      ),
    };
  }

  private resolveCollectionReviewPromptLanguage(): 'english' | 'japanese' {
    if (this.settings.promptLanguage === 'japanese') {
      return 'japanese';
    }
    if (this.settings.promptLanguage === 'match-obsidian') {
      try {
        const lang = window.localStorage.getItem('language');
        if (lang && lang.trim().toLowerCase().replace(/[-_].*$/, '') === 'ja') {
          return 'japanese';
        }
      } catch {
        // localStorage unavailable
      }
    }
    return 'english';
  }

  private resolveMarkdownFile(notePath: string): TFile | null {
    const file = this.app.vault.getAbstractFileByPath(notePath);
    if (!(file instanceof TFile) || file.extension !== 'md') {
      return null;
    }

    return file;
  }

  // Scans the vault for files whose name starts with the processing marker
  // and renames them to remove the prefix. Intentionally does NOT mutate
  // file content — any marker leaked into user prose or plugin metadata
  // is left as-is. Only file names are restored.
  async cleanupEmojiPrefixFiles(silent?: boolean): Promise<number> {
    let count = 0;
    try {
      const marker = InboxCuratorPlugin.PROCESSING_FILE_MARKER;
      const escapedMarker = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const files = this.app.vault.getMarkdownFiles();

      for (const file of files) {
        if (!this.hasProcessingFileMarker(file.name)) continue;

        const cleanPath = file.path.replace(new RegExp(`/${escapedMarker}`, 'g'), '/');

        if (this.app.vault.getAbstractFileByPath(cleanPath) instanceof TFile) {
          this.processingMarkerRenameSkipCache.add(cleanPath);
          this.processingMarkerRenameSkipCache.add(file.path);
          continue;
        }

        try {
          this.processingMarkerRenameSkipCache.add(file.path);
          this.processingMarkerRenameSkipCache.add(cleanPath);
          await this.app.fileManager.renameFile(file, cleanPath);
          count += 1;
        } catch {
          // skip single file
        }
      }
    } catch {
      // non-blocking cleanup
    }

    if (!silent && count > 0) {
      new Notice(t('notice.cleanupMarkers', { count }));
    }

    return count;
  }

  private async runQueuedReviewJob(job: ReviewJob): Promise<ReviewJobResult> {
    void logOperation(this.app, {
      timestamp: new Date().toISOString(),
      level: 'INFO',
      event: 'queue_started',
      operationId: job.operationId,
      notePath: job.notePath,
    });

    if (this.isUnloaded) {
      return { status: 'cancelled', error: 'Plugin unloaded' };
    }
    const file = this.resolveMarkdownFile(job.notePath);
    if (!file) {
      void logOperation(this.app, {
        timestamp: new Date().toISOString(),
        level: 'WARN',
        event: 'queue_skipped',
        operationId: job.operationId,
        notePath: job.notePath,
        message: 'Markdown note not found',
      });
      return {
        status: 'failed',
        error: 'Markdown note not found',
      };
    }

    const isBackgroundAutoJob = !this.processingInProgress &&
      (job.source === 'auto-create' || job.source === 'auto-modify' || job.source === 'polling');

    let originalPath: string | undefined;
    // Experimental: prefix file name with a marker during background auto-review.
    // Both original and new paths are added to the skip cache before/after rename
    // so Obsidian rename/modify events from this change do not trigger another review.
    if (isBackgroundAutoJob && this.settings.showProcessingMarkerInFileName) {
      originalPath = file.path;
      this.processingMarkerRenameSkipCache.add(originalPath);
      const dir = originalPath.substring(0, originalPath.lastIndexOf('/') + 1);
      const originalFileName = file.name;
      await this.app.fileManager.renameFile(file, `${dir}${InboxCuratorPlugin.PROCESSING_FILE_MARKER}${originalFileName}`);
      this.processingMarkerRenameSkipCache.add(file.path);
    }

    try {
      const pipelineOptions = this.getReviewPipelineOptions();
      pipelineOptions.operationId = job.operationId;
      const result = await runReviewPipeline(this.app, file, pipelineOptions);
      if (this.isUnloaded) {
        return { status: 'cancelled', error: 'Plugin unloaded' };
      }
      if (result.ok === false) {
        logError(this.app, 'ERROR', 'Inbox Curator: Review pipeline failed', {
          provider: this.settings.provider,
          model: this.settings.model,
          notePath: file.path,
          stage: result.stage,
          error: result.error ?? 'Unknown error',
        });
        void logOperation(this.app, {
          timestamp: new Date().toISOString(),
          level: 'ERROR',
          event: 'pipeline_failed',
          operationId: job.operationId,
          notePath: file.path,
          provider: this.settings.provider,
          model: this.settings.model,
          stage: result.stage,
          message: result.error ?? 'Unknown error',
          errorKind: result.retryable ? 'retryable' : 'fatal',
        });
        if (result.errorCode === 'image_not_supported') {
          new Notice(t('error.imageNotSupported'));
        }
        return {
          status: 'failed',
          error: result.error,
          retryable: result.retryable,
        };
      }

      // Phase 5c: Auto-execute actions (Granular)
      const action = result.reviewResult.verdict.recommendedAction;
      const reviewAction = mapRecommendedActionToReviewAction(action);
      const reliabilityLabel = result.reviewResult.verdict.reliabilityLabel;
      const confidence: ReviewConfidence | undefined = (result as any).confidence;
      const effectiveConfidence = confidence ||
        (reliabilityLabel === 'high' ? 'high' : reliabilityLabel === 'medium' ? 'medium' : 'low');
      const parseStatus = result.parseStatus || 'parsed';
      let shouldAutoExecute = false;
      let autoExecuteSkipReason: string | undefined;
      let autoExecuteSkipCode: string | undefined;

      if (this.settings.reviewMode === 'safe') {
        autoExecuteSkipReason = 'review-only mode disables auto-sort';
        autoExecuteSkipCode = 'safe_mode';
      } else {
        shouldAutoExecute = canAutoExecuteReviewAction(
          reviewAction,
          parseStatus,
          effectiveConfidence,
          this.settings.reviewMode,
          {
            autoExecuteArchive: this.settings.autoExecuteArchive,
            autoExecuteReadLater: this.settings.autoExecuteReadLater,
            autoExecuteTask: this.settings.autoExecuteTask,
          },
        );

        if (!shouldAutoExecute) {
          if (parseStatus !== 'parsed') { autoExecuteSkipReason = `parseStatus is ${parseStatus}`; autoExecuteSkipCode = 'parse_status'; }
          else if (effectiveConfidence !== 'high' && reviewAction === 'task') { autoExecuteSkipReason = `task requires high confidence (got ${effectiveConfidence})`; autoExecuteSkipCode = 'task_requires_high'; }
          else if (effectiveConfidence === 'low') { autoExecuteSkipReason = `confidence is low (${effectiveConfidence})`; autoExecuteSkipCode = 'confidence_low'; }
          else if (action === 'delete_candidate') { autoExecuteSkipReason = 'delete_candidate is never auto-executed'; autoExecuteSkipCode = 'delete_candidate'; }
          else { autoExecuteSkipReason = 'setting disabled or action none'; autoExecuteSkipCode = 'setting_disabled'; }
        }
      }

      if (shouldAutoExecute && reliabilityLabel !== 'high') {
        const allowsMediumReliability = reviewAction === 'archive' || reviewAction === 'read_later';
        if (!allowsMediumReliability || reliabilityLabel !== 'medium') {
          shouldAutoExecute = false;
          autoExecuteSkipReason = `reliabilityLabel is ${reliabilityLabel} for action ${action}`;
          autoExecuteSkipCode = 'reliability_low';
          logError(this.app, 'WARN', `Inbox Curator: Skipped auto-execute for ${file.path} due to reliability ${reliabilityLabel}`, {
            actionType: action,
            reliabilityLabel,
          });
          void logOperation(this.app, {
            timestamp: new Date().toISOString(),
            level: 'WARN',
            event: 'auto_sort_skipped',
            operationId: job.operationId,
            notePath: file.path,
            actionType: action,
            message: `Auto-sort skipped: reliabilityLabel is ${reliabilityLabel} for action ${action}`,
            details: { reliabilityLabel, reviewAction, hasPromptInjectionSignals: result.hasPromptInjectionSignals ?? null, reasonCode: 'reliability_low' },
          });
        }
      }

      if (shouldAutoExecute && result.hasPromptInjectionSignals && reviewAction === 'task') {
        shouldAutoExecute = false;
        autoExecuteSkipReason = 'prompt injection signals detected for task';
        autoExecuteSkipCode = 'prompt_injection';
        void logOperation(this.app, {
          timestamp: new Date().toISOString(),
          level: 'INFO',
          event: 'auto_sort_skipped',
          operationId: job.operationId,
          notePath: file.path,
          actionType: action,
          message: 'Auto-sort skipped: prompt injection signals detected for task',
          details: {
            action,
            reviewMode: this.settings.reviewMode,
            parseStatus,
            confidence: effectiveConfidence,
            reliabilityLabel,
            hasPromptInjectionSignals: true,
            reasonCode: 'prompt_injection',
          },
        });
      }

      if (!shouldAutoExecute && autoExecuteSkipReason) {
        void logOperation(this.app, {
          timestamp: new Date().toISOString(),
          level: 'INFO',
          event: 'auto_sort_skipped',
          operationId: job.operationId,
          notePath: file.path,
          actionType: action,
          message: `Auto-sort skipped: ${autoExecuteSkipReason}`,
          details: { parseStatus, confidence: effectiveConfidence, reliabilityLabel, reviewMode: this.settings.reviewMode, hasPromptInjectionSignals: result.hasPromptInjectionSignals ?? null, reasonCode: autoExecuteSkipCode ?? null },
        });
      }

      if (
        shouldAutoExecute &&
        (job.source === 'manual-folder' || job.source === 'auto-create' || job.source === 'auto-modify' || job.source === 'polling')
      ) {
        const actionResult = await executeProposedAction(this.app, file, {
          outputFolder: this.settings.reviewOutputFolder,
          readLaterFolder: this.settings.readLaterFolder,
          taskFolder: this.settings.taskFolder,
          deleteCandidateFolder: this.settings.deleteCandidateFolder,
          skipConfirmation: true,
          suggestedFolderBasePath: this.settings.suggestedFolderBasePath,
        });
        if (this.isUnloaded) {
          return { status: 'cancelled', error: 'Plugin unloaded' };
        }

        try {
          await appendAutoExecuteResult(this.app, result.writeResult.outputPath, {
            recommendedAction: action,
            executed: actionResult.success,
            status: actionResult.status,
            sourcePath: file.path,
            destinationPath: actionResult.destinationPath,
            error: actionResult.success ? undefined : actionResult.error,
          }, result.reviewResult.promptLanguage);
        } catch (appendErr) {
          const appendErrorMessage = appendErr instanceof Error ? appendErr.message : String(appendErr);
          logError(this.app, 'WARN', 'Inbox Curator: Failed to append auto-execute result to review log', {
            error: appendErrorMessage,
            reviewNotePath: result.writeResult.outputPath,
          });
          void logOperation(this.app, {
            timestamp: new Date().toISOString(),
            level: 'WARN',
            event: 'auto_execute_result_append_failed',
            operationId: job.operationId,
            notePath: file.path,
            reviewNotePath: result.writeResult.outputPath,
            message: appendErrorMessage,
          });
        }

        if (!actionResult.success) {
          logError(this.app, 'ERROR', `Inbox Curator: Auto-execute failed for ${file.path}`, {
            error: actionResult.error,
          });
          void logOperation(this.app, {
            timestamp: new Date().toISOString(),
            level: 'ERROR',
            event: 'auto_sort_failed',
            operationId: job.operationId,
            notePath: file.path,
            actionType: action,
            message: actionResult.error ?? 'Unknown error',
          });
          new Notice(t('notice.autoExecuteFailed', { error: actionResult.error || 'Unknown error' }));
          
          return {
            status: 'failed',
            error: `Auto-execute action ${action} failed: ${actionResult.error}`,
            retryable: false,
          };
        }

        void logOperation(this.app, {
          timestamp: new Date().toISOString(),
          level: 'INFO',
          event: 'auto_sort_executed',
          operationId: job.operationId,
          notePath: file.path,
          actionType: action,
          filePath: actionResult.destinationPath,
          message: 'Auto-sort executed',
          details: {
            runId: job.runId,
            action: reviewAction,
            sourcePath: file.path,
            destinationPath: actionResult.destinationPath ?? null,
            reviewMode: this.settings.reviewMode,
            parseStatus,
            confidence: effectiveConfidence,
            reliabilityLabel,
            reasonCode: 'executed',
          },
        });

        void appendAutoSortActionRecord(this.app, {
          runId: job.runId,
          timestamp: Date.now(),
          action: reviewAction as AutoSortActionRecord['action'],
          sourcePath: file.path,
          destinationPath: actionResult.destinationPath ?? file.path,
          reviewMode: this.settings.reviewMode,
          parseStatus: parseStatus,
          confidence: effectiveConfidence,
          reliabilityLabel: reliabilityLabel,
        }).catch((err) => {
          logError(this.app, 'WARN', 'Inbox Curator: Failed to save auto-sort history', {
            error: err instanceof Error ? err.message : String(err),
          });
        });
      } else if (shouldAutoExecute) {
        void logOperation(this.app, {
          timestamp: new Date().toISOString(),
          level: 'WARN',
          event: 'auto_sort_skipped',
          operationId: job.operationId,
          notePath: file.path,
          actionType: action,
          message: 'Source is not a watched-folder job',
          details: { reasonCode: 'non_watched_source' },
        });
      }

      void logOperation(this.app, {
        timestamp: new Date().toISOString(),
        level: 'INFO',
        event: 'queue_completed',
        operationId: job.operationId,
        notePath: file.path,
      });
      return { status: 'processed' };
    } catch (error) {
      logError(this.app, 'ERROR', 'Inbox Curator: Review job crashed', {
        provider: this.settings.provider,
        model: this.settings.model,
        notePath: file.path,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      void logOperation(this.app, {
        timestamp: new Date().toISOString(),
        level: 'ERROR',
        event: 'queue_failed',
        operationId: job.operationId,
        notePath: file.path,
        provider: this.settings.provider,
        model: this.settings.model,
        message: error instanceof Error ? error.message : 'Unknown error',
        errorKind: 'crash',
      });
      return {
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    } finally {
      if (isBackgroundAutoJob) {
        await this.cleanupEmojiPrefixFiles(true);
      }
    }
  }

  private isInWatchedFolder(file: TFile, watchedFolder: string): boolean {
    const normalizedFolder = normalizePath(watchedFolder);
    return file.path === normalizedFolder || file.path.startsWith(`${normalizedFolder}/`);
  }

  private isInReviewOutputFolder(file: TFile): boolean {
    const outputFolder = this.settings.reviewOutputFolder.trim();
    if (!outputFolder) {
      return false;
    }

    const normalizedOutputFolder = normalizePath(outputFolder);
    return file.path === normalizedOutputFolder || file.path.startsWith(`${normalizedOutputFolder}/`);
  }

  private isWatchedFolderReviewCandidate(file: TFile): boolean {
    const watchedFolder = this.settings.watchedFolder.trim();
    if (!watchedFolder) {
      return false;
    }

    if (file.extension !== 'md') {
      return false;
    }

    if (file.path.startsWith('.inbox-curator/') || file.path.includes('/.inbox-curator/')) {
      return false;
    }

    if (!this.isInWatchedFolder(file, watchedFolder)) {
      return false;
    }

    if (this.isInReviewOutputFolder(file)) {
      return false;
    }

    if (file.path.endsWith('.ai-review.md')) {
      return false;
    }

    return true;
  }

  private isWatchedFolderValid(): boolean {
    const folder = this.settings.watchedFolder.trim();
    if (!folder) return false;
    const folderRef = this.app.vault.getAbstractFileByPath(normalizePath(folder));
    return folderRef instanceof TFolder;
  }

  private async shouldSkipWatchedFile(file: TFile): Promise<boolean> {
    // 1. metadataCache から file cache を取得する
    const fileCache = this.app.metadataCache.getFileCache(file);

    // 2. metadataCache が取得できない、または frontmatter cache がない場合は read にフォールバックする
    if (fileCache && fileCache.frontmatter) {
      const aiReviewSourceHash = fileCache.frontmatter.ai_review_source_hash;

      // 3. frontmatter cache があり、ai_review_source_hash がない場合は cache を削除して return false
      if (typeof aiReviewSourceHash !== 'string' || aiReviewSourceHash.trim() === '') {
        this.fileSkipCache.delete(file.path);
        return false;
      }

      // 4. ai_review_source_hash がある場合、cache の mtime と現在の mtime を比較する
      const cached = this.fileSkipCache.get(file.path);
      if (cached) {
        // 5. mtime が一致し、cached reviewHash も一致する場合、readせず return true
        if (cached.mtime === file.stat.mtime && cached.reviewHash === aiReviewSourceHash) {
          return true;
        }
      }
    }

    // 6. cache miss または mtime変更時は app.vault.read(file)
    const content = await this.app.vault.read(file);

    // 7. 本文から fresh hash (sourceHash) を計算する
    const currentSource = buildReviewSourceInfo(file, this.settings.reviewOutputFolder, content);
    const freshSourceHash = currentSource.sourceHash;

    // 読み込んだ本文のフロントマターから取得した最新の ai_review_source_hash
    const freshExistingHash = readAiReviewSourceHash(content);

    // 8. fresh hash と ai_review_source_hash が一致する場合、cacheを更新して return true
    if (freshExistingHash && freshExistingHash === freshSourceHash) {
      this.fileSkipCache.set(file.path, {
        mtime: file.stat.mtime,
        reviewHash: freshExistingHash,
      });
      return true;
    }

    // 9. 一致しない場合、cacheを削除して return false
    this.fileSkipCache.delete(file.path);
    return false;
  }

  private getWatchedFolderMarkdownFiles(): TFile[] {
    return this.app.vault.getMarkdownFiles().filter((file) => this.isWatchedFolderReviewCandidate(file));
  }

  private getWatchedFolderRequestDelayMs(): number {
    const requestsPerMinute = Math.max(1, Math.round(this.settings.requestsPerMinute));
    const configuredDelay = Math.max(0, Math.round(this.settings.delayBetweenRequestsMs));
    const rateDelay = Math.ceil(60000 / requestsPerMinute);
    return Math.max(configuredDelay, rateDelay);
  }

  private logQueuedReviewFailure(file: TFile, error: string | undefined): void {
    logError(this.app, 'ERROR', 'Inbox Curator queued review failed', {
      provider: this.settings.provider,
      endpointUrl: this.settings.endpointUrl,
      model: this.settings.model,
      notePath: file.path,
      error: error ?? 'Unknown error',
    });
  }

  private logQueuedReviewRetry(job: ReviewJob, attempt: number, delayMs: number, error: string | undefined): void {
    logError(this.app, 'WARN', 'Inbox Curator queued review retry scheduled', {
      provider: this.settings.provider,
      endpointUrl: this.settings.endpointUrl,
      model: this.settings.model,
      notePath: job.notePath,
      source: job.source,
      nextAttempt: attempt,
      delayMs,
      error: error ?? 'Unknown error',
    });
  }

  private logAutomaticReviewEnqueueFailure(file: TFile, reason: AutomaticReviewReason, error: string): void {
    logError(this.app, 'ERROR', 'Inbox Curator automatic review enqueue failed', {
      provider: this.settings.provider,
      endpointUrl: this.settings.endpointUrl,
      model: this.settings.model,
      notePath: file.path,
      reason,
      error,
    });
  }

  private clearAutomaticReviewTimer(notePath: string): void {
    const timeoutId = this.automaticReviewTimers.get(notePath);
    if (timeoutId === undefined) {
      return;
    }

    window.clearTimeout(timeoutId);
    this.automaticReviewTimers.delete(notePath);
  }

  private clearAutomaticReviewTimers(): void {
    for (const timeoutId of Array.from(this.automaticReviewTimers.values())) {
      window.clearTimeout(timeoutId);
    }

    this.automaticReviewTimers.clear();
  }

  private stopPolling(): void {
    if (this.pollingIntervalId !== null) {
      window.clearInterval(this.pollingIntervalId);
      this.pollingIntervalId = null;
    }

    this.pollingInProgress = false;
  }

  private configurePolling(): void {
    this.stopPolling();

    if (!this.settings.enablePolling) {
      return;
    }

    const intervalMs = Math.max(5000, Math.round(this.settings.pollingIntervalMs));
    this.pollingIntervalId = window.setInterval(() => {
      void this.runPollingSweep();
    }, intervalMs);
  }

  private async handleWatchedFolderCreate(file: TFile): Promise<void> {
    if (!this.isWatchedFolderValid()) return;
    if (!this.settings.enableAutomaticWatching || !this.settings.autoReviewOnCreate) {
      return;
    }

    this.scheduleAutomaticReview(file, 'create');
  }

  private async handleWatchedFolderModify(file: TFile): Promise<void> {
    if (!this.isWatchedFolderValid()) return;
    if (!this.settings.enableAutomaticWatching || !this.settings.autoReviewOnModify) {
      return;
    }

    this.scheduleAutomaticReview(file, 'modify');
  }

  private scheduleAutomaticReview(file: TFile, reason: AutomaticReviewReason): void {
    if (!this.isWatchedFolderReviewCandidate(file)) {
      return;
    }

    void logOperation(this.app, {
      timestamp: new Date().toISOString(),
      level: 'INFO',
      event: 'watch_triggered',
      notePath: file.path,
      details: { triggerType: reason },
    });

    // Suppress re-enqueue from marker rename / cleanup rename events.
    // Consume-once: the matching path is removed to prevent indefinite skip.
    if (this.processingMarkerRenameSkipCache.has(file.path)) {
      this.processingMarkerRenameSkipCache.delete(file.path);
      return;
    }

    const debounceMs = Math.max(0, Math.round(this.settings.watchDebounceMs));
    this.clearAutomaticReviewTimer(file.path);

    const timeoutId = window.setTimeout(() => {
      this.automaticReviewTimers.delete(file.path);
      void this.enqueueAutomaticReview(file.path, reason);
    }, debounceMs);

    this.automaticReviewTimers.set(file.path, timeoutId);
  }

  private async enqueueAutomaticReview(notePath: string, reason: AutomaticReviewReason): Promise<void> {
    const file = this.resolveMarkdownFile(notePath);
    if (!file || !this.isWatchedFolderReviewCandidate(file)) {
      return;
    }

    const source: ReviewJobSource = reason === 'poll' ? 'polling' : reason === 'create' ? 'auto-create' : 'auto-modify';
    const result = await this.tryEnqueueAutomaticReview(file, source);
    if (!result.accepted) {
      if (!result.skipped && !result.duplicate && result.error) {
        this.logAutomaticReviewEnqueueFailure(file, reason, result.error);
      }
      return;
    }

    if (result.promise) {
      this.attachBackgroundReviewResultLogging(file, result.promise);
    }
  }

  private async tryEnqueueAutomaticReview(file: TFile, source: Extract<ReviewJobSource, 'auto-create' | 'auto-modify' | 'polling'>, runId?: string): Promise<AutomaticEnqueueResult> {
    try {
      if (this.isProcessingMarkerPath(file.path) || this.processingMarkerRenameSkipCache.has(file.path)) {
        this.processingMarkerRenameSkipCache.delete(file.path);
        return { accepted: false, skipped: true };
      }

      if (await this.shouldSkipWatchedFile(file)) {
        return { accepted: false, skipped: true };
      }

      const job = createReviewJob(source, file.path, 0, runId);
      const queued = this.reviewQueue.enqueue(job);
      if (!queued.accepted) {
        return {
          accepted: false,
          duplicate: queued.duplicate,
          error: queued.duplicate ? 'Duplicate queued review job' : 'Queue is stopping',
        };
      }

      void logOperation(this.app, {
        timestamp: new Date().toISOString(),
        level: 'INFO',
        event: 'queue_enqueued',
        operationId: job.operationId,
        notePath: file.path,
        details: { triggerType: source },
      });

      return {
        accepted: true,
        promise: queued.promise,
      };
    } catch (error) {
      return {
        accepted: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private attachBackgroundReviewResultLogging(file: TFile, resultPromise: Promise<ReviewJobResult>): void {
    void resultPromise.then((result) => {
      if (result.status === 'processed' || result.status === 'skipped' || result.status === 'cancelled') {
        return;
      }

      this.logQueuedReviewFailure(file, result.error);
    });
  }

  private async runPollingSweep(): Promise<void> {
    if (!this.settings.enablePolling || this.pollingInProgress) {
      return;
    }

    if (!this.isWatchedFolderValid()) return;

    this.pollingInProgress = true;
    try {
      const files = this.getWatchedFolderMarkdownFiles();
      const maxNotesPerSweep = Math.max(1, Math.round(this.settings.maxNotesPerRun));
      let acceptedCount = 0;
      const batchRunId = generateRunId();

      for (const file of files) {
        if (acceptedCount >= maxNotesPerSweep) {
          break;
        }

        const result = await this.tryEnqueueAutomaticReview(file, 'polling', batchRunId);
        if (!result.accepted) {
          if (!result.skipped && !result.duplicate && result.error) {
            this.logAutomaticReviewEnqueueFailure(file, 'poll', result.error);
          }
          continue;
        }

        acceptedCount += 1;
        if (result.promise) {
          this.attachBackgroundReviewResultLogging(file, result.promise);
        }
      }
    } finally {
      this.pollingInProgress = false;
    }
  }

  getActiveMarkdownFile(): TFile | null {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const file = view?.file;

    if (!(file instanceof TFile) || file.extension !== 'md') {
      return null;
    }

    return file;
  }

  async reviewActiveFile(): Promise<void> {
    const file = this.getActiveMarkdownFile();
    if (!file) {
      new Notice(t('notice.openMarkdownNoteFirst'));
      return;
    }

    await this.reviewFile(file);
  }

  async reviewFile(file: TFile): Promise<void> {
    if (file.path.endsWith('.ai-review.md')) {
      new Notice(t('notice.cannotReviewAiReview'));
      return;
    }

    if (!this.tryBeginProcessing(t('notice.reviewingCurrentNote'))) {
      return;
    }

    this.updateProcessingStatus(t('notice.reviewingCurrentNote'));

    try {
      const job = createReviewJob('manual-current', file.path);
      const queued = this.reviewQueue.enqueue(job);
      const result = await queued.promise;

      if (result.status !== 'processed') {
        logError(this.app, 'ERROR', 'Inbox Curator: Note review failed', {
          notePath: file.path,
          error: result.error ?? 'Review did not complete',
        });
        new Notice(this.buildShortReviewError(result.error ?? 'Review did not complete'));
        return;
      }

      new Notice(t('notice.reviewCompleted'));
    } catch (error) {
      logError(this.app, 'ERROR', 'Inbox Curator: Note review crashed', {
        notePath: file.path,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      new Notice(this.buildShortReviewError(error instanceof Error ? error.message : 'Unknown error'));
    } finally {
      this.finishProcessing();
    }
  }

  async processWatchedFolder(): Promise<void> {
    const watchedFolder = this.settings.watchedFolder.trim();
    if (!watchedFolder) {
      new Notice(t('notice.watchedFolderNotSet'));
      return;
    }

    if (!this.isWatchedFolderValid()) {
      new Notice(t('notice.watchedFolderNotFound', { folder: watchedFolder }));
      return;
    }

    if (!this.tryBeginProcessing(t('notice.processingWatchedFolder'))) {
      return;
    }

    try {
      const files = this.getWatchedFolderMarkdownFiles();
      this.updateProcessingStatus(t('notice.processingProgress', { current: 0, total: files.length }));

      const summary: WatchedFolderProcessingSummary = {
        processed: 0,
        skipped: 0,
        failed: 0,
        remaining: 0,
      };
      const maxNotesPerRun = Math.max(1, Math.round(this.settings.maxNotesPerRun));
      const delayMs = this.getWatchedFolderRequestDelayMs();
      const queuedTasks: QueuedReviewTask[] = [];
      let queuedReviewCount = 0;
      const batchRunId = generateRunId();

      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        this.updateProcessingStatus(t('notice.processingProgress', { current: index + 1, total: files.length }));

        try {
          if (await this.shouldSkipWatchedFile(file)) {
            summary.skipped += 1;
            continue;
          }

          if (queuedReviewCount >= maxNotesPerRun) {
            summary.remaining += 1;
            continue;
          }

          const delayBeforeStartMs = queuedReviewCount > 0 ? delayMs : 0;
          const job = createReviewJob('manual-folder', file.path, delayBeforeStartMs, batchRunId);
          const queued = this.reviewQueue.enqueue(job);
          if (!queued.accepted) {
            summary.failed += 1;
            this.logQueuedReviewFailure(file, queued.duplicate ? 'Duplicate queued review job' : 'Queue is stopping');
            continue;
          }

          queuedTasks.push({
            file,
            resultPromise: queued.promise,
          });
          queuedReviewCount += 1;
        } catch (error) {
          summary.failed += 1;
          logError(this.app, 'ERROR', 'Inbox Curator watched folder processing crashed', {
            provider: this.settings.provider,
            endpointUrl: this.settings.endpointUrl,
            model: this.settings.model,
            notePath: file.path,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }

      for (let index = 0; index < queuedTasks.length; index += 1) {
        const task = queuedTasks[index];
        this.updateProcessingStatus(t('notice.reviewingProgress', { current: index + 1, total: queuedTasks.length }));
        const result = await task.resultPromise;

        if (result.status === 'processed') {
          summary.processed += 1;
          continue;
        }

        if (result.status === 'skipped') {
          summary.skipped += 1;
          continue;
        }

        summary.failed += 1;
        this.logQueuedReviewFailure(task.file, result.error);
      }

      new Notice(
        t('notice.watchedFolderCompleted', {
          processed: summary.processed,
          skipped: summary.skipped,
          failed: summary.failed,
          remaining: summary.remaining,
        }),
      );
    } finally {
      this.finishProcessing();
    }
  }

  async reviewSelectedNotesAsCollection(): Promise<void> {
    const files = this.getSelectedMarkdownFiles();
    if (files.length === 0) {
      new Notice(t('notice.collectionReview.selectNotes'));
      return;
    }

    await this.runCollectionReviewFlow(files, 'selected_notes', '');
  }

  async reviewFolderAsCollection(activeFile?: TFile | null): Promise<void> {
    let folderPath: string;
    if (activeFile instanceof TFile) {
      const parent = activeFile.parent;
      folderPath = parent ? parent.path : '';
    } else {
      const file = this.getActiveMarkdownFile();
      if (file) {
        const parent = file.parent;
        folderPath = parent ? parent.path : '';
      } else {
        const watchedFolder = this.settings.watchedFolder.trim();
        if (watchedFolder && this.isWatchedFolderValid()) {
          folderPath = watchedFolder;
        } else {
          new Notice(t('notice.collectionReview.noNotes'));
          return;
        }
      }
    }

    if (!folderPath) {
      new Notice(t('notice.collectionReview.noNotes'));
      return;
    }

    const files = await getFolderMarkdownFilesForCollectionReview(this.app, folderPath, {
      outputFolder: this.settings.collectionReviewOutputFolder,
      provider: this.settings.provider,
      endpointUrl: this.settings.endpointUrl,
      model: this.settings.model,
      apiKey: '',
      maxNotes: this.settings.collectionReviewMaxNotes,
      maxExcerptCharsPerNote: this.settings.collectionReviewMaxExcerptCharsPerNote,
      useExistingReviewsFirst: this.settings.collectionReviewUseExistingReviewsFirst,
      includeExcerptWhenNeeded: this.settings.collectionReviewIncludeExcerptWhenNeeded,
      promptLanguage: this.resolveCollectionReviewPromptLanguage(),
      requestTimeoutMs: this.settings.requestTimeoutMs,
      maxOutputTokens: 4096,
      isUnloaded: () => this.isUnloaded,
    });

    if (files.length === 0) {
      new Notice(t('notice.collectionReview.noNotes'));
      return;
    }

    new Notice(t('notice.collectionReview.processingFolder', { folder: folderPath }));
    await this.runCollectionReviewFlow(files, 'folder', folderPath);
  }

  private getSelectedMarkdownFiles(): TFile[] {
    const vault = this.app.vault;
    const fileExplorer = (this.app as any).internalPlugins?.getPluginById?.('file-explorer');
    if (!fileExplorer) {
      return [];
    }

    try {
      const selectedPaths: string[] = [];
      const explorerLeaves = (this.app.workspace as any).getLeavesOfType?.('file-explorer');
      if (explorerLeaves && explorerLeaves.length > 0) {
        const explorerView = explorerLeaves[0]?.view;
        if (explorerView) {
          const tree = (explorerView as any).tree;
          if (tree && tree.selectedPaths) {
            const paths = tree.selectedPaths;
            if (Array.isArray(paths)) {
              selectedPaths.push(...paths);
            }
          }
        }
      }

      const files: TFile[] = [];
      for (const selPath of selectedPaths) {
        const file = vault.getAbstractFileByPath(selPath);
        if (file instanceof TFile && file.extension === 'md') {
          files.push(file);
        }
      }
      return files;
    } catch {
      return [];
    }
  }

  private async runCollectionReviewFlow(
    files: TFile[],
    sourceType: 'selected_notes' | 'folder',
    sourceFolder: string,
  ): Promise<void> {
    if (files.length < 2) {
      new Notice(t('notice.collectionReview.tooFew'));
      return;
    }

    if (files.length > this.settings.collectionReviewMaxNotes) {
      new Notice(t('notice.collectionReview.tooMany', {
        count: files.length,
        max: this.settings.collectionReviewMaxNotes,
      }));
      return;
    }

    const provider = this.settings.provider;
    const apiKey = await getApiKey(this.app, provider);
    if (!apiKey) {
      new Notice(t('notice.collectionReview.noApiKey'));
      return;
    }

    const budget = resolveReviewContextBudget(
      this.settings.contextBudgetPreset,
      this.settings.contextBudgetPreset === 'custom'
        ? {
            maxContextTokens: this.settings.customMaxContextTokens,
            maxInputContentTokens: this.settings.customMaxInputContentTokens,
            maxOutputTokens: this.settings.customMaxOutputTokens,
            safetyMarginTokens: this.settings.customSafetyMarginTokens,
          }
        : undefined,
    );

    const openAiTokenLimitParam = resolveEffectiveOpenAiTokenLimitParam(
      this.settings.openAiCompatibleTokenLimitParam,
      this.settings.openAiCompatibleDetectedTokenLimitParam,
      this.settings.openAiCompatibleDetectedTokenLimitKey,
      buildOpenAiCompatibleTokenLimitDetectionKey(this.settings.endpointUrl, this.settings.model),
    );

    const promptLanguage: 'english' | 'japanese' =
      this.resolveCollectionReviewPromptLanguage();

    if (!this.tryBeginProcessing(t('notice.collectionReview.started', { count: files.length }))) {
      return;
    }

    try {
      const result = await runCollectionReviewPipeline(this.app, files, {
        outputFolder: this.settings.collectionReviewOutputFolder,
        provider: this.settings.provider,
        endpointUrl: this.settings.endpointUrl,
        model: this.settings.model,
        apiKey,
        maxNotes: this.settings.collectionReviewMaxNotes,
        maxExcerptCharsPerNote: this.settings.collectionReviewMaxExcerptCharsPerNote,
        useExistingReviewsFirst: this.settings.collectionReviewUseExistingReviewsFirst,
        includeExcerptWhenNeeded: this.settings.collectionReviewIncludeExcerptWhenNeeded,
        promptLanguage,
        requestTimeoutMs: this.settings.requestTimeoutMs,
        maxOutputTokens: budget.maxOutputTokens,
        openAiTokenLimitParam,
        isUnloaded: () => this.isUnloaded,
      });

      if (result.ok) {
        new Notice(t('notice.collectionReview.completed', { path: result.outputPath }));
        void logOperation(this.app, {
          timestamp: new Date().toISOString(),
          level: 'INFO',
          event: 'collection_review_completed',
          notePath: result.outputPath,
          details: { noteCount: files.length, sourceType },
        });
      } else {
        new Notice(t('notice.collectionReview.failed', { error: result.error }));
        void logOperation(this.app, {
          timestamp: new Date().toISOString(),
          level: 'ERROR',
          event: 'collection_review_failed',
          message: result.error,
          details: { noteCount: files.length, sourceType },
        });
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      new Notice(t('notice.collectionReview.failed', { error: errorMsg }));
      void logOperation(this.app, {
        timestamp: new Date().toISOString(),
        level: 'ERROR',
        event: 'collection_review_failed',
        message: errorMsg,
        details: { noteCount: files.length, sourceType },
      });
    } finally {
      this.finishProcessing();
    }
  }

  async reviewMultipleFiles(files: TFile[]): Promise<void> {
    if (!this.tryBeginProcessing(t('notice.reviewingProgress', { current: 0, total: files.length }))) {
      return;
    }

    try {
      let processed = 0;
      let failed = 0;
      let skipped = 0;
      const queuedTasks: QueuedReviewTask[] = [];

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        this.updateProcessingStatus(t('notice.reviewingProgress', { current: i + 1, total: files.length }));
        const job = createReviewJob('manual-current', file.path);
        const queued = this.reviewQueue.enqueue(job);
        if (!queued.accepted) {
          failed++;
          continue;
        }
        queuedTasks.push({ file, resultPromise: queued.promise });
      }

      for (let i = 0; i < queuedTasks.length; i++) {
        this.updateProcessingStatus(t('notice.reviewingProgress', { current: i + 1, total: queuedTasks.length }));
        const result = await queuedTasks[i].resultPromise;
        if (result.status === 'processed') {
          processed++;
        } else if (result.status === 'skipped') {
          skipped++;
        } else {
          failed++;
        }
      }

      new Notice(t('notice.batchReviewCompleted', { processed, skipped, failed, total: files.length }));
    } catch (error) {
      logError(this.app, 'ERROR', 'Inbox Curator: batch review failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      new Notice(t('notice.reviewFailed'));
    } finally {
      this.finishProcessing();
    }
  }

  async executeProposedActionsForFiles(files: TFile[]): Promise<void> {
    let executed = 0;
    let skipped = 0;
    let failed = 0;
    const results: string[] = [];

    for (const file of files) {
      const result = await executeProposedAction(this.app, file, {
        outputFolder: this.settings.reviewOutputFolder,
        readLaterFolder: this.settings.readLaterFolder,
        taskFolder: this.settings.taskFolder,
        deleteCandidateFolder: this.settings.deleteCandidateFolder,
        suggestedFolderBasePath: this.settings.suggestedFolderBasePath,
        skipConfirmation: true,
      });

      if (result.success) {
        if (result.actionTaken === 'archive' || result.actionTaken === 'read_later' ||
            result.actionTaken === 'task' || result.actionTaken === 'delete_candidate') {
          executed++;
          if (result.actionTaken) results.push(result.actionTaken);
        } else {
          skipped++;
        }
      } else {
        failed++;
      }
    }

    new Notice(t('notice.batchActionsCompleted', { executed, skipped, failed }));
  }

  async cleanupMarkersForFiles(files: TFile[]): Promise<void> {
    let count = 0;
    const marker = InboxCuratorPlugin.PROCESSING_FILE_MARKER;

    for (const file of files) {
      if (!this.hasProcessingFileMarker(file.name)) continue;
      const cleanPath = file.path.replace(
        new RegExp(`/${marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g'),
        '/',
      );
      if (this.app.vault.getAbstractFileByPath(cleanPath) instanceof TFile) continue;
      try {
        this.processingMarkerRenameSkipCache.add(file.path);
        this.processingMarkerRenameSkipCache.add(cleanPath);
        await this.app.fileManager.renameFile(file, cleanPath);
        count++;
      } catch {
        // skip single file
      }
    }

    if (count > 0) {
      new Notice(t('notice.cleanupMarkers', { count }));
    } else {
      new Notice(t('notice.cleanupMarkersNone'));
    }
  }

  async executeProposedActionForActiveFile(): Promise<void> {
    const file = this.getActiveMarkdownFile();
    if (!file) {
      new Notice(t('notice.openMarkdownNoteFirst'));
      return;
    }
    await this.executeProposedActionForFile(file);
  }

  async executeProposedActionForFile(file: TFile): Promise<void> {
    const result = await executeProposedAction(this.app, file, {
      outputFolder: this.settings.reviewOutputFolder,
      readLaterFolder: this.settings.readLaterFolder,
      taskFolder: this.settings.taskFolder,
      deleteCandidateFolder: this.settings.deleteCandidateFolder,
      suggestedFolderBasePath: this.settings.suggestedFolderBasePath,
    });

    if (result.success) {
      if (result.actionTaken === 'archive') {
        new Notice(t('notice.autoExecutedArchive'));
      } else if (result.actionTaken === 'delete_candidate') {
        new Notice(t('notice.noteMovedToTrash'));
      } else if (result.actionTaken === 'none') {
        new Notice(t('notice.manualActionNoAutomatedSteps', { action: result.action || 'unknown' }));
      }
    } else {
      if (result.error && !result.error.includes('User cancelled')) {
        new Notice(t('notice.actionFailed', { error: result.error }));
      }
    }
  }
}

function mapRecommendedActionToReviewAction(action: string): ReviewAction {
  switch (action) {
    case 'archive': return 'archive';
    case 'read_later': return 'read_later';
    case 'task':
    case 'turn_into_task': return 'task';
    case 'delete_candidate': return 'delete_candidate';
    default: return 'none';
  }
}
