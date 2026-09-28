import { App, Modal, Setting } from 'obsidian';
import { t } from './i18n';

abstract class DiagnosticModalBase extends Modal {
  private confirmed = false;

  constructor(
    app: App,
    private readonly title: string,
    private readonly lines: string[],
    private readonly confirmText: string,
    private readonly cancelText: string,
    private readonly onConfirm: () => void,
    private readonly onCancel: () => void,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl('h3', { text: this.title });
    for (const line of this.lines) {
      contentEl.createEl('p', { text: line });
    }

    new Setting(contentEl)
      .addButton((btn) =>
        btn
          .setButtonText(this.confirmText)
          .setCta()
          .onClick(() => {
            this.confirmed = true;
            this.close();
            this.onConfirm();
          }),
      )
      .addButton((btn) => btn.setButtonText(this.cancelText).onClick(() => this.close()));
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.confirmed) {
      this.onCancel();
    }
  }
}

export class DiagnosticCaptureConsentModal extends DiagnosticModalBase {
  constructor(app: App, diagnosticFolder: string, cleanupCommand: string, onConfirm: () => void, onCancel: () => void) {
    super(
      app,
      t('modal.diagnostic.title'),
      [
        t('modal.diagnostic.body.noteContents'),
        t('modal.diagnostic.body.folder', { folder: diagnosticFolder }),
        t('modal.diagnostic.body.masking'),
        t('modal.diagnostic.body.delete', { command: cleanupCommand }),
      ],
      t('modal.diagnostic.confirm'),
      t('modal.diagnostic.cancel'),
      onConfirm,
      onCancel,
    );
  }
}

export class DiagnosticCleanupConfirmModal extends DiagnosticModalBase {
  constructor(app: App, fileCount: number, onConfirm: () => void, onCancel: () => void) {
    super(
      app,
      t('modal.diagnosticCleanup.title'),
      [t('modal.diagnosticCleanup.body', { count: fileCount })],
      t('modal.diagnosticCleanup.confirm'),
      t('modal.diagnosticCleanup.cancel'),
      onConfirm,
      onCancel,
    );
  }
}
