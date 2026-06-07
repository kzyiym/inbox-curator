export type ReviewJobSource = 'current-note' | 'watched-folder-manual' | 'watched-folder-auto' | 'watched-folder-poll';

export type ReviewJobStatus = 'pending' | 'running' | 'processed' | 'skipped' | 'failed' | 'cancelled';

export interface ReviewJob {
  id: string;
  source: ReviewJobSource;
  notePath: string;
  createdAt: number;
  delayBeforeStartMs: number;
}

export interface ReviewJobResult {
  status: Extract<ReviewJobStatus, 'processed' | 'skipped' | 'failed' | 'cancelled'>;
  error?: string;
  retryable?: boolean;
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
}

export interface ReviewQueueEnqueueResult {
  accepted: boolean;
  duplicate: boolean;
  promise: Promise<ReviewJobResult>;
}

export type ReviewJobProcessor = (job: ReviewJob) => Promise<ReviewJobResult>;
