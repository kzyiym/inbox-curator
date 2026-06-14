import { describe, expect, it } from 'vitest';
import { sanitizeSensitiveData, sanitizeSensitiveString } from '../src/utils/sensitiveData';

describe('sensitive data sanitization', () => {
  it('redacts bearer tokens, key-value secrets, URL secrets, and base64 payloads', () => {
    const input = [
      'Authorization: Bearer top.secret.token',
      'api_key=sk-example-secret',
      'https://example.com/path?key=secret-value&safe=1',
      'data:image/png;base64,QUJDREVGRw==',
    ].join('\n');

    const sanitized = sanitizeSensitiveString(input);
    expect(sanitized).not.toContain('top.secret.token');
    expect(sanitized).not.toContain('sk-example-secret');
    expect(sanitized).not.toContain('secret-value');
    expect(sanitized).not.toContain('QUJDREVGRw==');
    expect(sanitized).toContain('[REDACTED]');
    expect(sanitized).toContain('[OMITTED]');
  });

  it('redacts sensitive object fields without redacting token usage counters', () => {
    const sanitized = sanitizeSensitiveData({
      apiKey: 'secret',
      authorization: 'Bearer secret',
      tokenUsage: { inputTokens: 10, outputTokens: 20 },
    });

    expect(sanitized.apiKey).toBe('[REDACTED]');
    expect(sanitized.authorization).toBe('[REDACTED]');
    expect(sanitized.tokenUsage).toEqual({ inputTokens: 10, outputTokens: 20 });
  });
});
