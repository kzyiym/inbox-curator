import type { ReviewJob, ReviewJobResult } from './queueTypes';

export interface ReviewRetryPolicy {
  maxAttempts: number;
  shouldRetry: (job: ReviewJob, result: ReviewJobResult, attempt: number) => boolean;
  getRetryDelayMs: (job: ReviewJob, result: ReviewJobResult, attempt: number) => number;
}

export function createDefaultReviewRetryPolicy(): ReviewRetryPolicy {
  return {
    maxAttempts: 3,
    shouldRetry: (_job, result, attempt) => result.status === 'failed' && result.retryable === true && attempt < 3,
    getRetryDelayMs: (_job, _result, attempt) => {
      const baseDelayMs = 1500;
      const exponentialDelayMs = baseDelayMs * 2 ** Math.max(0, attempt - 1);
      const jitterMs = Math.floor(Math.random() * 350);
      return exponentialDelayMs + jitterMs;
    },
  };
}
