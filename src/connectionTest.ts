import {
  detectOpenAiTokenLimitParam,
  openAiCompatibleEndpointError,
  validateOpenAiCompatibleEndpoint,
  type DetectedOpenAiCompatibleTokenLimitParam,
  type OpenAiCompatibleTokenLimitParam,
} from './openAiCompatible';
import { buildProviderChatUrl, postProviderChat } from './providerClient';
import { CODEX_CLI_NOT_FOUND_MESSAGE, getCodexLoginStatus, type CodexCliSettings } from './codexCli';
import type { InboxCuratorProvider } from './settings';

export interface ConnectionTestOptions {
  provider: InboxCuratorProvider;
  endpointUrl: string;
  model: string;
  apiKey: string;
  timeoutMs?: number;
  openAiTokenLimitParam?: OpenAiCompatibleTokenLimitParam;
  codexCli?: CodexCliSettings;
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

  if (options.provider === 'codex-cli') {
    const codex = options.codexCli;
    if (!codex || !codex.enabled || !codex.consentAcknowledged) {
      return { ok: false, error: 'Codex CLI is not enabled in settings.', finalUrl, requestBody };
    }
    const status = await getCodexLoginStatus(codex.binaryPath || undefined);
    if (!status.ok) {
      return {
        ok: false,
        error: status.authMode === 'unavailable'
          ? CODEX_CLI_NOT_FOUND_MESSAGE
          : status.authMode === 'api-key'
            ? 'Codex CLI is authenticated with an API key. ChatGPT login is required.'
            : 'Codex CLI is not logged in with ChatGPT.',
        finalUrl,
        requestBody,
      };
    }
    return { ok: true, message: 'Codex CLI: logged in using ChatGPT.', status: 0, finalUrl, requestBody };
  }

  if (options.provider === 'openai-compatible') {
    const validation = validateOpenAiCompatibleEndpoint(options.endpointUrl);
    if (!validation.ok) {
      return {
        ok: false,
        error: openAiCompatibleEndpointError(validation.reason),
        finalUrl,
        requestBody,
      };
    }
  }

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
