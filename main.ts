import { MarkdownView, Notice, Plugin, TFile } from 'obsidian';
import { registerInboxCuratorCommands } from './src/commands';
import { upsertReviewFrontmatter } from './src/frontmatter';
import { ensureReviewNoteForFile } from './src/reviewWriter';
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
    const result = await ensureReviewNoteForFile(this.app, file, this.settings.reviewOutputFolder);

    await upsertReviewFrontmatter(this.app, file, {
      outputPath: result.outputPath,
      contentType: 'plain_note',
      recommendedAction: 'keep_as_reference',
      priority: 'medium',
      needsVerification: false,
      sourceHash: `dummy:${file.stat.mtime}:${file.stat.size}`,
    });

    new Notice(`Review note ${result.created ? 'created' : 'updated'}: ${result.outputPath}`);
  }
}
