import { describe, expect, it } from 'vitest';
import { createReviewJob } from '../src/queue/job';
import { ReviewQueue } from '../src/queue/reviewQueue';
import type { ReviewJob, ReviewJobResult, ReviewQueueLogCallback } from '../src/queue/queueTypes';

function createControlledProcessor() {
  let activeCount = 0;
  let peakActiveCount = 0;
  const startedJobs: string[] = [];
  const waiting = new Map<string, () => void>();
  const completions = new Map<string, Promise<void>>();
  const resolvers = new Map<string, () => void>();

  const processor = async (job: ReviewJob): Promise<ReviewJobResult> => {
    activeCount += 1;
    peakActiveCount = Math.max(peakActiveCount, activeCount);
    startedJobs.push(job.notePath);

    const completion = new Promise<void>((resolve) => {
      resolvers.set(job.notePath, resolve);
    });
    completions.set(job.notePath, completion);
    waiting.set(job.notePath, () => resolvers.get(job.notePath)?.());

    await completion;
    activeCount -= 1;
    return { status: 'processed' };
  };

  return {
    processor,
    getActiveCount: () => activeCount,
    getPeakActiveCount: () => peakActiveCount,
    getStartedJobs: () => [...startedJobs],
    release(notePath: string) {
      const release = waiting.get(notePath);
      if (!release) {
        throw new Error(`No waiting job for ${notePath}`);
      }
      release();
      waiting.delete(notePath);
    },
  };
}

describe('ReviewQueue bounded parallelism', () => {
  it('runs at most 2 jobs concurrently and waits for a free slot before starting the third job', async () => {
    const controlled = createControlledProcessor();
    const queue = new ReviewQueue(controlled.processor, { maxConcurrentJobs: 2 });

    const first = queue.enqueue(createReviewJob('manual-folder', 'Inbox/a.md'));
    const second = queue.enqueue(createReviewJob('manual-folder', 'Inbox/b.md'));
    const third = queue.enqueue(createReviewJob('manual-folder', 'Inbox/c.md'));

    await Promise.resolve();
    await Promise.resolve();

    expect(first.accepted).toBe(true);
    expect(second.accepted).toBe(true);
    expect(third.accepted).toBe(true);
    expect(controlled.getStartedJobs()).toEqual(['Inbox/a.md', 'Inbox/b.md']);
    expect(controlled.getPeakActiveCount()).toBe(2);
    expect(queue.getSnapshot().running).toBe(2);
    expect(queue.getSnapshot().pending).toBe(1);

    controlled.release('Inbox/a.md');
    await first.promise;
    await Promise.resolve();
    await Promise.resolve();

    expect(controlled.getStartedJobs()).toEqual(['Inbox/a.md', 'Inbox/b.md', 'Inbox/c.md']);
    expect(controlled.getPeakActiveCount()).toBe(2);

    controlled.release('Inbox/b.md');
    controlled.release('Inbox/c.md');
    await Promise.all([second.promise, third.promise]);
  });

  it('rejects duplicate same-path enqueue while a job is already running', async () => {
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const queue = new ReviewQueue(async () => {
      calls += 1;
      await gate;
      return { status: 'processed' };
    }, { maxConcurrentJobs: 2 });

    const first = queue.enqueue(createReviewJob('manual-folder', 'Inbox/same.md'));
    await Promise.resolve();
    await Promise.resolve();
    const duplicate = queue.enqueue(createReviewJob('manual-folder', 'Inbox/same.md'));

    expect(first.accepted).toBe(true);
    expect(duplicate.accepted).toBe(false);
    expect(duplicate.duplicate).toBe(true);

    release();
    await first.promise;
    await duplicate.promise;
    expect(calls).toBe(1);
  });

  it('updates snapshot capacity and allows raising concurrency at runtime', async () => {
    let activeCount = 0;
    let peakActiveCount = 0;
    const resolvers = new Map<string, () => void>();

    const queue = new ReviewQueue(async (job) => {
      activeCount += 1;
      peakActiveCount = Math.max(peakActiveCount, activeCount);
      await new Promise<void>((resolve) => {
        resolvers.set(job.notePath, resolve);
      });
      activeCount -= 1;
      return { status: 'processed' };
    }, { maxConcurrentJobs: 1 });

    const first = queue.enqueue(createReviewJob('manual-folder', 'Inbox/one.md'));
    const second = queue.enqueue(createReviewJob('manual-folder', 'Inbox/two.md'));

    await Promise.resolve();
    await Promise.resolve();

    expect(queue.getSnapshot()).toMatchObject({
      running: 1,
      pending: 1,
      maxConcurrentJobs: 1,
      availableSlots: 0,
    });

    queue.setMaxConcurrentJobs(2);
    await Promise.resolve();
    await Promise.resolve();

    expect(queue.getSnapshot()).toMatchObject({
      running: 2,
      pending: 0,
      maxConcurrentJobs: 2,
      availableSlots: 0,
    });
    expect(peakActiveCount).toBe(2);

    resolvers.get('Inbox/one.md')?.();
    resolvers.get('Inbox/two.md')?.();
    await Promise.all([first.promise, second.promise]);
  });

  it('pauses and resumes queue execution', async () => {
    const controlled = createControlledProcessor();
    const queue = new ReviewQueue(controlled.processor, { maxConcurrentJobs: 2 });

    // 1. Enqueue two jobs (they start immediately because maxConcurrentJobs = 2)
    const first = queue.enqueue(createReviewJob('manual-folder', 'Inbox/a.md'));
    const second = queue.enqueue(createReviewJob('manual-folder', 'Inbox/b.md'));
    await Promise.resolve();

    expect(queue.getSnapshot().running).toBe(2);
    expect(queue.getSnapshot().paused).toBe(false);

    // 2. Pause the queue and enqueue a third job
    queue.pause();
    expect(queue.getSnapshot().paused).toBe(true);

    const third = queue.enqueue(createReviewJob('manual-folder', 'Inbox/c.md'));
    await Promise.resolve();

    // The third job remains pending because the queue is paused
    expect(queue.getSnapshot().pending).toBe(1);
    expect(queue.getSnapshot().running).toBe(2);
    expect(controlled.getStartedJobs()).toEqual(['Inbox/a.md', 'Inbox/b.md']);

    // 3. Release first job; it should complete, but the third job still should not start
    controlled.release('Inbox/a.md');
    await first.promise;
    await Promise.resolve();

    expect(queue.getSnapshot().running).toBe(1); // Only b.md running
    expect(queue.getSnapshot().pending).toBe(1); // c.md still pending
    expect(controlled.getStartedJobs()).toEqual(['Inbox/a.md', 'Inbox/b.md']);

    // 4. Resume the queue; the third job should start immediately
    queue.resume();
    expect(queue.getSnapshot().paused).toBe(false);
    await Promise.resolve();

    expect(queue.getSnapshot().running).toBe(2); // b.md and c.md running
    expect(queue.getSnapshot().pending).toBe(0);
    expect(controlled.getStartedJobs()).toEqual(['Inbox/a.md', 'Inbox/b.md', 'Inbox/c.md']);

    controlled.release('Inbox/b.md');
    controlled.release('Inbox/c.md');
    await Promise.all([second.promise, third.promise]);
  });

  it('cancels pending and running jobs', async () => {
    const controlled = createControlledProcessor();
    const queue = new ReviewQueue(controlled.processor, { maxConcurrentJobs: 1 });

    const firstJob = createReviewJob('manual-folder', 'Inbox/first.md');
    const secondJob = createReviewJob('manual-folder', 'Inbox/second.md');

    const first = queue.enqueue(firstJob);
    const second = queue.enqueue(secondJob);
    await Promise.resolve();

    expect(queue.getSnapshot().running).toBe(1);
    expect(queue.getSnapshot().pending).toBe(1);

    // 1. Cancel the pending job
    const cancelledPending = queue.cancelJob(secondJob.id);
    expect(cancelledPending).toBe(true);

    const secondResult = await second.promise;
    expect(secondResult.status).toBe('cancelled');
    expect(queue.getSnapshot().pending).toBe(0);

    // 2. Cancel the running job
    const cancelledRunning = queue.cancelJob(firstJob.id);
    expect(cancelledRunning).toBe(true); // Should mark it as cancelled

    // Release the running job
    controlled.release('Inbox/first.md');
    const firstResult = await first.promise;
    expect(firstResult.status).toBe('cancelled'); // Result overridden to cancelled
    expect(queue.getSnapshot().running).toBe(0);
  });

  it('cancels all pending jobs via cancelPendingJobs', async () => {
    const controlled = createControlledProcessor();
    const queue = new ReviewQueue(controlled.processor, { maxConcurrentJobs: 1 });

    const first = queue.enqueue(createReviewJob('manual-folder', 'Inbox/first.md'));
    const second = queue.enqueue(createReviewJob('manual-folder', 'Inbox/second.md'));
    const third = queue.enqueue(createReviewJob('manual-folder', 'Inbox/third.md'));
    await Promise.resolve();

    expect(queue.getSnapshot().running).toBe(1);
    expect(queue.getSnapshot().pending).toBe(2);

    queue.cancelPendingJobs();

    const secondResult = await second.promise;
    const thirdResult = await third.promise;
    expect(secondResult.status).toBe('cancelled');
    expect(thirdResult.status).toBe('cancelled');

    expect(queue.getSnapshot().pending).toBe(0);
    expect(queue.getSnapshot().running).toBe(1);

    controlled.release('Inbox/first.md');
    const firstResult = await first.promise;
    expect(firstResult.status).toBe('processed'); // The running job completed normally
  });

  it('keeps execution and failure history with capped limit', async () => {
    const queue = new ReviewQueue(async (job) => {
      if (job.notePath.includes('fail')) {
        throw new Error('processing failure');
      }
      return { status: 'processed' };
    }, { maxConcurrentJobs: 5 });

    // Enqueue 55 jobs to exceed the max history size of 50
    const promises = [];
    for (let i = 0; i < 55; i++) {
      const path = i % 10 === 0 ? `Inbox/fail-${i}.md` : `Inbox/note-${i}.md`;
      const job = createReviewJob('manual-folder', path);
      promises.push(queue.enqueue(job).promise);
    }

    await Promise.all(promises);
    const snapshot = queue.getSnapshot();

    expect(snapshot.history.length).toBe(50); // Capped at 50
    expect(snapshot.processed).toBe(49); // 55 total, 6 fail, 49 processed
    expect(snapshot.failed).toBe(6);

    // Verify history structure and content
    const lastEntry = snapshot.history[snapshot.history.length - 1];
    expect(lastEntry).toHaveProperty('id');
    expect(lastEntry).toHaveProperty('notePath');
    expect(lastEntry).toHaveProperty('source');
    expect(lastEntry).toHaveProperty('status');
    expect(lastEntry).toHaveProperty('timestamp');

    // The first 5 jobs should have been shifted out
    const notePathsInHistory = snapshot.history.map(h => h.notePath);
    expect(notePathsInHistory).not.toContain('Inbox/note-0.md');
    expect(notePathsInHistory).not.toContain('Inbox/note-1.md');
    expect(notePathsInHistory).toContain('Inbox/note-54.md');
  });

  it('cleans up running/queued state even when processor throws', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let processorCalls = 0;

    const queue = new ReviewQueue(async (job) => {
      processorCalls += 1;
      await gate;
      throw new Error('processor crash');
    }, { maxConcurrentJobs: 1 });

    const result = queue.enqueue(createReviewJob('manual-folder', 'Inbox/crash.md'));
    await Promise.resolve();
    await Promise.resolve();

    expect(queue.getSnapshot().running).toBe(1);
    expect(queue.getSnapshot().failed).toBe(0);

    release!();
    const jobResult = await result.promise;

    expect(jobResult.status).toBe('failed');
    expect(queue.getSnapshot().running).toBe(0);
    expect(queue.getSnapshot().pending).toBe(0);
    expect(queue.getSnapshot().failed).toBe(1);
    // After cleanup, same path can be enqueued again
    const retry = queue.enqueue(createReviewJob('manual-folder', 'Inbox/crash.md'));
    expect(retry.accepted).toBe(true);
  });

  it('prevents new dispatch after stop()', async () => {
    const controlled = createControlledProcessor();
    const queue = new ReviewQueue(controlled.processor, { maxConcurrentJobs: 2 });

    const first = queue.enqueue(createReviewJob('manual-folder', 'Inbox/a.md'));
    await Promise.resolve();

    queue.stop();

    // No new jobs should be accepted after stop
    const rejected = queue.enqueue(createReviewJob('manual-folder', 'Inbox/b.md'));
    expect(rejected.accepted).toBe(false);

    // The running job still completes but its result is overridden to cancelled
    controlled.release('Inbox/a.md');
    const firstResult = await first.promise;
    expect(firstResult.status).toBe('cancelled');
    expect(queue.getSnapshot().running).toBe(0);
  });

  it('dedupes same notePath from different sources', async () => {
    const startedPaths: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });

    const queue = new ReviewQueue(async (job) => {
      startedPaths.push(job.notePath);
      await gate;
      return { status: 'processed' };
    }, { maxConcurrentJobs: 2 });

    const autoModify = queue.enqueue(createReviewJob('auto-create', 'Inbox/dup.md'));
    await Promise.resolve();
    await Promise.resolve();

    // Same path from different source should be rejected
    const poll = queue.enqueue(createReviewJob('polling', 'Inbox/dup.md'));
    expect(poll.accepted).toBe(false);

    release!();
    await autoModify.promise;
    expect(startedPaths).toEqual(['Inbox/dup.md']);
  });

  it('allows re-enqueueing a path after previous job completes', async () => {
    const executionOrder: string[] = [];
    const path = 'Inbox/sequential.md';
    let firstRelease!: () => void;
    let secondRelease!: () => void;

    const firstGate = new Promise<void>((resolve) => { firstRelease = resolve; });
    const secondGate = new Promise<void>((resolve) => { secondRelease = resolve; });
    let useSecondGate = false;

    const queue = new ReviewQueue(async (job) => {
      executionOrder.push(job.notePath);
      if (!useSecondGate) {
        await firstGate;
      } else {
        await secondGate;
      }
      return { status: 'processed' };
    }, { maxConcurrentJobs: 1 });

    const first = queue.enqueue(createReviewJob('manual-folder', path, 0));
    await Promise.resolve();
    await Promise.resolve();

    firstRelease!();
    await first.promise;
    await Promise.resolve();
    await Promise.resolve();

    // After completion, same path can be enqueued again
    useSecondGate = true;
    const second = queue.enqueue(createReviewJob('polling', path, 0));
    expect(second.accepted).toBe(true);
    await Promise.resolve();
    await Promise.resolve();

    secondRelease!();
    await second.promise;

    expect(executionOrder).toEqual([path, path]);
  });

  it('tracks job metadata (runId, startedAt, finishedAt)', async () => {
    let capturedJob: ReviewJob | undefined;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });

    const queue = new ReviewQueue(async (job) => {
      capturedJob = job;
      await gate;
      return { status: 'processed' };
    }, { maxConcurrentJobs: 1 });

    queue.enqueue(createReviewJob('manual-folder', 'Inbox/meta.md'));
    await Promise.resolve();
    await Promise.resolve();

    expect(capturedJob).toBeDefined();
    expect(capturedJob!.runId).toBeTruthy();
    expect(capturedJob!.startedAt).toBeGreaterThan(0);

    release!();
    // Wait for completion
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(capturedJob!.finishedAt).toBeGreaterThan(0);
    expect(capturedJob!.finishedAt!).toBeGreaterThanOrEqual(capturedJob!.startedAt!);
  });

  it('never exceeds maxConcurrentJobs even with rapid enqueue of distinct paths', async () => {
    const controlled = createControlledProcessor();
    const queue = new ReviewQueue(controlled.processor, { maxConcurrentJobs: 3 });

    const results = [];
    for (let i = 0; i < 10; i++) {
      results.push(queue.enqueue(createReviewJob('manual-folder', `Inbox/rapid-${i}.md`, 0)));
    }

    await Promise.resolve();
    await Promise.resolve();

    expect(controlled.getPeakActiveCount()).toBeLessThanOrEqual(3);
    expect(queue.getSnapshot().running).toBeLessThanOrEqual(3);

    // Release jobs one by one as drainQueue picks up remaining pending jobs
    for (let released = 0; released < 10; released++) {
      const started = controlled.getStartedJobs();
      const toRelease = started[released];
      if (toRelease) {
        controlled.release(toRelease);
        await Promise.resolve();
        await Promise.resolve();
      }
    }

    await Promise.all(results.map((r) => r.promise));
    expect(controlled.getPeakActiveCount()).toBeLessThanOrEqual(3);
  });

  it('detects invariant violation when maxConcurrentJobs is exceeded', () => {
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (msg: string) => { warnings.push(msg); };

    try {
      const queue = new ReviewQueue(async () => ({ status: 'processed' }), { maxConcurrentJobs: 2 });

      // Force-add extra running entries to exceed maxConcurrentJobs
      const fakeJob1 = createReviewJob('manual-folder', 'Inbox/fake1.md', 0);
      const fakeJob2 = createReviewJob('manual-folder', 'Inbox/fake2.md', 0);
      (queue as any).runningByPath.set('Inbox/fake1.md', fakeJob1);
      (queue as any).queuedOrRunningPaths.add('Inbox/fake1.md');
      (queue as any).runningByPath.set('Inbox/fake2.md', fakeJob2);
      (queue as any).queuedOrRunningPaths.add('Inbox/fake2.md');

      // Lower max concurrency - setMaxConcurrentJobs calls assertQueueInvariants
      queue.setMaxConcurrentJobs(1);

      const violationWarnings = warnings.filter((w) => w.includes('[ReviewQueue] invariant violation'));
      expect(violationWarnings.length).toBeGreaterThanOrEqual(1);
      expect(violationWarnings[0]).toContain('runningByPath');
    } finally {
      console.warn = originalWarn;
    }
  });

  it('logs queue events through onLog callback', async () => {
    const logEntries: any[] = [];
    const controlledEvents = createControlledProcessor();

    const queueWithLog = new ReviewQueue(controlledEvents.processor, {
      maxConcurrentJobs: 1,
      onLog: (entry) => { logEntries.push(entry); },
    });

    const result = queueWithLog.enqueue(createReviewJob('manual-folder', 'Inbox/log-test.md', 0));
    await Promise.resolve();
    await Promise.resolve();

    controlledEvents.release('Inbox/log-test.md');
    await result.promise;
    await Promise.resolve();
    await Promise.resolve();

    const events = logEntries.map((e) => e.event);
    expect(events).toContain('enqueue_accepted');
    expect(events).toContain('dispatch_started');
    expect(events).toContain('job_succeeded');
  });
});
