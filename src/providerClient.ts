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
