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
}

export interface QueueHistoryEntry {
  id: string;
  notePath: string;
  source: ReviewJobSource;
  status: Extract<ReviewJobStatus, 'processed' | 'skipped' | 'failed' | 'cancelled'>;
  timestamp: number;
  error?: string;
  attempts?: number;
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
  history: QueueHistoryEntry[];
}

export interface ReviewQueueEnqueueResult {
  accepted: boolean;
  duplicate: boolean;
  promise: Promise<ReviewJobResult>;
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
