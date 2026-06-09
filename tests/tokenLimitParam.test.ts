import { describe, expect, it } from 'vitest';
import {
  resolveOpenAiTokenLimitParam,
  resolveEffectiveOpenAiTokenLimitParam,
  buildOpenAiCompatibleTokenLimitDetectionKey,
  normalizeEndpointForDetectionKey,
  applyOpenAiCompatibleTokenLimit,
  isUnsupportedParameterError,
  isContextOverflowError,
} from '../src/openAiCompatible';

describe('normalizeEndpointForDetectionKey', () => {
  it('removes trailing slash', () => {
    expect(normalizeEndpointForDetectionKey('https://api.openai.com/v1/')).toBe('https://api.openai.com/v1');
  });

  it('removes query parameters', () => {
    const a = normalizeEndpointForDetectionKey('https://api.openai.com/v1?key=abc');
    const b = normalizeEndpointForDetectionKey('https://api.openai.com/v1');
    expect(a).toBe(b);
  });

  it('removes hash fragments', () => {
    const a = normalizeEndpointForDetectionKey('https://api.openai.com/v1#section');
    const b = normalizeEndpointForDetectionKey('https://api.openai.com/v1');
    expect(a).toBe(b);
  });

  it('preserves path differences', () => {
    const a = normalizeEndpointForDetectionKey('http://localhost:1234/v1');
    const b = normalizeEndpointForDetectionKey('http://localhost:1234/v1/chat/completions');
    expect(a).not.toBe(b);
  });

  it('trims whitespace', () => {
    const a = normalizeEndpointForDetectionKey('  https://api.openai.com/v1  ');
    const b = normalizeEndpointForDetectionKey('https://api.openai.com/v1');
    expect(a).toBe(b);
  });

  it('handles invalid URLs gracefully (returns trimmed without trailing slash)', () => {
    const result = normalizeEndpointForDetectionKey('  not-a-url/ ');
    expect(result).toBe('not-a-url');
  });

  it('returns empty string for empty input', () => {
    expect(normalizeEndpointForDetectionKey('')).toBe('');
    expect(normalizeEndpointForDetectionKey('   ')).toBe('');
  });
});

describe('buildOpenAiCompatibleTokenLimitDetectionKey', () => {
  it('same endpoint + model gives same key', () => {
    const a = buildOpenAiCompatibleTokenLimitDetectionKey('https://api.openai.com/v1', 'gpt-4o');
    const b = buildOpenAiCompatibleTokenLimitDetectionKey('https://api.openai.com/v1', 'gpt-4o');
    expect(a).toBe(b);
  });

  it('different endpoint gives different key', () => {
    const a = buildOpenAiCompatibleTokenLimitDetectionKey('https://api.openai.com/v1', 'gpt-4o');
    const b = buildOpenAiCompatibleTokenLimitDetectionKey('https://other.com/v1', 'gpt-4o');
    expect(a).not.toBe(b);
  });

  it('different model gives different key', () => {
    const a = buildOpenAiCompatibleTokenLimitDetectionKey('https://api.openai.com/v1', 'gpt-4o');
    const b = buildOpenAiCompatibleTokenLimitDetectionKey('https://api.openai.com/v1', 'gpt-4o-mini');
    expect(a).not.toBe(b);
  });

  it('normalizes trailing slash in endpoint', () => {
    const a = buildOpenAiCompatibleTokenLimitDetectionKey('https://api.openai.com/v1/', 'gpt-4o');
    const b = buildOpenAiCompatibleTokenLimitDetectionKey('https://api.openai.com/v1', 'gpt-4o');
    expect(a).toBe(b);
  });

  it('normalizes query and hash differences', () => {
    const a = buildOpenAiCompatibleTokenLimitDetectionKey('https://api.openai.com/v1?foo=bar', 'gpt-4o');
    const b = buildOpenAiCompatibleTokenLimitDetectionKey('https://api.openai.com/v1#section', 'gpt-4o');
    const c = buildOpenAiCompatibleTokenLimitDetectionKey('https://api.openai.com/v1', 'gpt-4o');
    expect(a).toBe(b);
    expect(a).toBe(c);
  });

  it('normalizes endpoint whitespace', () => {
    const a = buildOpenAiCompatibleTokenLimitDetectionKey('  https://api.openai.com/v1  ', 'gpt-4o');
    const b = buildOpenAiCompatibleTokenLimitDetectionKey('https://api.openai.com/v1', 'gpt-4o');
    expect(a).toBe(b);
  });

  it('does not include API key in the key', () => {
    const key = buildOpenAiCompatibleTokenLimitDetectionKey('https://api.openai.com/v1', 'gpt-4o');
    expect(key).not.toContain('sk-');
  });

  it('preserves model case (models may be case-sensitive)', () => {
    const key = buildOpenAiCompatibleTokenLimitDetectionKey('https://api.openai.com/v1', 'MyModel-v1');
    expect(key).toContain('MyModel-v1');
  });

  it('trims trailing whitespace from model name', () => {
    const a = buildOpenAiCompatibleTokenLimitDetectionKey('https://api.openai.com/v1', 'gpt-5-mini ');
    const b = buildOpenAiCompatibleTokenLimitDetectionKey('https://api.openai.com/v1', 'gpt-5-mini');
    expect(a).toBe(b);
  });

  it('trims leading whitespace from model name', () => {
    const a = buildOpenAiCompatibleTokenLimitDetectionKey('https://api.openai.com/v1', ' gpt-5-mini');
    const b = buildOpenAiCompatibleTokenLimitDetectionKey('https://api.openai.com/v1', 'gpt-5-mini');
    expect(a).toBe(b);
  });

  it('localhost endpoints with trailing slash normalize to same key', () => {
    const a = buildOpenAiCompatibleTokenLimitDetectionKey('http://localhost:1234/v1', 'local-model');
    const b = buildOpenAiCompatibleTokenLimitDetectionKey('http://localhost:1234/v1/', 'local-model');
    expect(a).toBe(b);
  });
});

describe('resolveOpenAiTokenLimitParam (legacy, stateless)', () => {
  it('auto + detected max_tokens resolves to max_tokens', () => {
    expect(resolveOpenAiTokenLimitParam('auto', 'max_tokens')).toBe('max_tokens');
  });

  it('auto + detected max_completion_tokens resolves to max_completion_tokens', () => {
    expect(resolveOpenAiTokenLimitParam('auto', 'max_completion_tokens')).toBe('max_completion_tokens');
  });

  it('auto + detected none resolves to none', () => {
    expect(resolveOpenAiTokenLimitParam('auto', 'none')).toBe('none');
  });

  it('auto + detected unknown resolves to none', () => {
    expect(resolveOpenAiTokenLimitParam('auto', 'unknown')).toBe('none');
  });

  it('manual max_tokens overrides detected value', () => {
    expect(resolveOpenAiTokenLimitParam('max_tokens', 'none')).toBe('max_tokens');
    expect(resolveOpenAiTokenLimitParam('max_tokens', 'unknown')).toBe('max_tokens');
  });

  it('manual max_completion_tokens overrides detected value', () => {
    expect(resolveOpenAiTokenLimitParam('max_completion_tokens', 'none')).toBe('max_completion_tokens');
  });

  it('manual none overrides detected value', () => {
    expect(resolveOpenAiTokenLimitParam('none', 'max_tokens')).toBe('none');
  });
});

describe('resolveEffectiveOpenAiTokenLimitParam (key-aware)', () => {
  const currentKey = buildOpenAiCompatibleTokenLimitDetectionKey('https://api.openai.com/v1', 'gpt-4o');
  const staleKey = buildOpenAiCompatibleTokenLimitDetectionKey('https://other.com/v1', 'gpt-4o');

  it('auto + matching key + detected max_tokens resolves max_tokens', () => {
    expect(resolveEffectiveOpenAiTokenLimitParam('auto', 'max_tokens', currentKey, currentKey)).toBe('max_tokens');
  });

  it('auto + matching key + detected max_completion_tokens resolves max_completion_tokens', () => {
    expect(resolveEffectiveOpenAiTokenLimitParam('auto', 'max_completion_tokens', currentKey, currentKey)).toBe('max_completion_tokens');
  });

  it('auto + matching key + detected none resolves none', () => {
    expect(resolveEffectiveOpenAiTokenLimitParam('auto', 'none', currentKey, currentKey)).toBe('none');
  });

  it('auto + stale key resolves none', () => {
    expect(resolveEffectiveOpenAiTokenLimitParam('auto', 'max_tokens', staleKey, currentKey)).toBe('none');
  });

  it('auto + missing key resolves none', () => {
    expect(resolveEffectiveOpenAiTokenLimitParam('auto', 'max_tokens', undefined, currentKey)).toBe('none');
  });

  it('auto + unknown resolves none', () => {
    expect(resolveEffectiveOpenAiTokenLimitParam('auto', 'unknown', currentKey, currentKey)).toBe('none');
  });

  it('manual max_tokens ignores stale detection', () => {
    expect(resolveEffectiveOpenAiTokenLimitParam('max_tokens', 'none', staleKey, currentKey)).toBe('max_tokens');
  });

  it('manual max_completion_tokens ignores stale detection', () => {
    expect(resolveEffectiveOpenAiTokenLimitParam('max_completion_tokens', 'none', staleKey, currentKey)).toBe('max_completion_tokens');
  });

  it('manual none ignores stale detection', () => {
    expect(resolveEffectiveOpenAiTokenLimitParam('none', 'max_tokens', currentKey, currentKey)).toBe('none');
  });
});

describe('applyOpenAiCompatibleTokenLimit', () => {
  it('adds max_tokens when param is max_tokens and maxOutputTokens is defined', () => {
    const body: Record<string, unknown> = {};
    applyOpenAiCompatibleTokenLimit(body, 4096, 'max_tokens');
    expect(body.max_tokens).toBe(4096);
    expect(body.max_completion_tokens).toBeUndefined();
  });

  it('adds max_completion_tokens when param is max_completion_tokens', () => {
    const body: Record<string, unknown> = {};
    applyOpenAiCompatibleTokenLimit(body, 1024, 'max_completion_tokens');
    expect(body.max_completion_tokens).toBe(1024);
    expect(body.max_tokens).toBeUndefined();
  });

  it('adds neither when param is none', () => {
    const body: Record<string, unknown> = {};
    applyOpenAiCompatibleTokenLimit(body, 4096, 'none');
    expect(body.max_tokens).toBeUndefined();
    expect(body.max_completion_tokens).toBeUndefined();
  });

  it('adds neither when maxOutputTokens is undefined', () => {
    const body: Record<string, unknown> = {};
    applyOpenAiCompatibleTokenLimit(body, undefined, 'max_tokens');
    expect(body.max_tokens).toBeUndefined();
  });

  it('preserves other body fields', () => {
    const body: Record<string, unknown> = { model: 'gpt-4', temperature: 0.7 };
    applyOpenAiCompatibleTokenLimit(body, 2048, 'max_tokens');
    expect(body.model).toBe('gpt-4');
    expect(body.temperature).toBe(0.7);
    expect(body.max_tokens).toBe(2048);
  });
});

describe('isUnsupportedParameterError', () => {
  it('detects max_tokens is not supported', () => {
    expect(isUnsupportedParameterError('max_tokens is not supported', 400)).toBe(true);
  });

  it('detects use max_completion_tokens instead', () => {
    expect(isUnsupportedParameterError('Please use max_completion_tokens instead of max_tokens', 400)).toBe(true);
  });

  it('detects unsupported parameter message', () => {
    expect(isUnsupportedParameterError('unsupported parameter: max_tokens', 400)).toBe(true);
  });

  it('detects unknown parameter', () => {
    expect(isUnsupportedParameterError('unknown parameter: foo', 400)).toBe(true);
  });

  it('detects extra fields not permitted', () => {
    expect(isUnsupportedParameterError('extra fields not permitted: max_tokens', 400)).toBe(true);
  });

  it('returns false for auth errors', () => {
    expect(isUnsupportedParameterError('Incorrect API key', 401)).toBe(false);
  });

  it('returns false for rate limit errors', () => {
    expect(isUnsupportedParameterError('Rate limit exceeded', 429)).toBe(false);
  });

  it('returns false for empty body', () => {
    expect(isUnsupportedParameterError('', 400)).toBe(false);
  });

  it('returns false for undefined body', () => {
    expect(isUnsupportedParameterError(undefined, 400)).toBe(false);
  });

  it('detects max_completion_tokens is not supported', () => {
    expect(isUnsupportedParameterError('max_completion_tokens is not supported for this model', 400)).toBe(true);
  });
});

describe('isContextOverflowError', () => {
  it('detects context length exceeded', () => {
    expect(isContextOverflowError('context length exceeded', 400)).toBe(true);
  });

  it('detects maximum context length', () => {
    expect(isContextOverflowError('This model maximum context length is 8192', 400)).toBe(true);
  });

  it('detects too many tokens', () => {
    expect(isContextOverflowError('too many tokens', 400)).toBe(true);
  });

  it('returns false for unsupported parameter', () => {
    expect(isContextOverflowError('max_tokens is not supported', 400)).toBe(false);
  });

  it('returns false for empty body', () => {
    expect(isContextOverflowError('', 400)).toBe(false);
  });
});
