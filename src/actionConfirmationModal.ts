import { App, Modal, Setting } from 'obsidian';

export class ActionConfirmationModal extends Modal {
  private confirmed = false;

  constructor(
    app: App,
    private readonly message: string,
    private readonly onConfirm: () => void,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl('h3', { text: 'Inbox Curator: Confirm Action' });
    contentEl.createEl('p', { text: this.message });

    new Setting(contentEl)
      .addButton((btn) =>
        btn
          .setButtonText('Confirm')
          .setCta()
          .onClick(() => {
            this.confirmed = true;
            this.close();
            this.onConfirm();
          }),
      )
      .addButton((btn) =>
        btn.setButtonText('Cancel').onClick(() => {
          this.close();
        }));
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
  }
}
