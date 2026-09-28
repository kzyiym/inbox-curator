import { App, Modal, Setting } from 'obsidian';
import { t } from './i18n';

export interface DeleteCandidateBatchModalItem {
  notePath: string;
  destinationFolder: string;
}

export class DeleteCandidateBatchConfirmModal extends Modal {
  private confirmed = false;

  constructor(
    app: App,
    private readonly items: DeleteCandidateBatchModalItem[],
    private readonly onConfirm: () => void,
    private readonly onCancel: () => void,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl('h3', { text: t('modal.deleteCandidateBatch.title') });
    contentEl.createEl('p', { text: t('modal.deleteCandidateBatch.message', { count: this.items.length }) });

    const list = contentEl.createEl('ul', { cls: 'inbox-curator-delete-candidate-list' });
    for (const item of this.items) {
      list.createEl('li', {
        text: t('modal.deleteCandidateBatch.item', { note: item.notePath, folder: item.destinationFolder }),
      });
    }

    new Setting(contentEl)
      .addButton((btn) =>
        btn
          .setButtonText(t('modal.deleteCandidateBatch.confirm'))
          .setCta()
          .onClick(() => {
            this.confirmed = true;
            this.close();
            this.onConfirm();
          }),
      )
      .addButton((btn) =>
        btn.setButtonText(t('modal.deleteCandidateBatch.cancel')).onClick(() => {
          this.close();
        }),
      );
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.confirmed) {
      this.onCancel();
    }
  }
}
