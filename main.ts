import { MarkdownView, Notice, Plugin, TFile } from 'obsidian';
import { registerInboxCuratorCommands } from './src/commands';
import { buildDummyReviewResult } from './src/dummyReview';
import { upsertReviewFrontmatter } from './src/frontmatter';
import { writeReviewNote } from './src/reviewWriter';
import { DEFAULT_SETTINGS, InboxCuratorSettings, InboxCuratorSettingTab } from './src/settings';

export default class InboxCuratorPlugin extends Plugin {
  settings: InboxCuratorSettings = DEFAULT_SETTINGS;

  async onload(): Promise<void> {
    await this.loadSettings();
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
    });
  }

  async createDummyReviewForActiveFile(): Promise<void> {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const file = view?.file;

    if (!(file instanceof TFile) || file.extension !== 'md') {
      new Notice('Open a Markdown note first.');
      return;
    }

    await this.createDummyReviewForFile(file);
  }

  async createDummyReviewForFile(file: TFile): Promise<void> {
    const reviewResult = buildDummyReviewResult(file, this.settings.reviewOutputFolder);
    const writeResult = await writeReviewNote(this.app, file, reviewResult);
    await upsertReviewFrontmatter(this.app, file, reviewResult);

    new Notice(`Review note ${writeResult.created ? 'created' : 'updated'}: ${writeResult.outputPath}`);
  }
}
