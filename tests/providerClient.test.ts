import { describe, expect, it, vi } from 'vitest';
import { getApiKey, saveApiKey, deleteApiKey } from '../src/secrets';
import { classifyProviderFailure, maskBase64, postProviderChat } from '../src/providerClient';
import { buildGeminiUrl } from '../src/gemini';
import { runCodexExec } from '../src/codexCli';

vi.mock('../src/codexCli', () => ({
  isCodexCliRunnable: vi.fn(() => true),
  runCodexExec: vi.fn(async () => ({ ok: true, content: 'codex-output' })),
}));

function createMockSecretStorage() {
  const secrets = new Map<string, string>();
  return {
    secretStorage: {
      getSecret: async (id: string) => secrets.get(id) || null,
      setSecret: async (id: string, value: string) => {
        secrets.set(id, value);
      },
      deleteSecret: async (id: string) => {
        secrets.delete(id);
      },
    },
    secrets,
  };
}

describe('Provider Extension and SecretStorage legacy compatibility', () => {
  it('reads legay OpenAI API key when new provider-specific key is not set', async () => {
    const mock = createMockSecretStorage();
    // Save legacy key only
    await mock.secretStorage.setSecret('inbox-curator-api-key', 'legacy-openai-key-value');

    const app = mock as any;
    const apiKey = await getApiKey(app, 'openai-compatible');
    expect(apiKey).toBe('legacy-openai-key-value');
  });

  it('reads provider-specific key when set, ignoring legacy key', async () => {
    const mock = createMockSecretStorage();
    await mock.secretStorage.setSecret('inbox-curator-api-key', 'legacy-openai-key-value');
    await mock.secretStorage.setSecret('inbox-curator-api-key-openai', 'new-openai-key-value');

    const app = mock as any;
    const apiKey = await getApiKey(app, 'openai-compatible');
    expect(apiKey).toBe('new-openai-key-value');
  });

  it('saves and reads Gemini and Anthropic keys independently', async () => {
    const mock = createMockSecretStorage();
    const app = mock as any;

    await saveApiKey(app, 'gemini-native', 'gemini-key');
    await saveApiKey(app, 'anthropic-native', 'anthropic-key');

    expect(await getApiKey(app, 'gemini-native')).toBe('gemini-key');
    expect(await getApiKey(app, 'anthropic-native')).toBe('anthropic-key');

    // Deleting Gemini key does not affect Anthropic
    await deleteApiKey(app, 'gemini-native');
    expect(await getApiKey(app, 'gemini-native')).toBeNull();
    expect(await getApiKey(app, 'anthropic-native')).toBe('anthropic-key');
  });

  it('classifies Gemini and Anthropic API failures correctly', () => {
    const rateLimitError = { ok: false as const, error: 'Too Many Requests', status: 429 };
    const authError = { ok: false as const, error: 'Unauthorized', status: 401 };
    const serverError = { ok: false as const, error: 'Server Error', status: 502 };
    const networkError = { ok: false as const, error: 'Network fail' }; // no status

    // Gemini
    expect(classifyProviderFailure('gemini-native', rateLimitError)).toEqual({
      retryable: true,
      reason: 'Rate limit reached',
    });
    expect(classifyProviderFailure('gemini-native', authError)).toEqual({
      retryable: false,
      reason: 'HTTP 401',
    });
    expect(classifyProviderFailure('gemini-native', serverError)).toEqual({
      retryable: true,
      reason: 'Server error',
    });
    expect(classifyProviderFailure('gemini-native', networkError)).toEqual({
      retryable: true,
      reason: 'Network error or timeout',
    });

    // Anthropic
    expect(classifyProviderFailure('anthropic-native', rateLimitError)).toEqual({
      retryable: true,
      reason: 'Rate limit reached',
    });
    expect(classifyProviderFailure('anthropic-native', authError)).toEqual({
      retryable: false,
      reason: 'HTTP 401',
    });
    expect(classifyProviderFailure('anthropic-native', serverError)).toEqual({
      retryable: true,
      reason: 'Server error',
    });
  });

  it('builds Gemini URL with key parameter correctly', () => {
    const url = buildGeminiUrl('https://generativelanguage.googleapis.com/', 'gemini-1.5-flash', 'my-api-key');
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=my-api-key');
  });

  it('masks base64 images inside nested logs and errors', () => {
    const base64Str = 'iVBORw0KGgoAAAANSUhEUgAAAAUA'.repeat(5);
    const sampleLog = {
      provider: 'openai-compatible',
      messages: [
        { role: 'system', content: 'hello' },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Analyze this' },
            { type: 'image_url', image_url: { url: `data:image/png;base64,${base64Str}` } },
          ],
        },
      ],
      nested: {
        error: `Failed to process request with data:image/png;base64,${base64Str}`,
        data: base64Str,
      },
    };

    const masked = maskBase64(sampleLog);

    expect(masked.messages[1].content[1].image_url.url).toBe('data:image/png;base64,[OMITTED]');
    expect(masked.nested.error).toContain('data:image/png;base64,[OMITTED]');
    expect(masked.nested.data).toContain('...[OMITTED]');
  });
});

describe('Codex CLI model forwarding', () => {
  const baseSettings = {
    enabled: true,
    consentAcknowledged: true,
    allowBackground: false,
    binaryPath: '',
    model: '',
  };

  it('does not send the API model name to Codex when no Codex model is set', async () => {
    vi.mocked(runCodexExec).mockClear();

    const result = await postProviderChat({
      provider: 'codex-cli',
      endpointUrl: '',
      model: 'gpt-5-nano',
      apiKey: '',
      messages: [{ role: 'user', content: 'hello' }],
      codexCli: { settings: baseSettings },
    });

    expect(result.ok).toBe(true);
    const request = vi.mocked(runCodexExec).mock.calls[0]?.[0];
    expect(request?.model).toBeUndefined();
    expect(request?.prompt).toContain('hello');
  });

  it('sends the configured Codex model', async () => {
    vi.mocked(runCodexExec).mockClear();

    await postProviderChat({
      provider: 'codex-cli',
      endpointUrl: '',
      model: 'gpt-5-nano',
      apiKey: '',
      messages: [{ role: 'user', content: 'hello' }],
      codexCli: { settings: { ...baseSettings, model: 'gpt-5.6-sol' } },
    });

    expect(vi.mocked(runCodexExec).mock.calls[0]?.[0].model).toBe('gpt-5.6-sol');
  });
});
