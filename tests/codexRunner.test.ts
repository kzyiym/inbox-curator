import { beforeEach, describe, expect, it, vi } from 'vitest';

const { resolveCodexExecutableMock, execCodexMock, execCodexLoginStatusMock, execCodexVersionMock, classifyCodexFailureMock } = vi.hoisted(() => ({
  resolveCodexExecutableMock: vi.fn(),
  execCodexMock: vi.fn(),
  execCodexLoginStatusMock: vi.fn(),
  execCodexVersionMock: vi.fn(),
  classifyCodexFailureMock: vi.fn(),
}));

vi.mock('../src/codexCli', () => ({
  resolveCodexExecutable: resolveCodexExecutableMock,
  execCodex: execCodexMock,
  execCodexLoginStatus: execCodexLoginStatusMock,
  execCodexVersion: execCodexVersionMock,
  classifyCodexFailure: classifyCodexFailureMock,
}));

import { checkCodexCliConnection, flattenMessagesToPrompt, runCodexReview } from '../src/codexRunner';

const baseReviewOptions = {
  messages: [{ role: 'user' as const, content: 'NOTE_CONTENT_SECRET' }],
  consentAccepted: true,
};

beforeEach(() => {
  resolveCodexExecutableMock.mockReset();
  execCodexMock.mockReset();
  execCodexLoginStatusMock.mockReset();
  execCodexVersionMock.mockReset();
  classifyCodexFailureMock.mockReset();
  resolveCodexExecutableMock.mockReturnValue('/usr/local/bin/codex');
  execCodexVersionMock.mockResolvedValue({ ok: true, version: 'codex-cli 0.157.0', stdout: 'codex-cli 0.157.0', stderr: '', exitCode: 0 });
  execCodexLoginStatusMock.mockResolvedValue({ ok: true, mode: 'chatgpt', stdout: '', stderr: '', exitCode: 0 });
  execCodexMock.mockResolvedValue({ ok: true, exitCode: 0, stdout: '', stderr: '', finalMessage: '{"summary":"ok"}' });
  classifyCodexFailureMock.mockReturnValue('unknown');
});

describe('flattenMessagesToPrompt', () => {
  it('keeps text parts and drops image parts', () => {
    const prompt = flattenMessagesToPrompt([
      { role: 'system', content: 'SYSTEM' },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'USER_TEXT' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
        ],
      },
    ]);

    expect(prompt).toContain('SYSTEM');
    expect(prompt).toContain('USER_TEXT');
    expect(prompt).not.toContain('base64');
    expect(prompt).not.toContain('AAAA');
  });
});

describe('runCodexReview', () => {
  it('refuses to run without explicit consent', async () => {
    const result = await runCodexReview({ ...baseReviewOptions, consentAccepted: false });
    expect(result).toEqual({
      ok: false,
      error: 'Codex CLI provider consent has not been accepted.',
      responseBody: 'consent_required',
    });
    expect(resolveCodexExecutableMock).not.toHaveBeenCalled();
    expect(execCodexMock).not.toHaveBeenCalled();
  });

  it('fails safely when the CLI is not installed', async () => {
    resolveCodexExecutableMock.mockReturnValue(null);
    const result = await runCodexReview({ ...baseReviewOptions, executablePath: '/missing/codex' });
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.responseBody).toBe('not_installed');
    expect(execCodexMock).not.toHaveBeenCalled();
  });

  it('refuses API-key authentication', async () => {
    execCodexLoginStatusMock.mockResolvedValue({ ok: false, mode: 'api_key', stdout: '', stderr: '', exitCode: 0 });
    const result = await runCodexReview(baseReviewOptions);
    expect(result.ok ? '' : result.responseBody).toBe('api_key_mode');
    expect(execCodexMock).not.toHaveBeenCalled();
  });

  it('reports not logged in', async () => {
    execCodexLoginStatusMock.mockResolvedValue({ ok: false, mode: 'not_logged_in', stdout: '', stderr: '', exitCode: 126 });
    const result = await runCodexReview(baseReviewOptions);
    expect(result.ok ? '' : result.responseBody).toBe('not_logged_in');
  });

  it('passes the note body in the prompt and returns structured content', async () => {
    const result = await runCodexReview(baseReviewOptions);
    expect(result).toEqual({ ok: true, content: '{"summary":"ok"}' });

    const call = execCodexMock.mock.calls[0][0] as Record<string, unknown>;
    expect(call.executablePath).toBe('/usr/local/bin/codex');
    expect(String(call.prompt)).toContain('NOTE_CONTENT_SECRET');
    expect(typeof call.cwd).toBe('string');
    expect(call.cwd).not.toContain('vault');
  });

  it('maps an empty final message to invalid_output', async () => {
    execCodexMock.mockResolvedValue({ ok: true, exitCode: 0, stdout: '', stderr: '', finalMessage: '' });
    const result = await runCodexReview(baseReviewOptions);
    expect(result.ok ? '' : result.responseBody).toBe('invalid_output');
  });

  it('maps execution failure codes', async () => {
    execCodexMock.mockResolvedValue({ ok: false, exitCode: null, stdout: '', stderr: '', errorCode: 'timeout' });
    const result = await runCodexReview(baseReviewOptions);
    expect(result.ok ? '' : result.responseBody).toBe('timeout');
    expect(result.ok ? '' : result.error).toContain('Codex CLI timed out.');
  });
});

describe('checkCodexCliConnection', () => {
  it('reports runtime_missing when the version probe fails', async () => {
    execCodexVersionMock.mockResolvedValue({
      ok: false,
      version: undefined,
      stdout: '',
      stderr: 'env: node: No such file or directory',
      exitCode: 127,
    });
    classifyCodexFailureMock.mockReturnValue('runtime_missing');

    const result = await checkCodexCliConnection({});
    expect(result.ok).toBe(false);
    expect(result.error).toContain('runtime');
    expect(execCodexLoginStatusMock).not.toHaveBeenCalled();
  });

  it('returns ok with the version when ChatGPT login is confirmed', async () => {
    const result = await checkCodexCliConnection({});
    expect(result.ok).toBe(true);
    expect(result.version).toBe('codex-cli 0.157.0');
  });
});
