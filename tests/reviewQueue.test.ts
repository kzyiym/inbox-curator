import { describe, expect, it } from 'vitest';
import { createReviewJob } from '../src/queue/job';
import { ReviewQueue } from '../src/queue/reviewQueue';
import type { ReviewJob, ReviewJobResult } from '../src/queue/queueTypes';

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

    const first = queue.enqueue(createReviewJob('watched-folder-manual', 'Inbox/a.md'));
    const second = queue.enqueue(createReviewJob('watched-folder-manual', 'Inbox/b.md'));
    const third = queue.enqueue(createReviewJob('watched-folder-manual', 'Inbox/c.md'));

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

    const first = queue.enqueue(createReviewJob('watched-folder-manual', 'Inbox/same.md'));
    await Promise.resolve();
    await Promise.resolve();
    const duplicate = queue.enqueue(createReviewJob('watched-folder-manual', 'Inbox/same.md'));

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

    const first = queue.enqueue(createReviewJob('watched-folder-manual', 'Inbox/one.md'));
    const second = queue.enqueue(createReviewJob('watched-folder-manual', 'Inbox/two.md'));

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
});
