import { ReviewRateLimiter } from './rateLimiter';
import { createDefaultReviewRetryPolicy, type ReviewRetryPolicy } from './retry';
import type {
  QueueHistoryEntry,
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
  private paused = false;
  private readonly history: QueueHistoryEntry[] = [];
  private readonly cancelledRunningIds = new Set<string>();
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
      paused: this.paused,
      pendingJobs: this.pendingEntries.map((e) => e.job),
      runningJobs: Array.from(this.runningByPath.values()),
      history: [...this.history],
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
      const result: ReviewJobResult = { status: 'cancelled' };
      this.recordHistory(entry.job, result);
      entry.resolve(result);
    }

    this.rateLimiter.reset();
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    if (!this.paused) {
      return;
    }
    this.paused = false;
    void this.drainQueue();
  }

  cancelJob(id: string): boolean {
    const pendingIndex = this.pendingEntries.findIndex((e) => e.job.id === id);
    if (pendingIndex !== -1) {
      const entry = this.pendingEntries[pendingIndex];
      this.pendingEntries.splice(pendingIndex, 1);
      this.pendingByPath.delete(entry.job.notePath);
      this.cancelledCount += 1;

      const result: ReviewJobResult = { status: 'cancelled' };
      this.recordHistory(entry.job, result);
      entry.resolve(result);
      return true;
    }

    for (const job of this.runningByPath.values()) {
      if (job.id === id) {
        this.cancelledRunningIds.add(id);
        return true;
      }
    }

    return false;
  }

  cancelPendingJobs(): void {
    while (this.pendingEntries.length > 0) {
      const entry = this.pendingEntries.shift();
      if (!entry) {
        continue;
      }

      this.pendingByPath.delete(entry.job.notePath);
      this.cancelledCount += 1;
      const result: ReviewJobResult = { status: 'cancelled' };
      this.recordHistory(entry.job, result);
      entry.resolve(result);
    }
  }

  private recordHistory(job: ReviewJob, result: ReviewJobResult): void {
    const MAX_HISTORY_SIZE = 50;
    this.history.push({
      id: job.id,
      notePath: job.notePath,
      source: job.source,
      status: result.status,
      timestamp: Date.now(),
      error: result.error,
      attempts: result.attempts,
    });

    if (this.history.length > MAX_HISTORY_SIZE) {
      this.history.shift();
    }
  }

  private async drainQueue(): Promise<void> {
    if (this.draining || this.stopping || this.paused) {
      return;
    }

    this.draining = true;
    try {
      while (!this.stopping && !this.paused && this.runningByPath.size < this.maxConcurrentJobs) {
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
    let result = await this.executeJob(entry.job);

    this.runningByPath.delete(entry.job.notePath);

    if (this.cancelledRunningIds.has(entry.job.id)) {
      this.cancelledRunningIds.delete(entry.job.id);
      result = {
        status: 'cancelled',
        attempts: result.attempts,
        error: result.error ?? 'Job was cancelled during execution',
      };
    }

    this.recordResult(result);
    this.recordHistory(entry.job, result);
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
