import { requestUrl } from 'obsidian';
import { isMaskedApiKeyValue } from './secrets';

export interface OpenAiCompatibleMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OpenAiCompatibleChatRequest {
  endpointUrl: string;
  model: string;
  apiKey: string;
  messages: OpenAiCompatibleMessage[];
  temperature?: number;
}

export interface OpenAiCompatibleChatSuccess {
  ok: true;
  status: number;
  content: string;
}

export interface OpenAiCompatibleChatFailure {
  ok: false;
  status?: number;
  error: string;
  responseBody?: string;
}

export type OpenAiCompatibleChatResult = OpenAiCompatibleChatSuccess | OpenAiCompatibleChatFailure;

export function normalizeEndpointUrl(endpointUrl: string): string {
  return endpointUrl.trim().replace(/\/+$/, '');
}

export function buildChatCompletionsUrl(endpointUrl: string): string {
  return `${normalizeEndpointUrl(endpointUrl)}/chat/completions`;
}

function sanitizeErrorText(value: string | undefined, maxLength = 240): string | undefined {
  const normalized = value?.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return undefined;
  }

  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength)}…`;
}

function extractResponseText(payload: unknown): string | null {
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
  if (typeof content === 'string' && content.trim() !== '') {
    return content.trim();
  }

  if (Array.isArray(content)) {
    const text = content
      .map((part) => {
        if (!part || typeof part !== 'object') {
          return '';
        }

        const textPart = (part as { text?: unknown }).text;
        return typeof textPart === 'string' ? textPart : '';
      })
      .join('')
      .trim();

    return text || null;
  }

  return null;
}

export async function postOpenAiCompatibleChat(request: OpenAiCompatibleChatRequest): Promise<OpenAiCompatibleChatResult> {
  const endpointUrl = normalizeEndpointUrl(request.endpointUrl);
  const model = request.model.trim();
  const apiKey = request.apiKey.trim();

  if (!endpointUrl) {
    return { ok: false, error: 'Endpoint URL is required.' };
  }

  if (!model) {
    return { ok: false, error: 'Model is required.' };
  }

  if (!apiKey || isMaskedApiKeyValue(apiKey)) {
    return { ok: false, error: 'A real API key is required.' };
  }

  const url = buildChatCompletionsUrl(endpointUrl);

  try {
    const response = await requestUrl({
      url,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: request.messages,
        temperature: request.temperature ?? 0,
      }),
      throw: false,
    });

    if (response.status < 200 || response.status >= 300) {
      return {
        ok: false,
        status: response.status,
        error: `HTTP ${response.status}`,
        responseBody: sanitizeErrorText(response.text),
      };
    }

    const content = extractResponseText(response.json);
    if (!content) {
      return {
        ok: false,
        status: response.status,
        error: 'Missing response message content.',
        responseBody: sanitizeErrorText(response.text),
      };
    }

    return {
      ok: true,
      status: response.status,
      content,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown request failure.',
    };
  }
}
