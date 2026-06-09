import { ReviewRateLimiter } from './rateLimiter';
import { createDefaultReviewRetryPolicy, type ReviewRetryPolicy } from './retry';
import type {
  QueueHistoryEntry,
  ReviewJob,
  ReviewJobProcessor,
  ReviewJobResult,
  ReviewQueueEnqueueResult,
  ReviewQueueLogCallback,
  ReviewQueueLogEntry,
  ReviewQueueSnapshot,
  ReviewQueueStatus,
  ReviewQueueStatusListener,
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
  onStatus?: ReviewQueueStatusListener;
  onLog?: ReviewQueueLogCallback;
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
  private readonly queuedOrRunningPaths = new Set<string>();
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
  private readonly onRetry?: (reviewJob: ReviewJob, attempt: number, delayMs: number, result: ReviewJobResult) => void;
  private readonly onStatus?: ReviewQueueStatusListener;
  private readonly onLog?: ReviewQueueLogCallback;
  private maxConcurrentJobs: number;

  constructor(
    private readonly processor: ReviewJobProcessor,
    options: ReviewQueueOptions = {},
  ) {
    this.retryPolicy = options.retryPolicy ?? createDefaultReviewRetryPolicy();
    this.rateLimiter = options.rateLimiter ?? new ReviewRateLimiter();
    this.onRetry = options.onRetry;
    this.onStatus = options.onStatus;
    this.onLog = options.onLog;
    this.maxConcurrentJobs = clampMaxConcurrentJobs(options.maxConcurrentJobs);
  }

  enqueue(job: ReviewJob): ReviewQueueEnqueueResult {
    if (this.queuedOrRunningPaths.has(job.notePath)) {
      this.logEvent('INFO', 'enqueue_skipped', job, { skippedReason: 'already_queued_or_running' });
      this.assertQueueInvariants('enqueue');
      return { accepted: false, duplicate: true, promise: Promise.resolve({ status: 'cancelled' }) };
    }

    if (this.stopping) {
      this.logEvent('INFO', 'enqueue_skipped', job, { skippedReason: 'queue_stopping' });
      this.assertQueueInvariants('enqueue');
      return { accepted: false, duplicate: false, promise: Promise.resolve({ status: 'cancelled' }) };
    }

    let resolve!: (result: ReviewJobResult) => void;
    const promise = new Promise<ReviewJobResult>((innerResolve) => {
      resolve = innerResolve;
    });

    const entry: InternalQueueEntry = { job, promise, resolve };
    this.queuedOrRunningPaths.add(job.notePath);
    this.pendingEntries.push(entry);
    this.pendingByPath.set(job.notePath, entry);
    this.logEvent('INFO', 'enqueue_accepted', job);
    this.notifyStatus();
    this.assertQueueInvariants('enqueue');
    void this.drainQueue();

    return { accepted: true, duplicate: false, promise };
  }

  setMaxConcurrentJobs(value: number): void {
    this.maxConcurrentJobs = clampMaxConcurrentJobs(value);
    this.assertQueueInvariants('setMaxConcurrentJobs');
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
    this.logEvent('INFO', 'stop_requested');
    while (this.pendingEntries.length > 0) {
      const entry = this.pendingEntries.shift();
      if (!entry) {
        continue;
      }

      this.pendingByPath.delete(entry.job.notePath);
      this.queuedOrRunningPaths.delete(entry.job.notePath);
      this.cancelledCount += 1;
      const result: ReviewJobResult = { status: 'cancelled' };
      this.recordHistory(entry.job, result);
      entry.resolve(result);
    }

    this.rateLimiter.reset();
    this.assertQueueInvariants('stop');
  }

  pause(): void {
    this.paused = true;
    this.assertQueueInvariants('pause');
  }

  resume(): void {
    if (!this.paused) {
      return;
    }
    this.paused = false;
    this.assertQueueInvariants('resume');
    void this.drainQueue();
  }

  cancelJob(id: string): boolean {
    const pendingIndex = this.pendingEntries.findIndex((e) => e.job.id === id);
    if (pendingIndex !== -1) {
      const entry = this.pendingEntries[pendingIndex];
      this.pendingEntries.splice(pendingIndex, 1);
      this.pendingByPath.delete(entry.job.notePath);
      this.queuedOrRunningPaths.delete(entry.job.notePath);
      this.cancelledCount += 1;

      const result: ReviewJobResult = { status: 'cancelled' };
      this.recordHistory(entry.job, result);
      entry.resolve(result);
      this.assertQueueInvariants('cancelJob');
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
      this.queuedOrRunningPaths.delete(entry.job.notePath);
      this.cancelledCount += 1;
      const result: ReviewJobResult = { status: 'cancelled' };
      this.recordHistory(entry.job, result);
      entry.resolve(result);
    }
    this.assertQueueInvariants('cancelPendingJobs');
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
    if (this.draining) {
      return;
    }

    if (this.stopping) {
      this.logEvent('INFO', 'drain_skipped_stopping');
      return;
    }

    if (this.paused) {
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
        entry.job.startedAt = Date.now();
        this.logEvent('INFO', 'dispatch_started', entry.job);
        void this.runEntry(entry);
      }
    } finally {
      this.draining = false;
    }
    this.assertQueueInvariants('drainQueue');
  }

  private notifyStatus(currentPath?: string): void {
    this.onStatus?.({
      pending: this.pendingEntries.length,
      running: this.runningByPath.size,
      completed: this.processedCount,
      failed: this.failedCount,
      maxConcurrentJobs: this.maxConcurrentJobs,
      currentPath,
    });
  }

  private async runEntry(entry: InternalQueueEntry): Promise<void> {
    this.notifyStatus(entry.job.notePath);
    entry.job.startedAt = Date.now();
    try {
      const result = await this.executeJob(entry.job);
      entry.job.finishedAt = Date.now();

      if (this.stopping) {
        this.logEvent('INFO', 'job_finalized', entry.job, { durationMs: this.jobDurationMs(entry.job) });
        entry.resolve({ status: 'cancelled' });
        this.cleanupRunEntry(entry);
        return;
      }

      let finalResult = result;
      if (this.cancelledRunningIds.has(entry.job.id)) {
        this.cancelledRunningIds.delete(entry.job.id);
        finalResult = {
          status: 'cancelled',
          attempts: result.attempts,
          error: result.error ?? 'Job was cancelled during execution',
        } satisfies ReviewJobResult;
      }

      this.recordResult(finalResult);
      this.recordHistory(entry.job, finalResult);

      if (finalResult.status === 'processed') {
        this.logEvent('INFO', 'job_succeeded', entry.job, { durationMs: this.jobDurationMs(entry.job) });
      } else if (finalResult.status === 'failed') {
        this.logEvent('WARN', 'job_failed', entry.job, {
          errorMessage: finalResult.error,
          durationMs: this.jobDurationMs(entry.job),
        });
      }

      entry.resolve(finalResult);
    } catch (error) {
      entry.job.finishedAt = Date.now();
      const result: ReviewJobResult = {
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error in runEntry',
      };
      this.failedCount += 1;
      this.recordHistory(entry.job, result);
      this.logEvent('ERROR', 'job_failed', entry.job, {
        errorMessage: result.error,
        durationMs: this.jobDurationMs(entry.job),
      });
      entry.resolve(result);
    } finally {
      this.cleanupRunEntry(entry);
    }
  }

  private cleanupRunEntry(entry: InternalQueueEntry): void {
    this.runningByPath.delete(entry.job.notePath);
    this.queuedOrRunningPaths.delete(entry.job.notePath);
    this.notifyStatus();
    this.assertQueueInvariants('runEntry');
    void this.drainQueue();
  }

  private jobDurationMs(job: ReviewJob): number | undefined {
    if (job.startedAt && job.finishedAt) {
      return job.finishedAt - job.startedAt;
    }
    return undefined;
  }

  private logEvent(
    level: ReviewQueueLogEntry['level'],
    event: string,
    job?: ReviewJob,
    extra?: { skippedReason?: string; durationMs?: number; errorMessage?: string },
  ): void {
    if (!this.onLog) {
      return;
    }

    this.onLog({
      level,
      event,
      jobId: job?.id,
      runId: job?.runId,
      source: job?.source,
      notePath: job?.notePath,
      pendingCount: this.pendingEntries.length,
      runningCount: this.runningByPath.size,
      maxConcurrentJobs: this.maxConcurrentJobs,
      queuedOrRunningCount: this.queuedOrRunningPaths.size,
      skippedReason: extra?.skippedReason,
      durationMs: extra?.durationMs,
      errorMessage: extra?.errorMessage,
      timestamp: new Date().toISOString(),
    });
  }

  private assertQueueInvariants(context: string): void {
    const violations: string[] = [];

    if (this.runningByPath.size > this.maxConcurrentJobs) {
      violations.push(`runningByPath.size (${this.runningByPath.size}) > maxConcurrentJobs (${this.maxConcurrentJobs})`);
    }

    const runningPaths = new Set(this.runningByPath.keys());
    const pendingPaths = new Set<string>();
    for (const entry of this.pendingEntries) {
      if (pendingPaths.has(entry.job.notePath)) {
        violations.push(`duplicate pending path: ${entry.job.notePath}`);
      }
      pendingPaths.add(entry.job.notePath);

      if (runningPaths.has(entry.job.notePath)) {
        violations.push(`path in both running and pending: ${entry.job.notePath}`);
      }
    }

    const expectedQueuedOrRunning = new Set<string>([
      ...this.runningByPath.keys(),
      ...this.pendingByPath.keys(),
    ]);
    for (const path of expectedQueuedOrRunning) {
      if (!this.queuedOrRunningPaths.has(path)) {
        violations.push(`queuedOrRunningPaths missing expected path: ${path}`);
      }
    }
    for (const path of this.queuedOrRunningPaths) {
      if (!expectedQueuedOrRunning.has(path)) {
        violations.push(`queuedOrRunningPaths has unexpected path: ${path}`);
      }
    }

    if (this.stopping && this.runningByPath.size === 0 && this.pendingEntries.length > 0) {
      violations.push('stopping but pending entries exist while nothing is running');
    }

    for (const violation of violations) {
      if (this.onLog) {
        this.onLog({
          level: 'ERROR',
          event: 'queue_invariant_violation',
          pendingCount: this.pendingEntries.length,
          runningCount: this.runningByPath.size,
          maxConcurrentJobs: this.maxConcurrentJobs,
          queuedOrRunningCount: this.queuedOrRunningPaths.size,
          timestamp: new Date().toISOString(),
          errorMessage: `${context}: ${violation}`,
        });
      }
      console.warn(`[ReviewQueue] invariant violation (${context}): ${violation}`);
    }
  }

  private async executeJob(job: ReviewJob): Promise<ReviewJobResult> {
    let attempt = 0;
    let pendingDelayMs = job.delayBeforeStartMs;

    while (true) {
      if (this.stopping) {
        return { status: 'cancelled' };
      }

      attempt += 1;
      await this.rateLimiter.wait(pendingDelayMs);

      if (this.stopping) {
        return { status: 'cancelled' };
      }

      let result: ReviewJobResult;
      try {
        result = await this.processor(job);
      } catch (error) {
        result = {
          status: 'failed',
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }

      if (this.stopping) {
        return { status: 'cancelled' };
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
