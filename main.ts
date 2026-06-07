import { MarkdownView, Notice, Plugin, TFile, normalizePath } from 'obsidian';
import { registerInboxCuratorCommands } from './src/commands';
import { readAiReviewSourceHash } from './src/frontmatter';
import { ProcessingNoticeManager } from './src/processingNotice';
import { createReviewJob } from './src/queue/job';
import { ReviewRateLimiter } from './src/queue/rateLimiter';
import { ReviewQueue } from './src/queue/reviewQueue';
import type { ReviewJob, ReviewJobResult, ReviewJobSource } from './src/queue/queueTypes';
import { buildReviewSourceInfo, runReviewPipeline, type ReviewPipelineOptions } from './src/reviewPipeline';
import { DEFAULT_SETTINGS, InboxCuratorSettings, InboxCuratorSettingTab } from './src/settings';
const REVIEWING_NOTICE_TEXT = 'Inbox Curator: Reviewing current note...';
const PROCESSING_IN_PROGRESS_NOTICE_TEXT = 'Inbox Curator: Review already in progress';
const REVIEW_COMPLETED_NOTICE_TEXT = 'Inbox Curator: Review completed';
const REVIEW_FAILED_NOTICE_TEXT = 'Inbox Curator: Review failed';
const MISSING_WATCHED_FOLDER_NOTICE_TEXT = 'Inbox Curator: Watched folder is not set';
const PROCESSING_WATCHED_FOLDER_NOTICE_TEXT = 'Inbox Curator: Processing watched folder...';

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

export default class InboxCuratorPlugin extends Plugin {
  settings: InboxCuratorSettings = DEFAULT_SETTINGS;
  private processingInProgress = false;
  private readonly processingNotice = new ProcessingNoticeManager();
  private reviewQueue!: ReviewQueue;
  private reviewRateLimiter = new ReviewRateLimiter();
  private readonly automaticReviewTimers = new Map<string, number>();
  private pollingIntervalId: number | null = null;
  private pollingInProgress = false;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.reviewQueue = new ReviewQueue(async (job) => this.runQueuedReviewJob(job), {
      rateLimiter: this.reviewRateLimiter,
      maxConcurrentJobs: this.settings.maxConcurrentReviews,
      onRetry: (job, attempt, delayMs, result) => {
        this.logQueuedReviewRetry(job, attempt, delayMs, result.error);
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

    this.addSettingTab(new InboxCuratorSettingTab(this.app, this));
    registerInboxCuratorCommands(this);
    this.configurePolling();
  }

  onunload(): void {
    this.clearAutomaticReviewTimers();
    this.stopPolling();
    this.reviewQueue.stop();
    this.reviewRateLimiter.reset();
    this.finishProcessing();
  }

  async loadSettings(): Promise<void> {
    const saved = (await this.loadData()) as Partial<InboxCuratorSettings> | null;
    this.settings = { ...DEFAULT_SETTINGS, ...(saved ?? {}) };
  }

  async saveSettings(): Promise<void> {
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
      readVideos: this.settings.readVideos,
    });

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
      return REVIEW_FAILED_NOTICE_TEXT;
    }

    const maxLength = 120;
    const clipped = normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength)}…`;
    return `${REVIEW_FAILED_NOTICE_TEXT}: ${clipped}`;
  }

  private tryBeginProcessing(noticeText: string): boolean {
    if (this.processingInProgress) {
      new Notice(PROCESSING_IN_PROGRESS_NOTICE_TEXT);
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
    return {
      outputFolder: this.settings.reviewOutputFolder,
      provider: this.settings.provider,
      endpointUrl: this.settings.endpointUrl,
      model: this.settings.model,
      fetchUrlMetadata: this.settings.fetchUrlMetadata,
      extractUrlArticleText: this.settings.extractUrlArticleText,
      maxExtractedCharacters: this.settings.maxExtractedCharacters,
      readImages: this.settings.readImages,
      readVideos: this.settings.readVideos,
    };
  }

  private resolveMarkdownFile(notePath: string): TFile | null {
    const file = this.app.vault.getAbstractFileByPath(notePath);
    if (!(file instanceof TFile) || file.extension !== 'md') {
      return null;
    }

    return file;
  }

  private async runQueuedReviewJob(job: ReviewJob): Promise<ReviewJobResult> {
    const file = this.resolveMarkdownFile(job.notePath);
    if (!file) {
      return {
        status: 'failed',
        error: 'Markdown note not found',
      };
    }

    try {
      const result = await runReviewPipeline(this.app, file, this.getReviewPipelineOptions());
      if (result.ok === false) {
        return {
          status: 'failed',
          error: result.error,
          retryable: result.retryable,
        };
      }

      return { status: 'processed' };
    } catch (error) {
      return {
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
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

  private async shouldSkipWatchedFile(file: TFile): Promise<boolean> {
    const content = await this.app.vault.read(file);
    const currentSource = buildReviewSourceInfo(file, this.settings.reviewOutputFolder, content);
    const existingHash = readAiReviewSourceHash(content);
    return existingHash === currentSource.sourceHash;
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
    console.warn('Inbox Curator queued review failed', {
      provider: this.settings.provider,
      endpointUrl: this.settings.endpointUrl,
      model: this.settings.model,
      notePath: file.path,
      error: error ?? 'Unknown error',
    });
  }

  private logQueuedReviewRetry(job: ReviewJob, attempt: number, delayMs: number, error: string | undefined): void {
    console.warn('Inbox Curator queued review retry scheduled', {
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
    console.warn('Inbox Curator automatic review enqueue failed', {
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
    if (!this.settings.enableAutomaticWatching || !this.settings.autoReviewOnCreate) {
      return;
    }

    this.scheduleAutomaticReview(file, 'create');
  }

  private async handleWatchedFolderModify(file: TFile): Promise<void> {
    if (!this.settings.enableAutomaticWatching || !this.settings.autoReviewOnModify) {
      return;
    }

    this.scheduleAutomaticReview(file, 'modify');
  }

  private scheduleAutomaticReview(file: TFile, reason: AutomaticReviewReason): void {
    if (!this.isWatchedFolderReviewCandidate(file)) {
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

    const result = await this.tryEnqueueAutomaticReview(file, reason === 'poll' ? 'watched-folder-poll' : 'watched-folder-auto');
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

  private async tryEnqueueAutomaticReview(file: TFile, source: Extract<ReviewJobSource, 'watched-folder-auto' | 'watched-folder-poll'>): Promise<AutomaticEnqueueResult> {
    try {
      if (await this.shouldSkipWatchedFile(file)) {
        return { accepted: false, skipped: true };
      }

      const queued = this.reviewQueue.enqueue(createReviewJob(source, file.path));
      if (!queued.accepted) {
        return {
          accepted: false,
          duplicate: queued.duplicate,
          error: queued.duplicate ? 'Duplicate queued review job' : 'Queue is stopping',
        };
      }

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

    this.pollingInProgress = true;
    try {
      const files = this.getWatchedFolderMarkdownFiles();
      const maxNotesPerSweep = Math.max(1, Math.round(this.settings.maxNotesPerRun));
      let acceptedCount = 0;

      for (const file of files) {
        if (acceptedCount >= maxNotesPerSweep) {
          break;
        }

        const result = await this.tryEnqueueAutomaticReview(file, 'watched-folder-poll');
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
      new Notice('Open a Markdown note first.');
      return;
    }

    await this.reviewFile(file);
  }

  async reviewFile(file: TFile): Promise<void> {
    if (!this.tryBeginProcessing(REVIEWING_NOTICE_TEXT)) {
      return;
    }

    this.updateProcessingStatus(REVIEWING_NOTICE_TEXT);

    try {
      const job = createReviewJob('current-note', file.path);
      const queued = this.reviewQueue.enqueue(job);
      const result = await queued.promise;

      if (result.status !== 'processed') {
        new Notice(this.buildShortReviewError(result.error ?? 'Review did not complete'));
        return;
      }

      new Notice(REVIEW_COMPLETED_NOTICE_TEXT);
    } finally {
      this.finishProcessing();
    }
  }

  async processWatchedFolder(): Promise<void> {
    const watchedFolder = this.settings.watchedFolder.trim();
    if (!watchedFolder) {
      new Notice(MISSING_WATCHED_FOLDER_NOTICE_TEXT);
      return;
    }

    if (!this.tryBeginProcessing(PROCESSING_WATCHED_FOLDER_NOTICE_TEXT)) {
      return;
    }

    try {
      const files = this.getWatchedFolderMarkdownFiles();
      this.updateProcessingStatus(`Inbox Curator: Processing 0/${files.length}...`);

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

      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        this.updateProcessingStatus(`Inbox Curator: Processing ${index + 1}/${files.length}...`);

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
          const job = createReviewJob('watched-folder-manual', file.path, delayBeforeStartMs);
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
          console.warn('Inbox Curator watched folder processing crashed', {
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
        this.updateProcessingStatus(`Inbox Curator: Reviewing ${index + 1}/${queuedTasks.length}...`);
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
        `Inbox Curator: Watched folder completed (${summary.processed} processed, ${summary.skipped} skipped, ${summary.failed} failed, ${summary.remaining} remaining)`,
      );
    } finally {
      this.finishProcessing();
    }
  }
}
