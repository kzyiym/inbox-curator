import type { ReviewJob, ReviewJobSource } from './queueTypes';

let reviewJobCounter = 0;
let operationIdCounter = 0;
let runIdCounter = 0;

export function generateOperationId(): string {
  operationIdCounter += 1;
  return `op-${Date.now().toString(36)}-${operationIdCounter}`;
}

export function generateRunId(): string {
  runIdCounter += 1;
  return `run-${Date.now().toString(36)}-${runIdCounter}`;
}

export function createReviewJob(source: ReviewJobSource, notePath: string, delayBeforeStartMs = 0, runId?: string): ReviewJob {
  reviewJobCounter += 1;
  return {
    id: `review-job-${Date.now()}-${reviewJobCounter}`,
    runId: runId ?? generateRunId(),
    source,
    notePath,
    createdAt: Date.now(),
    delayBeforeStartMs: Math.max(0, Math.round(delayBeforeStartMs)),
    operationId: generateOperationId(),
  };
}
