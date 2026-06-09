import { requestUrl } from 'obsidian';
import { isMaskedApiKeyValue } from './secrets';
import { isImageNotSupportedErrorText } from './providerErrorClassifier';

export type OpenAiCompatibleTokenLimitParam = 'auto' | 'max_tokens' | 'max_completion_tokens' | 'none';
export type DetectedOpenAiCompatibleTokenLimitParam = 'max_tokens' | 'max_completion_tokens' | 'none' | 'unknown';

export function resolveOpenAiTokenLimitParam(
  setting: OpenAiCompatibleTokenLimitParam,
  detected: DetectedOpenAiCompatibleTokenLimitParam,
): 'max_tokens' | 'max_completion_tokens' | 'none' {
  if (setting === 'auto') {
    if (detected === 'max_tokens' || detected === 'max_completion_tokens') {
      return detected;
    }
    return 'none';
  }
  if (setting === 'max_tokens' || setting === 'max_completion_tokens' || setting === 'none') {
    return setting;
  }
  return 'none';
}

export function normalizeEndpointUrl(endpointUrl: string): string {
  return endpointUrl.trim().replace(/\/+$/, '');
}

export function normalizeEndpointForDetectionKey(endpoint: string): string {
  const trimmed = endpoint.trim();
  if (!trimmed) return '';

  try {
    const url = new URL(trimmed);
    url.hash = '';
    url.search = '';
    url.pathname = url.pathname.replace(/\/+$/, '');
    const result = url.toString().replace(/\/+$/, '');
    return result;
  } catch {
    return trimmed.replace(/\/+$/, '');
  }
}

/**
 * Builds a stable detection key from endpoint URL + model.
 * Does NOT include API key. Changing endpoint or model produces a different key.
 * Normalizes trailing slashes, query params, and hash fragments in the endpoint URL.
 * Trims model name but preserves case (models may be case-sensitive).
 */
export function buildOpenAiCompatibleTokenLimitDetectionKey(endpointUrl: string, model: string): string {
  const normalized = normalizeEndpointForDetectionKey(endpointUrl);
  const modelKeyPart = model.trim();
  return `openai-compatible|${normalized}|${modelKeyPart}`;
}

/**
 * Resolves the effective token limit param for OpenAI-compatible review requests.
 * Respects manual overrides. For auto, validates that the saved detection key matches
 * the current endpoint/model before using the detected value.
 */
export function resolveEffectiveOpenAiTokenLimitParam(
  setting: OpenAiCompatibleTokenLimitParam,
  detected: DetectedOpenAiCompatibleTokenLimitParam,
  detectedKey: string | undefined,
  currentKey: string,
): 'max_tokens' | 'max_completion_tokens' | 'none' {
  if (setting === 'max_tokens') return 'max_tokens';
  if (setting === 'max_completion_tokens') return 'max_completion_tokens';
  if (setting === 'none') return 'none';

  // auto: only use detected value if key matches
  if (detectedKey === currentKey) {
    if (detected === 'max_tokens') return 'max_tokens';
    if (detected === 'max_completion_tokens') return 'max_completion_tokens';
    if (detected === 'none') return 'none';
  }

  return 'none';
}

export function applyOpenAiCompatibleTokenLimit(
  body: Record<string, unknown>,
  maxOutputTokens: number | undefined,
  param: 'max_tokens' | 'max_completion_tokens' | 'none',
): void {
  if (param === 'none' || maxOutputTokens === undefined) {
    return;
  }
  if (param === 'max_tokens') {
    body.max_tokens = maxOutputTokens;
  } else if (param === 'max_completion_tokens') {
    body.max_completion_tokens = maxOutputTokens;
  }
}

export function isUnsupportedParameterError(responseBody: string | undefined, status: number | undefined): boolean {
  if (!responseBody) return false;
  const lower = responseBody.toLowerCase();
  const unsupportedPatterns = [
    'max_tokens is not supported',
    'use max_completion_tokens instead',
    'unsupported parameter',
    'unknown parameter',
    'unknown field',
    'invalid parameter',
    'unrecognized request argument',
    'extra fields not permitted',
    'max_completion_tokens is not supported',
  ];
  for (const pattern of unsupportedPatterns) {
    if (lower.includes(pattern)) return true;
  }
  return false;
}

export function isContextOverflowError(responseBody: string | undefined, status: number | undefined): boolean {
  if (!responseBody) return false;
  const lower = responseBody.toLowerCase();
  return (
    lower.includes('context length') ||
    lower.includes('context length exceeded') ||
    lower.includes('maximum context length') ||
    lower.includes('request exceeds') ||
    lower.includes('too many tokens') ||
    lower.includes('context overflow')
  );
}

const TOKEN_LIMIT_CAPABILITY_TEST_VALUE = 16;

async function sendCapabilityTestRequest(
  endpointUrl: string,
  model: string,
  apiKey: string,
  paramName: string,
  timeoutMs?: number,
): Promise<'success' | 'unsupported' | 'other_error'> {
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
        messages: [
          { role: 'user', content: 'Reply with only: OK' },
        ],
        [paramName]: TOKEN_LIMIT_CAPABILITY_TEST_VALUE,
      }),
      throw: false,
      timeout: timeoutMs ?? 10000,
    } as any);

    if (response.status >= 200 && response.status < 300) {
      return 'success';
    }

    const body = typeof response.text === 'string' ? response.text : '';
    if (isUnsupportedParameterError(body, response.status)) {
      return 'unsupported';
    }

    if (isContextOverflowError(body, response.status)) {
      return 'success';
    }

    return 'other_error';
  } catch {
    return 'other_error';
  }
}

export async function detectOpenAiTokenLimitParam(
  endpointUrl: string,
  model: string,
  apiKey: string,
  timeoutMs?: number,
): Promise<DetectedOpenAiCompatibleTokenLimitParam> {
  const maxTokensResult = await sendCapabilityTestRequest(endpointUrl, model, apiKey, 'max_tokens', timeoutMs);

  if (maxTokensResult === 'success') {
    return 'max_tokens';
  }

  if (maxTokensResult === 'unsupported') {
    const maxCompletionResult = await sendCapabilityTestRequest(endpointUrl, model, apiKey, 'max_completion_tokens', timeoutMs);
    if (maxCompletionResult === 'success') {
      return 'max_completion_tokens';
    }
    return 'none';
  }

  // max_tokens test failed for non-unsupported reason (network, auth, etc.) — inconclusive
  return 'unknown';
}

export interface OpenAiCompatibleTextPart {
  type: 'text';
  text: string;
}

export interface OpenAiCompatibleImagePart {
  type: 'image_url';
  image_url: {
    url: string;
  };
}

export type OpenAiCompatibleContentPart = OpenAiCompatibleTextPart | OpenAiCompatibleImagePart;
export type OpenAiCompatibleMessageContent = string | OpenAiCompatibleContentPart[];

export interface OpenAiCompatibleMessage {
  role: 'system' | 'user' | 'assistant';
  content: OpenAiCompatibleMessageContent;
}

export interface OpenAiCompatibleChatRequest {
  endpointUrl: string;
  model: string;
  apiKey: string;
  messages: OpenAiCompatibleMessage[];
  temperature?: number;
  timeoutMs?: number;
  maxOutputTokens?: number;
  tokenLimitParam?: 'max_tokens' | 'max_completion_tokens' | 'none';
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

export interface OpenAiCompatibleRetryHint {
  retryable: boolean;
  reason?: string;
}

export function classifyOpenAiCompatibleFailure(failure: OpenAiCompatibleChatFailure): OpenAiCompatibleRetryHint {
  const responseText = failure.responseBody?.toLowerCase() ?? '';
  const errorText = failure.error.toLowerCase();

  if (isImageNotSupportedErrorText(responseText)) {
    return { retryable: false, reason: 'image_not_supported' };
  }

  if (failure.status === 429 && responseText.includes('prepayment credits are depleted')) {
    return { retryable: false, reason: 'credits_depleted' };
  }

  if (failure.status !== undefined) {
    if (failure.status === 429 || failure.status === 408 || failure.status === 409) {
      return { retryable: true, reason: `http_${failure.status}` };
    }

    if (failure.status >= 500 && failure.status <= 504) {
      return { retryable: true, reason: `http_${failure.status}` };
    }

    return { retryable: false, reason: `http_${failure.status}` };
  }

  if (/(timeout|timed out|network|econnreset|socket hang up|temporarily unavailable)/i.test(errorText)) {
    return { retryable: true, reason: 'transient_network_error' };
  }

  return { retryable: false, reason: 'non_retryable_request_error' };
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

  const body: Record<string, unknown> = {
    model,
    messages: request.messages,
  };
  applyOpenAiCompatibleTokenLimit(body, request.maxOutputTokens, request.tokenLimitParam ?? 'max_tokens');
  if (request.temperature !== undefined) {
    body.temperature = request.temperature;
  }

  try {
    const response = await requestUrl({
      url,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      throw: false,
      timeout: request.timeoutMs,
    } as any);

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
