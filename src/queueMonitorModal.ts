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
const FOCUS_ATTR = 'data-queue-focus';
const LIST_ATTR = 'data-queue-list';

interface QueueViewState {
  scrollTop: number;
  focusedKey: string | null;
  hadFocus: boolean;
  listScroll: Map<string, number>;
}

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
 *
 * The view refreshes on a timer, but a rebuild only happens when the queue
 * state actually changes. When it does rebuild, scroll position and keyboard
 * focus are preserved; if the focused action disappears (a cancelled or
 * finished row), focus moves to a remaining safe control so keyboard
 * navigation is not dropped.
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

  private buildSignature(snapshot: ReviewQueueSnapshot): string {
    return JSON.stringify({
      paused: snapshot.paused,
      pending: snapshot.pendingJobs.map((job) => job.id),
      running: snapshot.runningJobs.map((job) => job.id),
      failed: snapshot.failedJobs.map((job) => `${job.notePath}:${job.reasonCode}:${job.timestamp}`),
    });
  }

  private render(): void {
    const snapshot = this.callbacks.getSnapshot();
    const signature = this.buildSignature(snapshot);
    if (signature === this.lastSignature) {
      return;
    }
    this.lastSignature = signature;

    const viewState = this.captureViewState();
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('inbox-curator-queue-monitor');
    contentEl.tabIndex = -1;

    this.renderHeader(snapshot);
    this.renderBody(snapshot);

    this.restoreViewState(viewState);
  }

  private renderHeader(snapshot: ReviewQueueSnapshot): void {
    const { contentEl } = this;
    contentEl.createEl('h3', { text: t('queue.title') });
    contentEl.createEl('p', { text: t('queue.desc'), cls: 'setting-item-description' });

    const summary = contentEl.createDiv({ cls: 'inbox-curator-queue-summary' });
    this.createBadge(summary, t('queue.badge.pending'), snapshot.pending);
    this.createBadge(summary, t('queue.badge.running'), snapshot.running);
    this.createBadge(
      summary,
      t('queue.badge.failed'),
      snapshot.failedJobs.length,
      snapshot.failedJobs.length > 0 ? 'is-failed' : undefined,
    );
    if (snapshot.paused) {
      this.createBadge(summary, t('queue.badge.paused'), undefined, 'is-paused');
    }
    summary.createEl('span', {
      text: t('queue.maxConcurrency', { max: snapshot.maxConcurrentJobs }),
      cls: 'inbox-curator-queue-max',
    });

    if (snapshot.paused) {
      const paused = contentEl.createDiv({ cls: 'inbox-curator-queue-paused' });
      paused.createEl('p', { text: t('queue.paused') });
      paused.createEl('p', { text: t('queue.pausedDetail') });
    }

    const controls = new Setting(contentEl);
    if (snapshot.paused) {
      controls.addButton((btn) => {
        btn
          .setButtonText(t('queue.button.resume'))
          .setCta()
          .onClick(() => {
            this.callbacks.resume();
            this.render();
          });
        btn.buttonEl?.setAttribute(FOCUS_ATTR, 'resume');
      });
    } else {
      controls.addButton((btn) => {
        btn.setButtonText(t('queue.button.pause')).onClick(() => {
          this.callbacks.pause();
          this.render();
        });
        btn.buttonEl?.setAttribute(FOCUS_ATTR, 'pause');
      });
    }
    controls.addButton((btn) => {
      btn.setButtonText(t('queue.button.refresh')).onClick(() => this.render());
      btn.buttonEl?.setAttribute(FOCUS_ATTR, 'refresh');
    });
  }

  private createBadge(parent: HTMLElement, label: string, count?: number, modifier?: string): void {
    const badge = parent.createEl('span', { cls: 'inbox-curator-queue-badge' });
    if (modifier) {
      badge.addClass(modifier);
    }
    badge.createEl('span', { text: label, cls: 'inbox-curator-queue-badge-label' });
    if (typeof count === 'number') {
      badge.createEl('span', { text: String(count), cls: 'inbox-curator-queue-badge-count' });
    }
  }

  private renderBody(snapshot: ReviewQueueSnapshot): void {
    const hasAny = snapshot.pending > 0 || snapshot.running > 0 || snapshot.failedJobs.length > 0;
    if (!hasAny) {
      this.contentEl.createEl('p', { text: t('queue.emptyAll'), cls: 'inbox-curator-queue-empty' });
      return;
    }

    if (snapshot.running > 0) {
      this.renderRunning(snapshot);
    }
    if (snapshot.pending > 0) {
      this.renderPending(snapshot);
    }
    if (snapshot.failedJobs.length > 0) {
      this.renderFailed(snapshot);
    }
  }

  private createSection(label: string, count: number): HTMLElement {
    const section = this.contentEl.createDiv({ cls: 'inbox-curator-queue-section' });
    const header = section.createEl('h4', { cls: 'inbox-curator-queue-section-title' });
    header.createEl('span', { text: label, cls: 'inbox-curator-queue-section-label' });
    header.createEl('span', { text: String(count), cls: 'inbox-curator-queue-section-count' });
    return section;
  }

  private renderRunning(snapshot: ReviewQueueSnapshot): void {
    const section = this.createSection(t('queue.section.running'), snapshot.runningJobs.length);
    section.createEl('p', { text: t('queue.runningHint'), cls: 'inbox-curator-queue-hint' });
    const list = section.createDiv({ cls: 'inbox-curator-queue-list' });
    list.setAttribute(LIST_ATTR, 'running');
    for (const job of snapshot.runningJobs) {
      const row = list.createDiv({ cls: 'inbox-curator-queue-row' });
      row.createEl('span', {
        text: this.fileLabel(job.notePath),
        title: job.notePath,
        cls: 'inbox-curator-queue-row-name',
      });
    }
  }

  private renderPending(snapshot: ReviewQueueSnapshot): void {
    const section = this.createSection(t('queue.section.pending'), snapshot.pendingJobs.length);
    const list = section.createDiv({ cls: 'inbox-curator-queue-list' });
    list.setAttribute(LIST_ATTR, 'pending');
    for (const job of snapshot.pendingJobs) {
      const row = list.createDiv({ cls: 'inbox-curator-queue-row' });
      row.createEl('span', {
        text: this.fileLabel(job.notePath),
        title: job.notePath,
        cls: 'inbox-curator-queue-row-name',
      });
      const actions = row.createDiv({ cls: 'inbox-curator-queue-actions' });
      const button = actions.createEl('button', { text: t('queue.button.cancel') });
      button.setAttribute(FOCUS_ATTR, `cancel:${job.id}`);
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
    const section = this.createSection(t('queue.section.failed'), snapshot.failedJobs.length);
    section.createEl('p', { text: t('queue.retryHint'), cls: 'inbox-curator-queue-hint' });
    const list = section.createDiv({ cls: 'inbox-curator-queue-list' });
    list.setAttribute(LIST_ATTR, 'failed');
    for (const job of snapshot.failedJobs) {
      this.renderFailedRow(list, job);
    }
    section.createEl('p', { text: t('queue.failureDetailHint'), cls: 'inbox-curator-queue-hint' });
  }

  private renderFailedRow(list: HTMLElement, job: QueueFailedJob): void {
    const row = list.createDiv({ cls: 'inbox-curator-queue-row' });
    const info = row.createDiv({ cls: 'inbox-curator-queue-failure' });
    info.createEl('span', {
      text: this.fileLabel(job.notePath),
      title: job.notePath,
      cls: 'inbox-curator-queue-row-name',
    });
    info.createEl('span', { text: this.failureLabel(job.reasonCode), cls: 'inbox-curator-queue-reason' });

    const actions = row.createDiv({ cls: 'inbox-curator-queue-actions' });
    const button = actions.createEl('button', { text: t('queue.button.retry') });
    button.setAttribute(FOCUS_ATTR, `retry:${job.notePath}`);
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

  private captureViewState(): QueueViewState {
    const active = this.contentEl.ownerDocument.activeElement as HTMLElement | null;
    const hadFocus = active !== null && this.contentEl.contains(active);
    const focusedKey = hadFocus ? active?.getAttribute(FOCUS_ATTR) ?? null : null;

    const listScroll = new Map<string, number>();
    this.contentEl.querySelectorAll<HTMLElement>(`[${LIST_ATTR}]`).forEach((el) => {
      const key = el.getAttribute(LIST_ATTR);
      if (key) {
        listScroll.set(key, el.scrollTop);
      }
    });

    return { scrollTop: this.contentEl.scrollTop, focusedKey, hadFocus, listScroll };
  }

  private restoreViewState(state: QueueViewState): void {
    this.contentEl.scrollTop = state.scrollTop;
    for (const [key, value] of state.listScroll) {
      const el = this.findByAttribute(LIST_ATTR, key);
      if (el) {
        el.scrollTop = value;
      }
    }

    if (!state.hadFocus) {
      return;
    }

    const target = state.focusedKey ? this.findByAttribute(FOCUS_ATTR, state.focusedKey) : null;
    if (target) {
      target.focus({ preventScroll: true });
      return;
    }

    // The focused row disappeared (cancelled, retried, or finished). Move focus
    // to a remaining safe control so keyboard navigation does not stop.
    const fallback = this.findFallbackFocusTarget();
    if (fallback) {
      fallback.focus({ preventScroll: true });
      return;
    }

    // Keep focus inside the modal even when every action row vanished.
    this.contentEl.focus({ preventScroll: true });
  }

  private findByAttribute(attribute: string, value: string): HTMLElement | null {
    const elements = this.contentEl.querySelectorAll<HTMLElement>(`[${attribute}]`);
    for (const element of Array.from(elements)) {
      if (element.getAttribute(attribute) === value) {
        return element;
      }
    }
    return null;
  }

  private findFallbackFocusTarget(): HTMLElement | null {
    for (const key of ['resume', 'pause', 'refresh']) {
      const target = this.findByAttribute(FOCUS_ATTR, key);
      if (target) {
        return target;
      }
    }

    return (
      this.contentEl.querySelector<HTMLElement>(`[${FOCUS_ATTR}^="cancel:"]`) ??
      this.contentEl.querySelector<HTMLElement>(`[${FOCUS_ATTR}^="retry:"]`)
    );
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
