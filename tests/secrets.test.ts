import { describe, expect, it } from 'vitest';
import { buildApiKeyMask, isMaskedApiKeyValue, getApiKey, saveApiKey, deleteApiKey, isSecretStorageAvailable, clearSessionApiKeys } from '../src/secrets';

describe('buildApiKeyMask', () => {
  it('masks keys that are 8 characters or shorter with exact 8 bullet points', () => {
    expect(buildApiKeyMask('12345678')).toBe('••••••••');
    expect(buildApiKeyMask('abc')).toBe('••••••••');
    expect(buildApiKeyMask('')).toBe('••••••••');
  });

  it('masks middle part of keys longer than 8 characters preserving first and last 4 characters', () => {
    expect(buildApiKeyMask('sk-proj-1234567890abcdef')).toBe('sk-p••••••••cdef');
    expect(buildApiKeyMask('123456789')).toBe('1234••••••••6789');
  });

  it('trims whitespace before processing', () => {
    expect(buildApiKeyMask('  sk-proj-1234567890abcdef  ')).toBe('sk-p••••••••cdef');
  });
});

describe('isMaskedApiKeyValue', () => {
  it('identifies legacy mask formats as masked', () => {
    expect(isMaskedApiKeyValue('•••••••• saved')).toBe(true);
    expect(isMaskedApiKeyValue('******** saved')).toBe(true);
  });

  it('identifies values with 4 or more consecutive bullets or asterisks as masked', () => {
    expect(isMaskedApiKeyValue('••••••••')).toBe(true);
    expect(isMaskedApiKeyValue('sk-p••••••••cdef')).toBe(true);
    expect(isMaskedApiKeyValue('1234****abcd')).toBe(true);
  });

  it('identifies normal keys as NOT masked', () => {
    expect(isMaskedApiKeyValue('sk-proj-1234567890abcdef')).toBe(false);
    expect(isMaskedApiKeyValue('12345678')).toBe(false);
    expect(isMaskedApiKeyValue('abc')).toBe(false);
    expect(isMaskedApiKeyValue('')).toBe(false);
  });
});

describe('SecretStorage Fallback Handling', () => {
  it('isSecretStorageAvailable returns true when secretStorage methods are present', () => {
    const mockApp = {
      secretStorage: {
        getSecret: () => {},
        setSecret: () => {},
        deleteSecret: () => {},
      },
    };
    expect(isSecretStorageAvailable(mockApp as any)).toBe(true);
  });

  it('isSecretStorageAvailable returns false when secretStorage is missing or incomplete', () => {
    expect(isSecretStorageAvailable({} as any)).toBe(false);
    expect(isSecretStorageAvailable({ secretStorage: {} } as any)).toBe(false);
  });

  it('sets and gets API key using SecretStorage when available', async () => {
    const secrets = new Map<string, string>();
    const mockApp = {
      secretStorage: {
        getSecret: async (id: string) => secrets.get(id) ?? null,
        setSecret: async (id: string, val: string) => { secrets.set(id, val); },
        deleteSecret: async (id: string) => { secrets.delete(id); },
      },
    };

    await saveApiKey(mockApp as any, 'openai-compatible', 'my-secret-key-123456');
    const key = await getApiKey(mockApp as any, 'openai-compatible');
    expect(key).toBe('my-secret-key-123456');
    expect(secrets.get('inbox-curator-api-key-openai')).toBe('my-secret-key-123456');
  });

  it('sets and gets API key using session fallback when SecretStorage is unavailable', async () => {
    const mockApp = {} as any; // No secretStorage
    clearSessionApiKeys();

    await saveApiKey(mockApp, 'openai-compatible', 'my-session-key-abc');
    const key = await getApiKey(mockApp, 'openai-compatible');
    expect(key).toBe('my-session-key-abc');

    // delete key
    await deleteApiKey(mockApp, 'openai-compatible');
    const keyAfterDelete = await getApiKey(mockApp, 'openai-compatible');
    expect(keyAfterDelete).toBeNull();
  });

  it('clearSessionApiKeys clears fallback keys', async () => {
    const mockApp = {} as any;
    clearSessionApiKeys();

    await saveApiKey(mockApp, 'gemini-native', 'gemini-key');
    clearSessionApiKeys();
    const key = await getApiKey(mockApp, 'gemini-native');
    expect(key).toBeNull();
  });
});
