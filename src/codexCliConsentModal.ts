import { App, Modal, Setting } from 'obsidian';
import { t } from './i18n';

export class CodexCliConsentModal extends Modal {
  private confirmed = false;

  constructor(
    app: App,
    private readonly onConfirm: () => void,
    private readonly onCancel: () => void,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl('h3', { text: t('modal.codexCliConsent.title') });
    contentEl.createEl('p', { text: t('modal.codexCliConsent.body.readRisk') });
    contentEl.createEl('p', { text: t('modal.codexCliConsent.body.login') });
    contentEl.createEl('p', { text: t('modal.codexCliConsent.body.stdin') });
    contentEl.createEl('p', { text: t('modal.codexCliConsent.body.background') });

    new Setting(contentEl)
      .addButton((btn) =>
        btn
          .setButtonText(t('modal.codexCliConsent.confirm'))
          .setCta()
          .onClick(() => {
            this.confirmed = true;
            this.close();
            this.onConfirm();
          }),
      )
      .addButton((btn) => btn.setButtonText(t('modal.codexCliConsent.cancel')).onClick(() => this.close()));
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.confirmed) {
      this.onCancel();
    }
  }
}
