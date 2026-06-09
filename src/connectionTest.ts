import { detectOpenAiTokenLimitParam, type DetectedOpenAiCompatibleTokenLimitParam, type OpenAiCompatibleTokenLimitParam } from './openAiCompatible';
import { buildProviderChatUrl, postProviderChat } from './providerClient';
import type { InboxCuratorProvider } from './settings';

export interface ConnectionTestOptions {
  provider: InboxCuratorProvider;
  endpointUrl: string;
  model: string;
  apiKey: string;
  timeoutMs?: number;
  openAiTokenLimitParam?: OpenAiCompatibleTokenLimitParam;
}

export interface ConnectionTestSuccess {
  ok: true;
  message: string;
  status: number;
  finalUrl: string;
  requestBody: {
    model: string;
    messages: Array<{ role: 'system' | 'user'; content: string }>;
    temperature?: number;
  };
  detectedTokenLimitParam?: DetectedOpenAiCompatibleTokenLimitParam;
}

export interface ConnectionTestFailure {
  ok: false;
  error: string;
  status?: number;
  responseBody?: string;
  finalUrl: string;
  requestBody: {
    model: string;
    messages: Array<{ role: 'system' | 'user'; content: string }>;
    temperature?: number;
  };
}

export type ConnectionTestResult = ConnectionTestSuccess | ConnectionTestFailure;

export async function testConnection(options: ConnectionTestOptions): Promise<ConnectionTestResult> {
  const finalUrl = buildProviderChatUrl(options.provider, options.endpointUrl);
  const requestBody = {
    model: options.model.trim(),
    messages: [
      { role: 'system' as const, content: 'You are a connection test responder.' },
      { role: 'user' as const, content: 'Reply with OK.' },
    ],
  };

  const response = await postProviderChat({
    provider: options.provider,
    endpointUrl: options.endpointUrl,
    model: options.model,
    apiKey: options.apiKey,
    messages: requestBody.messages,
    timeoutMs: options.timeoutMs,
  });

  if (response.ok === false) {
    return {
      ok: false,
      error: response.error,
      status: response.status,
      responseBody: response.responseBody,
      finalUrl,
      requestBody,
    };
  }

  // Capability detection for OpenAI-compatible when set to auto
  let detectedTokenLimitParam: DetectedOpenAiCompatibleTokenLimitParam | undefined;
  if (options.provider === 'openai-compatible' && (options.openAiTokenLimitParam === 'auto' || options.openAiTokenLimitParam === undefined)) {
    detectedTokenLimitParam = await detectOpenAiTokenLimitParam(
      options.endpointUrl,
      options.model,
      options.apiKey,
      options.timeoutMs,
    );
  }

  return {
    ok: true,
    message: response.content,
    status: response.status,
    finalUrl,
    requestBody,
    detectedTokenLimitParam,
  };
}
