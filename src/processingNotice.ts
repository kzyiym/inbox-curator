import { Notice } from 'obsidian';

export class ProcessingNoticeManager {
  private activeNotice: Notice | null = null;
  private currentMessage = '';
  private statusBarEl: HTMLElement | null = null;

  setStatusBarElement(el: HTMLElement): void {
    this.statusBarEl = el;
    this.statusBarEl.empty();
  }

  show(message: string): void {
    if (this.currentMessage === message) return;
    this.currentMessage = message;

    if (this.statusBarEl) {
      this.statusBarEl.setText(message);
    } else {
      if (this.activeNotice) {
        this.activeNotice.setMessage(message);
      } else {
        this.activeNotice = new Notice(message, 0);
      }
    }
  }

  update(message: string): void {
    this.show(message);
  }

  clear(): void {
    this.activeNotice?.hide();
    this.activeNotice = null;
    this.currentMessage = '';
    if (this.statusBarEl) {
      this.statusBarEl.empty();
    }
  }
}
