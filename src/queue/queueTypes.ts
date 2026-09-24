import type { QueueFailureReasonCode } from './queueFailureReason';

export type ReviewJobSource = 'manual-current' | 'manual-folder' | 'auto-create' | 'auto-modify' | 'polling';

export type ReviewJobStatus = 'pending' | 'running' | 'processed' | 'skipped' | 'failed' | 'cancelled';

export interface ReviewJob {
  id: string;
  runId: string;
  source: ReviewJobSource;
  notePath: string;
  createdAt: number;
  delayBeforeStartMs: number;
  operationId: string;
  startedAt?: number;
  finishedAt?: number;
}

export interface ReviewJobResult {
  status: Extract<ReviewJobStatus, 'processed' | 'skipped' | 'failed' | 'cancelled'>;
  error?: string;
  retryable?: boolean;
  attempts?: number;
  reasonCode?: QueueFailureReasonCode;
}

export interface QueueHistoryEntry {
  id: string;
  notePath: string;
  source: ReviewJobSource;
  status: Extract<ReviewJobStatus, 'processed' | 'skipped' | 'failed' | 'cancelled'>;
  timestamp: number;
  error?: string;
  attempts?: number;
  reasonCode?: QueueFailureReasonCode;
}

/**
 * A note whose most recent job ended in failure.
 *
 * This is a view of the *current* processing state, not an append-only history:
 * the entry is cleared as soon as the note is queued again, and it is not
 * restored if that re-queued job is later cancelled.
 */
export interface QueueFailedJob {
  notePath: string;
  source: ReviewJobSource;
  reasonCode: QueueFailureReasonCode;
  retryable?: boolean;
  attempts?: number;
  timestamp: number;
}

export interface ReviewQueueSnapshot {
  pending: number;
  running: number;
  processed: number;
  skipped: number;
  failed: number;
  cancelled: number;
  stopping: boolean;
  maxConcurrentJobs: number;
  availableSlots: number;
  paused: boolean;
  pendingJobs: ReviewJob[];
  runningJobs: ReviewJob[];
  failedJobs: QueueFailedJob[];
  history: QueueHistoryEntry[];
}

export interface ReviewQueueEnqueueResult {
  accepted: boolean;
  duplicate: boolean;
  promise: Promise<ReviewJobResult>;
}

export type ReviewRetrySkipReason = 'file-missing' | 'already-reviewed' | 'already-queued' | 'queue-stopping';

export interface ReviewRetryOutcome {
  accepted: boolean;
  reason?: ReviewRetrySkipReason;
}

export type ReviewJobProcessor = (job: ReviewJob) => Promise<ReviewJobResult>;

export interface ReviewQueueStatus {
  pending: number;
  running: number;
  completed: number;
  failed: number;
  maxConcurrentJobs?: number;
  currentPath?: string;
  lastCompletedPath?: string;
  lastFailedPath?: string;
}

export type ReviewQueueStatusListener = (status: ReviewQueueStatus) => void;

export interface ReviewQueueLogEntry {
  level: 'INFO' | 'WARN' | 'ERROR';
  event: string;
  jobId?: string;
  runId?: string;
  source?: ReviewJobSource;
  notePath?: string;
  pendingCount?: number;
  runningCount?: number;
  maxConcurrentJobs?: number;
  queuedOrRunningCount?: number;
  skippedReason?: string;
  durationMs?: number;
  errorMessage?: string;
  timestamp: string;
}

export type ReviewQueueLogCallback = (entry: ReviewQueueLogEntry) => void;
