import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueueMonitorModal, type QueueMonitorCallbacks } from '../src/queueMonitorModal';
import { createReviewJob } from '../src/queue/job';
import type { QueueFailedJob, ReviewQueueSnapshot } from '../src/queue/queueTypes';

function createSnapshot(overrides: Partial<ReviewQueueSnapshot> = {}): ReviewQueueSnapshot {
  return {
    pending: 0,
    running: 0,
    processed: 0,
    skipped: 0,
    failed: 0,
    cancelled: 0,
    stopping: false,
    maxConcurrentJobs: 1,
    availableSlots: 1,
    paused: false,
    pendingJobs: [],
    runningJobs: [],
    failedJobs: [],
    history: [],
    ...overrides,
  };
}

function createHarness(initial: ReviewQueueSnapshot) {
  let current = initial;
  const getSnapshot = vi.fn(() => current);
  const callbacks: QueueMonitorCallbacks = {
    getSnapshot,
    pause: vi.fn(),
    resume: vi.fn(),
    cancelPendingJob: vi.fn(() => true),
    retryFailed: vi.fn(async () => ({ accepted: true })),
  };

  return {
    callbacks,
    getSnapshot,
    setSnapshot: (next: ReviewQueueSnapshot) => {
      current = next;
    },
  };
}

function failedJob(notePath: string): QueueFailedJob {
  return { notePath, source: 'manual-folder', reasonCode: 'timeout', timestamp: 1 };
}

function forceRender(modal: QueueMonitorModal): void {
  (modal as unknown as { render: () => void }).render();
}

describe('QueueMonitorModal rendering', () => {
  let modal: QueueMonitorModal | null = null;

  afterEach(() => {
    if (modal) {
      modal.onClose();
      modal.contentEl.remove();
      modal = null;
    }
    vi.useRealTimers();
  });

  function open(initial: ReviewQueueSnapshot) {
    const harness = createHarness(initial);
    modal = new QueueMonitorModal({} as never, harness.callbacks);
    document.body.appendChild(modal.contentEl);
    modal.onOpen();
    return harness;
  }

  it('shows a single empty state and no sections when the queue is idle', () => {
    open(createSnapshot());

    expect(modal!.contentEl.querySelectorAll('.inbox-curator-queue-empty')).toHaveLength(1);
    expect(modal!.contentEl.querySelectorAll('.inbox-curator-queue-section')).toHaveLength(0);
    expect(modal!.contentEl.querySelectorAll('.inbox-curator-queue-row')).toHaveLength(0);
    expect(modal!.contentEl.querySelectorAll('.inbox-curator-queue-empty')[0].textContent).toBe('Queue is idle.');
  });

  it('renders only the sections that have items', () => {
    open(createSnapshot({ pending: 1, pendingJobs: [createReviewJob('manual-folder', 'Inbox/a.md')] }));

    const sections = modal!.contentEl.querySelectorAll('.inbox-curator-queue-section');
    expect(sections).toHaveLength(1);
    expect(sections[0].querySelector('.inbox-curator-queue-section-label')?.textContent).toBe('Pending');
  });

  it('lists failed notes with a classified reason and a retry button', () => {
    open(createSnapshot({ failed: 1, failedJobs: [failedJob('Inbox/f.md')] }));

    const section = modal!.contentEl.querySelector('.inbox-curator-queue-section');
    expect(section?.querySelector('.inbox-curator-queue-reason')?.textContent).toBe('Request timed out');
    expect(section?.querySelector('[data-queue-focus^="retry:"]')).not.toBeNull();
  });

  it('does not rebuild the DOM when the state is unchanged', () => {
    open(createSnapshot({ pending: 1, pendingJobs: [createReviewJob('manual-folder', 'Inbox/a.md')] }));

    const row = modal!.contentEl.querySelector('.inbox-curator-queue-row');
    forceRender(modal!);

    expect(modal!.contentEl.querySelector('.inbox-curator-queue-row')).toBe(row);
  });

  it('preserves scroll position and focus across a rebuild', () => {
    const first = createReviewJob('manual-folder', 'Inbox/a.md');
    const second = createReviewJob('manual-folder', 'Inbox/b.md');
    const harness = open(createSnapshot({ pending: 2, pendingJobs: [first, second] }));

    const cancelFirst = modal!.contentEl.querySelector<HTMLButtonElement>(`[data-queue-focus="cancel:${first.id}"]`);
    expect(cancelFirst).not.toBeNull();
    cancelFirst!.focus();
    modal!.contentEl.scrollTop = 40;

    harness.setSnapshot(
      createSnapshot({
        pending: 2,
        running: 1,
        pendingJobs: [first, second],
        runningJobs: [createReviewJob('manual-folder', 'Inbox/r.md')],
      }),
    );
    forceRender(modal!);

    const restored = modal!.contentEl.querySelector<HTMLButtonElement>(`[data-queue-focus="cancel:${first.id}"]`);
    expect(restored).not.toBeNull();
    expect(document.activeElement).toBe(restored);
    expect(modal!.contentEl.scrollTop).toBe(40);
  });

  it('moves focus to a safe control when the focused row disappears', () => {
    const job = createReviewJob('manual-folder', 'Inbox/a.md');
    const harness = open(createSnapshot({ pending: 1, pendingJobs: [job] }));

    const cancelButton = modal!.contentEl.querySelector<HTMLButtonElement>(`[data-queue-focus="cancel:${job.id}"]`);
    cancelButton!.focus();
    expect(document.activeElement).toBe(cancelButton);

    harness.setSnapshot(createSnapshot({ running: 1, runningJobs: [createReviewJob('manual-folder', 'Inbox/r.md')] }));
    forceRender(modal!);

    expect(modal!.contentEl.querySelectorAll('.inbox-curator-queue-row')).toHaveLength(1);
    expect(document.activeElement).not.toBeNull();
    expect(modal!.contentEl.contains(document.activeElement)).toBe(true);
  });

  it('stops refreshing after the modal is closed', () => {
    vi.useFakeTimers();
    const harness = createHarness(createSnapshot());
    modal = new QueueMonitorModal({} as never, harness.callbacks);
    document.body.appendChild(modal.contentEl);
    modal.onOpen();

    expect(harness.getSnapshot).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(3000);
    expect(harness.getSnapshot).toHaveBeenCalledTimes(4);

    modal.onClose();
    const callsAfterClose = harness.getSnapshot.mock.calls.length;
    vi.advanceTimersByTime(3000);
    expect(harness.getSnapshot.mock.calls.length).toBe(callsAfterClose);
  });
});
