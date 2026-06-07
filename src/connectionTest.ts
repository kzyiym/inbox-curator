import { requestUrl } from 'obsidian';
import type { InboxCuratorProvider } from './settings';

export interface ConnectionTestOptions {
  provider: InboxCuratorProvider;
  endpointUrl: string;
  model: string;
  apiKey: string;
}

export interface ConnectionTestSuccess {
  ok: true;
  message: string;
}

export interface ConnectionTestFailure {
  ok: false;
  error: string;
}

export type ConnectionTestResult = ConnectionTestSuccess | ConnectionTestFailure;

function normalizeEndpointUrl(endpointUrl: string): string {
  return endpointUrl.trim().replace(/\/+$/, '');
}

function extractMessageContent(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return null;
  }

  const first = choices[0];
  if (!first || typeof first !== 'object') {
    return null;
  }

  const message = (first as { message?: unknown }).message;
  if (!message || typeof message !== 'object') {
    return null;
  }

  const content = (message as { content?: unknown }).content;
  return typeof content === 'string' && content.trim() !== '' ? content.trim() : null;
}

export async function testConnection(options: ConnectionTestOptions): Promise<ConnectionTestResult> {
  if (options.provider !== 'openai-compatible') {
    return { ok: false, error: `Unsupported provider: ${options.provider}` };
  }

  const endpointUrl = normalizeEndpointUrl(options.endpointUrl);
  if (!endpointUrl) {
    return { ok: false, error: 'Endpoint URL is required.' };
  }

  const model = options.model.trim();
  if (!model) {
    return { ok: false, error: 'Model is required.' };
  }

  if (!options.apiKey.trim()) {
    return { ok: false, error: 'API key is required.' };
  }

  const requestUrlValue = `${endpointUrl}/chat/completions`;

  try {
    const response = await requestUrl({
      url: requestUrlValue,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${options.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: 'You are a connection test responder.' },
          { role: 'user', content: 'Reply with OK.' },
        ],
        max_tokens: 5,
        temperature: 0,
      }),
      throw: false,
    });

    if (response.status < 200 || response.status >= 300) {
      console.warn('Inbox Curator connection test failed', {
        provider: options.provider,
        endpointUrl,
        model,
        status: response.status,
      });
      return { ok: false, error: `HTTP ${response.status}` };
    }

    const message = extractMessageContent(response.json);
    if (!message) {
      console.warn('Inbox Curator connection test failed to read response message', {
        provider: options.provider,
        endpointUrl,
        model,
        status: response.status,
      });
      return { ok: false, error: 'No response message content.' };
    }

    return { ok: true, message };
  } catch (error) {
    console.warn('Inbox Curator connection test request failed', {
      provider: options.provider,
      endpointUrl,
      model,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return { ok: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}
