import { ReviewRateLimiter } from './rateLimiter';
import { createDefaultReviewRetryPolicy, type ReviewRetryPolicy } from './retry';
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

interface ReviewQueueOptions {
  retryPolicy?: ReviewRetryPolicy;
  rateLimiter?: ReviewRateLimiter;
  onRetry?: (job: ReviewJob, attempt: number, delayMs: number, result: ReviewJobResult) => void;
  maxConcurrentJobs?: number;
}

function clampMaxConcurrentJobs(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return 1;
  }

  return Math.min(8, Math.max(1, Math.round(value ?? 1)));
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
  private readonly retryPolicy: ReviewRetryPolicy;
  private readonly rateLimiter: ReviewRateLimiter;
  private readonly onRetry?: (job: ReviewJob, attempt: number, delayMs: number, result: ReviewJobResult) => void;
  private maxConcurrentJobs: number;

  constructor(
    private readonly processor: ReviewJobProcessor,
    options: ReviewQueueOptions = {},
  ) {
    this.retryPolicy = options.retryPolicy ?? createDefaultReviewRetryPolicy();
    this.rateLimiter = options.rateLimiter ?? new ReviewRateLimiter();
    this.onRetry = options.onRetry;
    this.maxConcurrentJobs = clampMaxConcurrentJobs(options.maxConcurrentJobs);
  }

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

  setMaxConcurrentJobs(value: number): void {
    this.maxConcurrentJobs = clampMaxConcurrentJobs(value);
    void this.drainQueue();
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
      maxConcurrentJobs: this.maxConcurrentJobs,
      availableSlots: Math.max(0, this.maxConcurrentJobs - this.runningByPath.size),
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

    this.rateLimiter.reset();
  }

  private async drainQueue(): Promise<void> {
    if (this.draining || this.stopping) {
      return;
    }

    this.draining = true;
    try {
      while (!this.stopping && this.runningByPath.size < this.maxConcurrentJobs) {
        const entry = this.pendingEntries.shift();
        if (!entry) {
          break;
        }

        this.pendingByPath.delete(entry.job.notePath);
        this.runningByPath.set(entry.job.notePath, entry.job);
        void this.runEntry(entry);
      }
    } finally {
      this.draining = false;
    }
  }

  private async runEntry(entry: InternalQueueEntry): Promise<void> {
    const result = await this.executeJob(entry.job);

    this.runningByPath.delete(entry.job.notePath);
    this.recordResult(result);
    entry.resolve(result);
    void this.drainQueue();
  }

  private async executeJob(job: ReviewJob): Promise<ReviewJobResult> {
    let attempt = 0;
    let pendingDelayMs = job.delayBeforeStartMs;

    while (true) {
      attempt += 1;
      await this.rateLimiter.wait(pendingDelayMs);

      let result: ReviewJobResult;
      try {
        result = await this.processor(job);
      } catch (error) {
        result = {
          status: 'failed',
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }

      const withAttempt = { ...result, attempts: attempt } satisfies ReviewJobResult;
      if (!this.retryPolicy.shouldRetry(job, withAttempt, attempt)) {
        return withAttempt;
      }

      const retryDelayMs = this.retryPolicy.getRetryDelayMs(job, withAttempt, attempt);
      this.onRetry?.(job, attempt + 1, retryDelayMs, withAttempt);
      pendingDelayMs = retryDelayMs;
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
