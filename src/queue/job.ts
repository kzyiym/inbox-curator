import type { ReviewJob, ReviewJobSource } from './queueTypes';

let reviewJobCounter = 0;

export function createReviewJob(source: ReviewJobSource, notePath: string, delayBeforeStartMs = 0): ReviewJob {
  reviewJobCounter += 1;
  return {
    id: `review-job-${Date.now()}-${reviewJobCounter}`,
    source,
    notePath,
    createdAt: Date.now(),
    delayBeforeStartMs: Math.max(0, Math.round(delayBeforeStartMs)),
  };
}
