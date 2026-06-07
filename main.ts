import { MarkdownView, Notice, Plugin, TFile } from 'obsidian';
import { registerInboxCuratorCommands } from './src/commands';
import { runReviewPipeline } from './src/reviewPipeline';
import { DEFAULT_SETTINGS, InboxCuratorSettings, InboxCuratorSettingTab } from './src/settings';

const REVIEWING_STATUS_TEXT = 'Inbox Curator: Reviewing...';
const REVIEWING_NOTICE_TEXT = 'Inbox Curator: Reviewing current note...';
const REVIEW_IN_PROGRESS_NOTICE_TEXT = 'Inbox Curator: Review already in progress';
const REVIEW_COMPLETED_NOTICE_TEXT = 'Inbox Curator: Review completed';
const REVIEW_FAILED_NOTICE_TEXT = 'Inbox Curator: Review failed';

export default class InboxCuratorPlugin extends Plugin {
  settings: InboxCuratorSettings = DEFAULT_SETTINGS;
  private reviewInProgress = false;
  private reviewStatusBarEl!: HTMLElement;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.reviewStatusBarEl = this.addStatusBarItem();
    this.setReviewStatusIdle();
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

  private setReviewStatusIdle(): void {
    this.reviewStatusBarEl.textContent = '';
    this.reviewStatusBarEl.style.display = 'none';
  }

  private setReviewStatusReviewing(): void {
    this.reviewStatusBarEl.textContent = REVIEWING_STATUS_TEXT;
    this.reviewStatusBarEl.style.display = '';
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
    if (this.reviewInProgress) {
      new Notice(REVIEW_IN_PROGRESS_NOTICE_TEXT);
      return;
    }

    this.reviewInProgress = true;
    this.setReviewStatusReviewing();
    new Notice(REVIEWING_NOTICE_TEXT);

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
      this.reviewInProgress = false;
      this.setReviewStatusIdle();
    }
  }
}
