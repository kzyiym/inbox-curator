import { MarkdownView, Notice, Plugin, TFile } from 'obsidian';
import { registerInboxCuratorCommands } from './src/commands';
import { runReviewPipeline } from './src/reviewPipeline';
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
      provider: this.settings.provider,
      endpointUrl: this.settings.endpointUrl,
      model: this.settings.model,
    });
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
    try {
      const result = await runReviewPipeline(this.app, file, {
        outputFolder: this.settings.reviewOutputFolder,
        provider: this.settings.provider,
        endpointUrl: this.settings.endpointUrl,
        model: this.settings.model,
      });

      if (result.ok === false) {
        new Notice(`Review failed: ${result.error}`);
        return;
      }

      new Notice(`Review note ${result.writeResult.created ? 'created' : 'updated'}: ${result.writeResult.outputPath}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      new Notice(`Review failed: ${message}`);
    }
  }
}
