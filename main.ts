import { MarkdownView, Notice, Plugin, TFile, normalizePath } from 'obsidian';
import { registerInboxCuratorCommands } from './src/commands';
import { readAiReviewSourceHash } from './src/frontmatter';
import { buildReviewSourceInfo, runReviewPipeline } from './src/reviewPipeline';
import { DEFAULT_SETTINGS, InboxCuratorSettings, InboxCuratorSettingTab } from './src/settings';

const REVIEWING_STATUS_TEXT = 'Inbox Curator: Reviewing...';
const REVIEWING_NOTICE_TEXT = 'Inbox Curator: Reviewing current note...';
const PROCESSING_IN_PROGRESS_NOTICE_TEXT = 'Inbox Curator: Review already in progress';
const REVIEW_COMPLETED_NOTICE_TEXT = 'Inbox Curator: Review completed';
const REVIEW_FAILED_NOTICE_TEXT = 'Inbox Curator: Review failed';
const MISSING_WATCHED_FOLDER_NOTICE_TEXT = 'Inbox Curator: Watched folder is not set';
const PROCESSING_WATCHED_FOLDER_NOTICE_TEXT = 'Inbox Curator: Processing watched folder...';

interface WatchedFolderProcessingSummary {
  processed: number;
  skipped: number;
  failed: number;
}

export default class InboxCuratorPlugin extends Plugin {
  settings: InboxCuratorSettings = DEFAULT_SETTINGS;
  private processingInProgress = false;
  private reviewStatusBarEl!: HTMLElement;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.reviewStatusBarEl = this.addStatusBarItem();
    this.setStatusIdle();
    this.addSettingTab(new InboxCuratorSettingTab(this.app, this));
    registerInboxCuratorCommands(this);
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
    });
  }

  private setStatusIdle(): void {
    this.reviewStatusBarEl.textContent = '';
    this.reviewStatusBarEl.style.display = 'none';
  }

  private setStatusText(text: string): void {
    this.reviewStatusBarEl.textContent = text;
    this.reviewStatusBarEl.style.display = '';
  }

  private async flushStatusText(text: string): Promise<void> {
    this.setStatusText(text);
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
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
    new Notice(noticeText);
    return true;
  }

  private finishProcessing(): void {
    this.processingInProgress = false;
    this.setStatusIdle();
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

  private async shouldSkipWatchedFile(file: TFile): Promise<boolean> {
    const content = await this.app.vault.read(file);
    const currentSource = buildReviewSourceInfo(file, this.settings.reviewOutputFolder, content);
    const existingHash = readAiReviewSourceHash(content);
    return existingHash === currentSource.sourceHash;
  }

  private getWatchedFolderMarkdownFiles(): TFile[] {
    const watchedFolder = this.settings.watchedFolder.trim();
    return this.app.vault
      .getMarkdownFiles()
      .filter((file) => this.isInWatchedFolder(file, watchedFolder))
      .filter((file) => !this.isInReviewOutputFolder(file))
      .filter((file) => !file.path.endsWith('.ai-review.md'));
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

    await this.flushStatusText(REVIEWING_STATUS_TEXT);

    try {
      const result = await runReviewPipeline(this.app, file, {
        outputFolder: this.settings.reviewOutputFolder,
        provider: this.settings.provider,
        endpointUrl: this.settings.endpointUrl,
        model: this.settings.model,
      });

      if (result.ok === false) {
        new Notice(this.buildShortReviewError(result.error));
        return;
      }

      new Notice(REVIEW_COMPLETED_NOTICE_TEXT);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      new Notice(this.buildShortReviewError(message));
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
      await this.flushStatusText(`Inbox Curator: Processing 0/${files.length}...`);
      const summary: WatchedFolderProcessingSummary = {
        processed: 0,
        skipped: 0,
        failed: 0,
      };

      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        await this.flushStatusText(`Inbox Curator: Processing ${index + 1}/${files.length}...`);

        try {
          if (await this.shouldSkipWatchedFile(file)) {
            summary.skipped += 1;
            continue;
          }

          const result = await runReviewPipeline(this.app, file, {
            outputFolder: this.settings.reviewOutputFolder,
            provider: this.settings.provider,
            endpointUrl: this.settings.endpointUrl,
            model: this.settings.model,
          });

          if (result.ok === false) {
            summary.failed += 1;
            console.warn('Inbox Curator watched folder review failed', {
              notePath: file.path,
              error: result.error,
            });
            continue;
          }

          summary.processed += 1;
        } catch (error) {
          summary.failed += 1;
          console.warn('Inbox Curator watched folder processing crashed', {
            notePath: file.path,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }

      new Notice(
        `Inbox Curator: Watched folder completed (${summary.processed} processed, ${summary.skipped} skipped, ${summary.failed} failed)`,
      );
    } finally {
      this.finishProcessing();
    }
  }
}
