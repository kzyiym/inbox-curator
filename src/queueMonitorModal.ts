import { App, Modal, Notice, Setting } from 'obsidian';
import { t, type TranslationKey } from './i18n';
import type { QueueFailureReasonCode } from './queue/queueFailureReason';
import type {
  QueueFailedJob,
  ReviewJobSource,
  ReviewQueueSnapshot,
  ReviewRetryOutcome,
  ReviewRetrySkipReason,
} from './queue/queueTypes';

export interface QueueMonitorCallbacks {
  getSnapshot: () => ReviewQueueSnapshot;
  pause: () => void;
  resume: () => void;
  cancelPendingJob: (id: string) => boolean;
  retryFailed: (notePath: string, source: ReviewJobSource) => Promise<ReviewRetryOutcome>;
}

const REFRESH_INTERVAL_MS = 1000;

/**
 * Read-only view of the in-memory review queue plus a few safe controls.
 *
 * Running jobs are intentionally not cancellable here: their API request is
 * already in flight and cannot be aborted. Pausing only stops new jobs from
 * starting.
 *
 * Failure rows show a classified reason code rendered as a fixed localized
 * message. Raw error strings are never shown, so note content and provider
 * response fragments cannot leak into the UI; details stay in the logs.
 */
export class QueueMonitorModal extends Modal {
  private refreshTimer: number | null = null;
  private lastSignature = '';

  constructor(app: App, private readonly callbacks: QueueMonitorCallbacks) {
    super(app);
  }

  onOpen(): void {
    this.render();
    this.refreshTimer = window.setInterval(() => this.render(), REFRESH_INTERVAL_MS);
  }

  onClose(): void {
    if (this.refreshTimer !== null) {
      window.clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.contentEl.empty();
  }

  private render(): void {
    const snapshot = this.callbacks.getSnapshot();
    const signature = JSON.stringify({
      paused: snapshot.paused,
      pending: snapshot.pendingJobs.map((job) => job.id),
      running: snapshot.runningJobs.map((job) => job.id),
      failed: snapshot.failedJobs.map((job) => `${job.notePath}:${job.reasonCode}:${job.timestamp}`),
    });
    if (signature === this.lastSignature) {
      return;
    }
    this.lastSignature = signature;

    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('inbox-curator-queue-monitor');

    contentEl.createEl('h3', { text: t('queue.title') });
    contentEl.createEl('p', { text: t('queue.desc'), cls: 'setting-item-description' });
    contentEl.createEl('p', {
      text: t('queue.summary', {
        pending: snapshot.pending,
        running: snapshot.running,
        failed: snapshot.failedJobs.length,
        max: snapshot.maxConcurrentJobs,
      }),
      cls: 'inbox-curator-queue-summary',
    });

    if (snapshot.paused) {
      contentEl.createEl('p', { text: t('queue.paused'), cls: 'inbox-curator-queue-paused' });
      contentEl.createEl('p', { text: t('queue.pausedDetail'), cls: 'setting-item-description' });
    }

    const controls = new Setting(contentEl);
    if (snapshot.paused) {
      controls.addButton((btn) =>
        btn
          .setButtonText(t('queue.button.resume'))
          .setCta()
          .onClick(() => {
            this.callbacks.resume();
            this.render();
          }),
      );
    } else {
      controls.addButton((btn) =>
        btn.setButtonText(t('queue.button.pause')).onClick(() => {
          this.callbacks.pause();
          this.render();
        }),
      );
    }
    controls.addButton((btn) =>
      btn.setButtonText(t('queue.button.refresh')).onClick(() => this.render()),
    );

    this.renderRunning(snapshot);
    this.renderPending(snapshot);
    this.renderFailed(snapshot);
  }

  private renderRunning(snapshot: ReviewQueueSnapshot): void {
    this.contentEl.createEl('h4', { text: t('queue.section.running') });
    if (snapshot.runningJobs.length === 0) {
      this.contentEl.createEl('p', { text: t('queue.empty'), cls: 'setting-item-description' });
      return;
    }

    const list = this.contentEl.createEl('ul', { cls: 'inbox-curator-queue-list' });
    for (const job of snapshot.runningJobs) {
      list.createEl('li', { text: this.fileLabel(job.notePath), title: job.notePath });
    }
  }

  private renderPending(snapshot: ReviewQueueSnapshot): void {
    this.contentEl.createEl('h4', { text: t('queue.section.pending') });
    if (snapshot.pendingJobs.length === 0) {
      this.contentEl.createEl('p', { text: t('queue.empty'), cls: 'setting-item-description' });
      return;
    }

    for (const job of snapshot.pendingJobs) {
      const row = this.contentEl.createDiv({ cls: 'inbox-curator-queue-row' });
      row.createEl('span', { text: this.fileLabel(job.notePath), title: job.notePath });
      const button = row.createEl('button', { text: t('queue.button.cancel') });
      button.addEventListener('click', () => {
        const cancelled = this.callbacks.cancelPendingJob(job.id);
        if (!cancelled) {
          new Notice(t('queue.cancelFailed'));
        }
        this.render();
      });
    }
  }

  private renderFailed(snapshot: ReviewQueueSnapshot): void {
    this.contentEl.createEl('h4', { text: t('queue.section.failed') });
    if (snapshot.failedJobs.length === 0) {
      this.contentEl.createEl('p', { text: t('queue.empty'), cls: 'setting-item-description' });
      return;
    }

    this.contentEl.createEl('p', { text: t('queue.retryHint'), cls: 'setting-item-description' });
    for (const job of snapshot.failedJobs) {
      this.renderFailedRow(job);
    }
    this.contentEl.createEl('p', { text: t('queue.failureDetailHint'), cls: 'setting-item-description' });
  }

  private renderFailedRow(job: QueueFailedJob): void {
    const row = this.contentEl.createDiv({ cls: 'inbox-curator-queue-row' });
    const info = row.createDiv({ cls: 'inbox-curator-queue-failure' });
    info.createEl('span', { text: this.fileLabel(job.notePath), title: job.notePath });
    info.createEl('span', { text: this.failureLabel(job.reasonCode), cls: 'inbox-curator-meta-info' });

    const button = row.createEl('button', { text: t('queue.button.retry') });
    button.addEventListener('click', () => {
      void this.retry(job);
    });
  }

  private async retry(job: QueueFailedJob): Promise<void> {
    const outcome = await this.callbacks.retryFailed(job.notePath, job.source);
    if (outcome.accepted) {
      new Notice(t('queue.retryQueued', { name: this.fileLabel(job.notePath) }));
    } else {
      new Notice(t('queue.retrySkipped', { reason: this.retryReasonLabel(outcome.reason) }));
    }
    this.render();
  }

  private retryReasonLabel(reason: ReviewRetrySkipReason | undefined): string {
    if (!reason) {
      return t('queue.failure.unknown');
    }
    return t(`queue.retryReason.${reason}` as TranslationKey);
  }

  private failureLabel(code: QueueFailureReasonCode): string {
    return t(`queue.failure.${code}` as TranslationKey);
  }

  private fileLabel(path: string): string {
    const name = path.split('/').pop() ?? path;
    return name.replace(/^🤖\s*/, '');
  }
}
