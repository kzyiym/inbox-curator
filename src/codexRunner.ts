import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execCodex, execCodexLoginStatus, resolveCodexExecutable, type CodexFailureCode } from './codexCli';
import type { ProviderChatMessage } from './providerClient';

export interface CodexReviewOptions {
  messages: ProviderChatMessage[];
  consentAccepted: boolean;
  executablePath?: string;
  model?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}

export type CodexReviewResult =
  | { ok: true; content: string }
  | { ok: false; error: string; responseBody: string };

export interface CodexConnectionResult {
  ok: boolean;
  error: string;
  executablePath?: string;
}

const CODEX_FAILURE_TEXT: Record<CodexFailureCode, string> = {
  not_installed: 'Codex CLI executable was not found.',
  not_logged_in: 'Codex CLI is not logged in.',
  usage_limit: 'Codex usage limit reached.',
  auth_expired: 'Codex CLI authentication expired.',
  timeout: 'Codex CLI timed out.',
  aborted: 'Codex CLI execution was cancelled.',
  invalid_output: 'Codex CLI returned no review output.',
  unknown: 'Codex CLI execution failed.',
};

export function flattenMessagesToPrompt(messages: ProviderChatMessage[]): string {
  const sections: string[] = [];
  for (const message of messages) {
    const text =
      typeof message.content === 'string'
        ? message.content
        : message.content
            .filter((part) => part.type === 'text')
            .map((part) => part.text)
            .join('\n');
    if (!text) {
      continue;
    }
    sections.push(`[${message.role}]\n${text}`);
  }
  return sections.join('\n\n');
}

function createIsolatedDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'inbox-curator-codex-'));
  return {
    dir,
    cleanup: () => {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        void 0;
      }
    },
  };
}

async function resolveChatGptLogin(executablePath: string, options: {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}): Promise<{ ok: true } | { ok: false; error: string; responseBody: string }> {
  const login = await execCodexLoginStatus({
    executablePath,
    env: options.env,
    platform: options.platform,
    timeoutMs: 20000,
  });
  if (login.ok) {
    return { ok: true };
  }
  if (login.mode === 'api_key') {
    return {
      ok: false,
      error: 'Codex CLI is authenticated with an API key; a ChatGPT login is required.',
      responseBody: 'api_key_mode',
    };
  }
  if (login.mode === 'not_logged_in') {
    return { ok: false, error: 'Codex CLI is not logged in.', responseBody: 'not_logged_in' };
  }
  return {
    ok: false,
    error: 'Codex CLI login status could not be verified as a ChatGPT login.',
    responseBody: 'unknown',
  };
}

export async function runCodexReview(options: CodexReviewOptions): Promise<CodexReviewResult> {
  if (!options.consentAccepted) {
    return {
      ok: false,
      error: 'Codex CLI provider consent has not been accepted.',
      responseBody: 'consent_required',
    };
  }

  const executablePath = resolveCodexExecutable({ manualPath: options.executablePath });
  if (!executablePath) {
    return { ok: false, error: CODEX_FAILURE_TEXT.not_installed, responseBody: 'not_installed' };
  }

  const loginResult = await resolveChatGptLogin(executablePath, {
    env: options.env,
    platform: options.platform,
  });
  if (!loginResult.ok) {
    return loginResult;
  }

  const isolated = createIsolatedDir();
  const prompt = flattenMessagesToPrompt(options.messages);
  try {
    const result = await execCodex({
      executablePath,
      prompt,
      cwd: isolated.dir,
      env: options.env,
      platform: options.platform,
      timeoutMs: options.timeoutMs,
      signal: options.signal,
      model: options.model,
    });

    if (!result.ok) {
      const code = result.errorCode ?? 'unknown';
      return { ok: false, error: CODEX_FAILURE_TEXT[code], responseBody: code };
    }

    if (!result.finalMessage || result.finalMessage.trim().length === 0) {
      return { ok: false, error: CODEX_FAILURE_TEXT.invalid_output, responseBody: 'invalid_output' };
    }

    return { ok: true, content: result.finalMessage };
  } finally {
    isolated.cleanup();
  }
}

export async function checkCodexCliConnection(options: {
  executablePath?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}): Promise<CodexConnectionResult> {
  const executablePath = resolveCodexExecutable({ manualPath: options.executablePath });
  if (!executablePath) {
    return { ok: false, error: CODEX_FAILURE_TEXT.not_installed };
  }

  const loginResult = await resolveChatGptLogin(executablePath, {
    env: options.env,
    platform: options.platform,
  });
  if (!loginResult.ok) {
    return { ok: false, error: loginResult.error };
  }

  return { ok: true, error: '', executablePath };
}
