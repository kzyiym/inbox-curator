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
import { isCodexCliRunnable, runCodexExec, type CodexCliSettings } from './codexCli';
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
  codexCli?: {
    settings: CodexCliSettings;
    isUnloaded?: () => boolean;
    background?: boolean;
  };
}

function buildCodexPrompt(messages: ProviderChatMessage[]): string {
  const parts: string[] = [];
  for (const message of messages) {
    const text = messageContentToText(message.content);
    if (!text) continue;
    parts.push(`${message.role.toUpperCase()}:\n${text}`);
  }
  return parts.join('\n\n');
}

function messageContentToText(content: ProviderChatMessageContent): string {
  if (typeof content === 'string') return content;
  return content
    .filter((part): part is ChatContentTextPart => part.type === 'text')
    .map((part) => part.text)
    .join('\n');
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
      return '';
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
    case 'codex-cli':
      return { retryable: false, reason: failure.error };
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
      const codex = request.codexCli;
      if (!codex || !isCodexCliRunnable(codex.settings)) {
        result = { ok: false, error: 'Codex CLI is not enabled. Enable it in settings and accept the consent notice.' };
        break;
      }
      if (codex.background && !codex.settings.allowBackground) {
        result = { ok: false, error: 'Codex CLI background runs are disabled. Enable background runs in settings.' };
        break;
      }
      // Codex CLI model names are unrelated to API model names, so only pass a
      // model when the dedicated Codex model setting is configured. Falling back
      // to the API model would send an unknown model name to Codex.
      const run = await runCodexExec({
        prompt: buildCodexPrompt(request.messages),
        model: codex.settings.model || undefined,
        binaryPath: codex.settings.binaryPath,
        timeoutMs: request.timeoutMs,
        isUnloaded: codex.isUnloaded,
        background: codex.background,
        allowBackground: codex.settings.allowBackground,
      });
      result = run.ok
        ? { ok: true, status: 0, content: run.content }
        : { ok: false, error: run.error };
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
