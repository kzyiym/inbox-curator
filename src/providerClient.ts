import {
  buildChatCompletionsUrl,
  classifyOpenAiCompatibleFailure,
  postOpenAiCompatibleChat,
  type OpenAiCompatibleChatFailure,
} from './openAiCompatible';
import type { InboxCuratorProvider } from './settings';

export interface ProviderChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ProviderChatRequest {
  provider: InboxCuratorProvider;
  endpointUrl: string;
  model: string;
  apiKey: string;
  messages: ProviderChatMessage[];
  temperature?: number;
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
  switch (provider) {
    case 'openai-compatible':
      return buildChatCompletionsUrl(endpointUrl);
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
    default: {
      const unsupportedProvider: never = provider;
      return unsupportedProvider;
    }
  }
}

export async function postProviderChat(request: ProviderChatRequest): Promise<ProviderChatResult> {
  switch (request.provider) {
    case 'openai-compatible':
      return postOpenAiCompatibleChat({
        endpointUrl: request.endpointUrl,
        model: request.model,
        apiKey: request.apiKey,
        messages: request.messages,
        temperature: request.temperature,
      });
    default: {
      const unsupportedProvider: never = request.provider;
      return unsupportedProvider;
    }
  }
}
