/**
 * Classified queue failure reasons.
 *
 * The queue monitor UI must never render raw error strings, because exception
 * messages can embed note content or provider response fragments. Instead a
 * failure is reduced to one of these codes and the UI shows a fixed localized
 * message. Full details stay in the existing error/operation logs.
 */
export type QueueFailureReasonCode =
  | 'rate_limited'
  | 'timeout'
  | 'network'
  | 'server_error'
  | 'auth'
  | 'model_unavailable'
  | 'invalid_request'
  | 'invalid_response'
  | 'insufficient_input'
  | 'image_not_supported'
  | 'source_changed'
  | 'file_missing'
  | 'auto_execute_failed'
  | 'marker_restore_failed'
  | 'internal_error'
  | 'unknown';

export interface QueueFailureClassificationInput {
  stage?: 'input' | 'request' | 'response_parse' | 'mapping' | 'write' | 'unknown';
  status?: number;
  retryable?: boolean;
  errorCode?: string;
  message?: string;
}

const TIMEOUT_PATTERN = /timeout|timed out|ETIMEDOUT|aborted/i;

/**
 * Maps a review pipeline failure (or any classified failure input) to a
 * display-safe reason code. Pure function so it is easy to unit test.
 */
export function classifyQueueFailure(input: QueueFailureClassificationInput): QueueFailureReasonCode {
  const { stage, status, retryable, errorCode, message } = input;

  switch (errorCode) {
    case 'insufficient_input':
      return 'insufficient_input';
    case 'image_not_supported':
      return 'image_not_supported';
    case 'source_changed':
      return 'source_changed';
    default:
      break;
  }

  if (stage === 'input') {
    return 'insufficient_input';
  }

  if (stage === 'response_parse' || stage === 'mapping') {
    return 'invalid_response';
  }

  if (stage === 'write') {
    return 'internal_error';
  }

  if (stage === 'request') {
    if (status === 429) {
      return 'rate_limited';
    }
    if (status === 401 || status === 403) {
      return 'auth';
    }
    if (status === 404) {
      return 'model_unavailable';
    }
    if (typeof status === 'number' && status >= 500) {
      return 'server_error';
    }
    if (message && TIMEOUT_PATTERN.test(message)) {
      return 'timeout';
    }
    if (retryable) {
      return 'network';
    }
    if (typeof status === 'number' && status >= 400) {
      return 'invalid_request';
    }
    return 'unknown';
  }

  return 'unknown';
}
