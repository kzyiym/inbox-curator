import {
  buildChatCompletionsUrl,
  classifyOpenAiCompatibleFailure,
  postOpenAiCompatibleChat,
  type OpenAiCompatibleChatFailure,
} from './openAiCompatible';
import type { InboxCuratorProvider } from './settings';
import { postGeminiChat } from './gemini';
import { postAnthropicChat } from './anthropic';
import { isImageNotSupportedErrorText } from './providerErrorClassifier';
import { sanitizeSensitiveData } from './utils/sensitiveData';
import { runCodexReview } from './codexRunner';

export interface ChatContentTextPart {
  type: 'text';
  text: string;
}

export interface ChatContentImagePart {
  type: 'image_url';
  image_url: {
    url: string; // "data:image/jpeg;base64,..."
  };
}

export type ChatContentPart = ChatContentTextPart | ChatContentImagePart;
export type ProviderChatMessageContent = string | ChatContentPart[];

export interface CodexChatOptions {
  consentAccepted: boolean;
  executablePath?: string;
  model?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface ProviderChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: ProviderChatMessageContent;
}

export interface ProviderChatRequest {
  provider: InboxCuratorProvider;
  endpointUrl: string;
  model: string;
  apiKey: string;
  messages: ProviderChatMessage[];
  temperature?: number;
  timeoutMs?: number;
  maxOutputTokens?: number;
  openAiTokenLimitParam?: 'max_tokens' | 'max_completion_tokens' | 'none';
  codexCli?: CodexChatOptions;
}

export interface ProviderChatSuccess {
  ok: true;
  status: number;
  content: string;
}

export interface ProviderChatFailure {
  ok: false;
  error: string;
  status?: number;
  responseBody?: string;
}

export type ProviderChatResult = ProviderChatSuccess | ProviderChatFailure;

export interface ProviderRetryHint {
  retryable: boolean;
  reason?: string;
}

export function buildProviderChatUrl(provider: InboxCuratorProvider, endpointUrl: string): string {
  const base = endpointUrl.replace(/\/$/, '');
  switch (provider) {
    case 'openai-compatible':
      return buildChatCompletionsUrl(endpointUrl);
    case 'gemini-native':
      return `${base}/v1beta/models`;
    case 'anthropic-native':
      return `${base}/v1/messages`;
    case 'codex-cli':
      return 'codex-cli://local';
    default: {
      const unsupportedProvider: never = provider;
      return unsupportedProvider;
    }
  }
}

export function classifyProviderFailure(provider: InboxCuratorProvider, failure: ProviderChatFailure): ProviderRetryHint {
  switch (provider) {
    case 'openai-compatible':
      return classifyOpenAiCompatibleFailure(failure as OpenAiCompatibleChatFailure);
    case 'gemini-native':
    case 'anthropic-native': {
      const status = failure.status;
      if (isImageNotSupportedErrorText(failure.responseBody)) {
        return { retryable: false, reason: 'image_not_supported' };
      }
      if (!status) {
        return { retryable: true, reason: 'Network error or timeout' };
      }
      if (status === 429) {
        return { retryable: true, reason: 'Rate limit reached' };
      }
      if (status >= 500) {
        return { retryable: true, reason: 'Server error' };
      }
      return { retryable: false, reason: `HTTP ${status}` };
    }
    case 'codex-cli': {
      const code = failure.responseBody;
      if (code === 'usage_limit' || code === 'timeout') {
        return { retryable: true, reason: code };
      }
      return { retryable: false, reason: code ?? failure.error };
    }
    default: {
      const unsupportedProvider: never = provider;
      return unsupportedProvider;
    }
  }
}

export async function postProviderChat(request: ProviderChatRequest): Promise<ProviderChatResult> {
  let result: ProviderChatResult;
  switch (request.provider) {
    case 'openai-compatible':
      result = await postOpenAiCompatibleChat({
        endpointUrl: request.endpointUrl,
        model: request.model,
        apiKey: request.apiKey,
        messages: request.messages,
        temperature: request.temperature,
        timeoutMs: request.timeoutMs,
        maxOutputTokens: request.maxOutputTokens,
        tokenLimitParam: request.openAiTokenLimitParam,
      });
      break;
    case 'gemini-native':
      result = await postGeminiChat({
        endpointUrl: request.endpointUrl,
        model: request.model,
        apiKey: request.apiKey,
        messages: request.messages,
        temperature: request.temperature,
        timeoutMs: request.timeoutMs,
        maxOutputTokens: request.maxOutputTokens,
      });
      break;
    case 'anthropic-native':
      result = await postAnthropicChat({
        endpointUrl: request.endpointUrl,
        model: request.model,
        apiKey: request.apiKey,
        messages: request.messages,
        temperature: request.temperature,
        timeoutMs: request.timeoutMs,
        maxOutputTokens: request.maxOutputTokens,
      });
      break;
    case 'codex-cli': {
      const reviewResult = await runCodexReview({
        messages: request.messages,
        consentAccepted: request.codexCli?.consentAccepted === true,
        executablePath: request.codexCli?.executablePath,
        model: request.codexCli?.model || undefined,
        timeoutMs: request.codexCli?.timeoutMs ?? request.timeoutMs,
        signal: request.codexCli?.signal,
      });
      if (reviewResult.ok) {
        result = { ok: true, status: 200, content: reviewResult.content };
      } else {
        result = { ok: false, error: reviewResult.error, responseBody: reviewResult.responseBody };
      }
      break;
    }
    default: {
      const unsupportedProvider: never = request.provider;
      return unsupportedProvider;
    }
  }

  return maskBase64(result);
}

export function maskBase64<T>(value: T): T {
  return sanitizeSensitiveData(value);
}
