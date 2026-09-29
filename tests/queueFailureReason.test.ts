import { describe, expect, it } from 'vitest';
import { classifyQueueFailure } from '../src/queue/queueFailureReason';

describe('classifyQueueFailure', () => {
  it('classifies explicit pipeline error codes', () => {
    expect(classifyQueueFailure({ errorCode: 'insufficient_input' })).toBe('insufficient_input');
    expect(classifyQueueFailure({ errorCode: 'image_not_supported' })).toBe('image_not_supported');
    expect(classifyQueueFailure({ errorCode: 'source_changed' })).toBe('source_changed');
  });

  it('classifies request failures by HTTP status', () => {
    expect(classifyQueueFailure({ stage: 'request', status: 429 })).toBe('rate_limited');
    expect(classifyQueueFailure({ stage: 'request', status: 401 })).toBe('auth');
    expect(classifyQueueFailure({ stage: 'request', status: 403 })).toBe('auth');
    expect(classifyQueueFailure({ stage: 'request', status: 404 })).toBe('model_unavailable');
    expect(classifyQueueFailure({ stage: 'request', status: 500 })).toBe('server_error');
    expect(classifyQueueFailure({ stage: 'request', status: 503 })).toBe('server_error');
    expect(classifyQueueFailure({ stage: 'request', status: 400 })).toBe('invalid_request');
  });

  it('classifies timeouts and transient network errors', () => {
    expect(classifyQueueFailure({ stage: 'request', message: 'Request timed out' })).toBe('timeout');
    expect(classifyQueueFailure({ stage: 'request', retryable: true, message: 'socket hang up' })).toBe('network');
  });

  it('classifies parse and mapping failures as invalid responses', () => {
    expect(classifyQueueFailure({ stage: 'response_parse' })).toBe('invalid_response');
    expect(classifyQueueFailure({ stage: 'mapping' })).toBe('invalid_response');
  });

  it('falls back to unknown for unclassified failures', () => {
    expect(classifyQueueFailure({})).toBe('unknown');
    expect(classifyQueueFailure({ stage: 'request', status: 200, message: 'weird' })).toBe('unknown');
  });
});
