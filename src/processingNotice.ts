import { Notice } from 'obsidian';

export class ProcessingNoticeManager {
  private activeNotice: Notice | null = null;
  private currentMessage = '';

  show(message: string): void {
    if (this.activeNotice) {
      this.update(message);
      return;
    }

    this.activeNotice = new Notice(message, 0);
    this.currentMessage = message;
  }

  update(message: string): void {
    if (!this.activeNotice) {
      this.show(message);
      return;
    }

    if (this.currentMessage === message) {
      return;
    }

    this.activeNotice.setMessage(message);
    this.currentMessage = message;
  }

  clear(): void {
    this.activeNotice?.hide();
    this.activeNotice = null;
    this.currentMessage = '';
  }
}
