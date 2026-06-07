import type {
  ReviewJob,
  ReviewJobProcessor,
  ReviewJobResult,
  ReviewQueueEnqueueResult,
  ReviewQueueSnapshot,
} from './queueTypes';

interface InternalQueueEntry {
  job: ReviewJob;
  promise: Promise<ReviewJobResult>;
  resolve: (result: ReviewJobResult) => void;
}

export class ReviewQueue {
  private readonly pendingEntries: InternalQueueEntry[] = [];
  private readonly pendingByPath = new Map<string, InternalQueueEntry>();
  private readonly runningByPath = new Map<string, ReviewJob>();
  private processedCount = 0;
  private skippedCount = 0;
  private failedCount = 0;
  private cancelledCount = 0;
  private draining = false;
  private stopping = false;

  constructor(private readonly processor: ReviewJobProcessor) {}

  enqueue(job: ReviewJob): ReviewQueueEnqueueResult {
    const existingPending = this.pendingByPath.get(job.notePath);
    if (existingPending) {
      return { accepted: false, duplicate: true, promise: existingPending.promise };
    }

    const runningJob = this.runningByPath.get(job.notePath);
    if (runningJob) {
      return { accepted: false, duplicate: true, promise: Promise.resolve({ status: 'cancelled' }) };
    }

    if (this.stopping) {
      return { accepted: false, duplicate: false, promise: Promise.resolve({ status: 'cancelled' }) };
    }

    let resolve!: (result: ReviewJobResult) => void;
    const promise = new Promise<ReviewJobResult>((innerResolve) => {
      resolve = innerResolve;
    });

    const entry: InternalQueueEntry = { job, promise, resolve };
    this.pendingEntries.push(entry);
    this.pendingByPath.set(job.notePath, entry);
    void this.drainQueue();

    return { accepted: true, duplicate: false, promise };
  }

  getSnapshot(): ReviewQueueSnapshot {
    return {
      pending: this.pendingEntries.length,
      running: this.runningByPath.size,
      processed: this.processedCount,
      skipped: this.skippedCount,
      failed: this.failedCount,
      cancelled: this.cancelledCount,
      stopping: this.stopping,
    };
  }

  stop(): void {
    if (this.stopping) {
      return;
    }

    this.stopping = true;
    while (this.pendingEntries.length > 0) {
      const entry = this.pendingEntries.shift();
      if (!entry) {
        continue;
      }

      this.pendingByPath.delete(entry.job.notePath);
      this.cancelledCount += 1;
      entry.resolve({ status: 'cancelled' });
    }
  }

  private async drainQueue(): Promise<void> {
    if (this.draining || this.stopping) {
      return;
    }

    this.draining = true;
    try {
      while (!this.stopping) {
        const entry = this.pendingEntries.shift();
        if (!entry) {
          break;
        }

        this.pendingByPath.delete(entry.job.notePath);
        this.runningByPath.set(entry.job.notePath, entry.job);

        let result: ReviewJobResult;
        try {
          result = await this.processor(entry.job);
        } catch (error) {
          result = {
            status: 'failed',
            error: error instanceof Error ? error.message : 'Unknown error',
          };
        }

        this.runningByPath.delete(entry.job.notePath);
        this.recordResult(result);
        entry.resolve(result);
      }
    } finally {
      this.draining = false;
    }
  }

  private recordResult(result: ReviewJobResult): void {
    if (result.status === 'processed') {
      this.processedCount += 1;
      return;
    }

    if (result.status === 'skipped') {
      this.skippedCount += 1;
      return;
    }

    if (result.status === 'cancelled') {
      this.cancelledCount += 1;
      return;
    }

    this.failedCount += 1;
  }
}
