import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
  default: { spawn: spawnMock },
}));

import {
  buildCodexArgs,
  buildCodexLoginArgs,
  buildSpawnInvocation,
  classifyCodexFailure,
  execCodex,
  execCodexLoginStatus,
  getCodexExecutableNames,
  getCodexSearchDirs,
  getProcessTreeKillPlan,
  parseCodexJsonlFinalMessage,
  parseCodexLoginStatus,
  parseCodexStructuredOutput,
  resolveCodexExecutable,
  scrubCodexEnv,
} from '../src/codexCli';

class FakeChild extends EventEmitter {
  pid: number;
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  stdin = { end: vi.fn(), destroy: vi.fn() };
  kill = vi.fn();
  constructor(pid = 4242) {
    super();
    this.pid = pid;
  }
}

function jsonlAgentMessage(text: string): string {
  return `${JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text } })}\n`;
}

beforeEach(() => {
  spawnMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('scrubCodexEnv', () => {
  it('removes API-key based auth variables while preserving CODEX_HOME and other settings', () => {
    const base = {
      PATH: '/usr/bin',
      CODEX_HOME: '/home/user/.codex',
      OPENAI_API_KEY: 'sk-openai-secret',
      CODEX_API_KEY: 'codex-api-secret',
      CODEX_ACCESS_TOKEN: 'access-token-secret',
    };

    const scrubbed = scrubCodexEnv(base);

    expect(scrubbed.OPENAI_API_KEY).toBeUndefined();
    expect(scrubbed.CODEX_API_KEY).toBeUndefined();
    expect(scrubbed.CODEX_ACCESS_TOKEN).toBeUndefined();
    expect(scrubbed.CODEX_HOME).toBe('/home/user/.codex');
    expect(scrubbed.PATH).toBe('/usr/bin');
    expect(base.OPENAI_API_KEY).toBe('sk-openai-secret');
  });
});

describe('buildCodexArgs', () => {
  it('uses read-only sandbox, skips the git repo check, is ephemeral, and never passes the note body', () => {
    const args = buildCodexArgs({});

    expect(args).toEqual([
      'exec',
      '--sandbox',
      'read-only',
      '--skip-git-repo-check',
      '--ephemeral',
      '--ignore-user-config',
      '--ignore-rules',
      '--json',
      '-',
    ]);
    expect(args).not.toContain('--full-auto');
    expect(args.join(' ')).not.toContain('NOTE_BODY_SECRET');
  });

  it('appends model, schema, and last-message options before the stdin sentinel', () => {
    const args = buildCodexArgs({
      model: 'gpt-5-codex',
      outputSchemaPath: '/tmp/schema.json',
      outputLastMessagePath: '/tmp/last.json',
    });

    expect(args).toEqual([
      'exec',
      '--sandbox',
      'read-only',
      '--skip-git-repo-check',
      '--ephemeral',
      '--ignore-user-config',
      '--ignore-rules',
      '--json',
      '--model',
      'gpt-5-codex',
      '--output-schema',
      '/tmp/schema.json',
      '-o',
      '/tmp/last.json',
      '-',
    ]);
  });

  it('omits json events when disabled', () => {
    expect(buildCodexArgs({ jsonEvents: false })).not.toContain('--json');
  });
});

describe('buildSpawnInvocation', () => {
  it('routes Windows batch shims through cmd.exe without a shell string', () => {
    expect(buildSpawnInvocation('C:\\bin\\codex.cmd', ['exec', '-'], 'win32', 'C:\\Windows\\System32\\cmd.exe')).toEqual({
      command: 'C:\\Windows\\System32\\cmd.exe',
      args: ['/d', '/s', '/c', 'C:\\bin\\codex.cmd', 'exec', '-'],
    });
  });

  it('spawns native executables directly', () => {
    expect(buildSpawnInvocation('C:\\bin\\codex.exe', ['exec', '-'], 'win32')).toEqual({
      command: 'C:\\bin\\codex.exe',
      args: ['exec', '-'],
    });
    expect(buildSpawnInvocation('/usr/local/bin/codex', ['exec', '-'], 'linux')).toEqual({
      command: '/usr/local/bin/codex',
      args: ['exec', '-'],
    });
  });
});

describe('getProcessTreeKillPlan', () => {
  it('plans a taskkill tree termination on Windows', () => {
    expect(getProcessTreeKillPlan(4242, 'win32', 'C:\\Windows\\System32\\cmd.exe')).toEqual({
      command: 'C:\\Windows\\System32\\cmd.exe',
      args: ['/d', '/s', '/c', 'taskkill', '/pid', '4242', '/T', '/F'],
    });
  });

  it('uses the default signal on other platforms', () => {
    expect(getProcessTreeKillPlan(4242, 'linux')).toBeNull();
    expect(getProcessTreeKillPlan(4242, 'darwin')).toBeNull();
  });
});

describe('resolveCodexExecutable', () => {
  it('honors an explicit manual path', () => {
    expect(resolveCodexExecutable({ manualPath: '/custom/codex', fileExists: () => true })).toBe('/custom/codex');
  });

  it('rejects a PowerShell script and a missing manual path', () => {
    expect(resolveCodexExecutable({ manualPath: 'C:\\bin\\codex.ps1', fileExists: () => true })).toBeNull();
    expect(resolveCodexExecutable({ manualPath: '/missing/codex', fileExists: () => false })).toBeNull();
  });

  it('searches POSIX install locations and PATH', () => {
    const env = { PATH: '/a:/b' };
    const target = '/b/codex';
    const found = resolveCodexExecutable({
      env,
      platform: 'linux',
      homeDir: '/home/user',
      fileExists: (path) => path === target,
    });
    expect(found).toBe(target);
  });

  it('searches the npm global directory on Windows', () => {
    const env = { PATH: 'C:\\other', APPDATA: 'C:\\Users\\user\\AppData\\Roaming' };
    const target = 'C:\\Users\\user\\AppData\\Roaming\\npm\\codex.cmd';
    const found = resolveCodexExecutable({
      env,
      platform: 'win32',
      homeDir: 'C:\\Users\\user',
      fileExists: (path) => path === target,
    });
    expect(found).toBe(target);
  });

  it('returns null when nothing is found', () => {
    expect(resolveCodexExecutable({ env: { PATH: '/nothing' }, platform: 'linux', homeDir: '/home/u', fileExists: () => false })).toBeNull();
  });

  it('exposes platform-specific executable names', () => {
    expect(getCodexExecutableNames('win32')).toEqual(['codex.exe', 'codex.cmd', 'codex.bat']);
    expect(getCodexExecutableNames('linux')).toEqual(['codex']);
  });

  it('includes known install directories even without PATH entries', () => {
    const dirs = getCodexSearchDirs({}, 'linux', '/home/user');
    expect(dirs).toContain('/home/user/.local/bin');
    expect(dirs).toContain('/opt/homebrew/bin');
    expect(dirs).toContain('/usr/local/bin');
  });
});

describe('parseCodexJsonlFinalMessage', () => {
  it('returns the last completed agent message and ignores malformed lines', () => {
    const stdout = [
      '{"type":"thread.started","thread_id":"abc"}',
      'not-json progress line',
      '{"type":"item.completed","item":{"type":"reasoning","text":"thinking"}}',
      '{"type":"item.completed","item":{"type":"agent_message","text":"{\\"summary\\":\\"first\\"}"}}',
      '{"type":"item.completed","item":{"type":"agent_message","text":"{\\"summary\\":\\"final\\"}"}}',
      '',
    ].join('\n');

    expect(parseCodexJsonlFinalMessage(stdout)).toBe('{"summary":"final"}');
  });

  it('handles CRLF and returns undefined when no agent message exists', () => {
    expect(parseCodexJsonlFinalMessage('{"type":"turn.completed"}\r\n')).toBeUndefined();
  });
});

describe('parseCodexStructuredOutput', () => {
  it('parses a JSON object', () => {
    expect(parseCodexStructuredOutput('{"summary":"ok"}')).toEqual({ summary: 'ok' });
  });

  it('returns undefined for invalid or missing output', () => {
    expect(parseCodexStructuredOutput('not json')).toBeUndefined();
    expect(parseCodexStructuredOutput(undefined)).toBeUndefined();
  });
});

describe('classifyCodexFailure', () => {
  it('classifies timeout and abort first', () => {
    expect(classifyCodexFailure({ exitCode: null, stderr: 'usage limit reached', timedOut: true })).toBe('timeout');
    expect(classifyCodexFailure({ exitCode: null, stderr: '', aborted: true })).toBe('aborted');
  });

  it('classifies install, login, quota, and auth failures', () => {
    expect(classifyCodexFailure({ exitCode: 127, stderr: 'codex: command not found' })).toBe('not_installed');
    expect(classifyCodexFailure({ exitCode: 1, stderr: 'Not logged in. Please run codex login.' })).toBe('not_logged_in');
    expect(classifyCodexFailure({ exitCode: 1, stderr: 'You have reached your usage limit.' })).toBe('usage_limit');
    expect(classifyCodexFailure({ exitCode: 1, stderr: 'Your authentication token has expired.' })).toBe('auth_expired');
    expect(
      classifyCodexFailure({ exitCode: 126, stderr: '401 Unauthorized: Missing bearer or basic authentication in header' }),
    ).toBe('not_logged_in');
  });

  it('falls back to unknown', () => {
    expect(classifyCodexFailure({ exitCode: 3, stderr: 'unexpected boom' })).toBe('unknown');
  });
});

describe('execCodex', () => {
  it('passes the note body through stdin only, never through argv, and scrubs auth env', async () => {
    const child = new FakeChild();
    spawnMock.mockReturnValue(child as any);

    const promise = execCodex({
      executablePath: '/usr/local/bin/codex',
      prompt: 'NOTE_BODY_SECRET',
      cwd: '/tmp/inbox-curator-iso',
      platform: 'linux',
      env: { PATH: '/usr/bin', OPENAI_API_KEY: 'sk-should-be-removed' },
    });

    expect(child.stdin.end).toHaveBeenCalledWith('NOTE_BODY_SECRET');
    const [command, args, spawnOptions] = spawnMock.mock.calls[0] as [string, string[], Record<string, any>];
    expect(command).toBe('/usr/local/bin/codex');
    expect(args.join(' ')).not.toContain('NOTE_BODY_SECRET');
    expect(spawnOptions.shell).toBe(false);
    expect(spawnOptions.cwd).toBe('/tmp/inbox-curator-iso');
    expect(spawnOptions.env.OPENAI_API_KEY).toBeUndefined();

    child.stdout.emit('data', jsonlAgentMessage('{"summary":"ok"}'));
    child.emit('close', 0);

    const result = await promise;
    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.finalMessage).toBe('{"summary":"ok"}');
  });

  it('routes Windows .cmd shims through cmd.exe instead of spawning them directly', async () => {
    const child = new FakeChild();
    spawnMock.mockReturnValue(child as any);

    const promise = execCodex({
      executablePath: 'C:\\Users\\user\\AppData\\Local\\Volta\\bin\\codex.cmd',
      prompt: 'body',
      cwd: 'C:\\tmp\\iso',
      platform: 'win32',
      env: { ComSpec: 'C:\\Windows\\System32\\cmd.exe' },
    });

    const [command, args] = spawnMock.mock.calls[0] as [string, string[]];
    expect(command).toBe('C:\\Windows\\System32\\cmd.exe');
    expect(args.slice(0, 4)).toEqual([
      '/d',
      '/s',
      '/c',
      'C:\\Users\\user\\AppData\\Local\\Volta\\bin\\codex.cmd',
    ]);
    expect(args).toContain('exec');

    child.emit('close', 0);
    const result = await promise;
    expect(result.ok).toBe(true);
  });

  it('classifies a non-zero exit from stderr', async () => {
    const child = new FakeChild();
    spawnMock.mockReturnValue(child as any);

    const promise = execCodex({
      executablePath: '/usr/local/bin/codex',
      prompt: 'body',
      cwd: '/tmp/iso',
      platform: 'linux',
    });

    child.stderr.emit('data', 'Not logged in. Please run codex login.');
    child.emit('close', 1);

    const result = await promise;
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('not_logged_in');
  });

  it('reports not_installed when spawn throws', async () => {
    spawnMock.mockImplementation(() => {
      throw new Error('ENOENT');
    });

    const result = await execCodex({
      executablePath: '/missing/codex',
      prompt: 'body',
      cwd: '/tmp/iso',
      platform: 'linux',
    });

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('not_installed');
  });

  it('reports not_installed on a child error event', async () => {
    const child = new FakeChild();
    spawnMock.mockReturnValue(child as any);

    const promise = execCodex({ executablePath: '/usr/bin/codex', prompt: 'body', cwd: '/tmp/iso', platform: 'linux' });
    child.emit('error', new Error('spawn ENOENT'));

    const result = await promise;
    expect(result.errorCode).toBe('not_installed');
  });

  it('kills the child and reports timeout when the deadline passes', async () => {
    vi.useFakeTimers();
    const child = new FakeChild();
    spawnMock.mockReturnValue(child as any);

    const promise = execCodex({
      executablePath: '/usr/bin/codex',
      prompt: 'body',
      cwd: '/tmp/iso',
      platform: 'linux',
      timeoutMs: 500,
    });

    await vi.advanceTimersByTimeAsync(500);
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');

    child.emit('close', null);
    const result = await promise;
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('timeout');
  });

  it('uses taskkill to end the process tree on Windows timeouts', async () => {
    vi.useFakeTimers();
    const child = new FakeChild();
    const killer = new EventEmitter();
    spawnMock.mockReturnValueOnce(child as any).mockReturnValueOnce(killer as any);

    const promise = execCodex({
      executablePath: 'C:\\bin\\codex.exe',
      prompt: 'body',
      cwd: 'C:\\tmp\\iso',
      platform: 'win32',
      timeoutMs: 300,
      env: { ComSpec: 'C:\\Windows\\System32\\cmd.exe' },
    });

    await vi.advanceTimersByTimeAsync(300);
    expect(spawnMock).toHaveBeenCalledTimes(2);
    const [killCommand, killArgs] = spawnMock.mock.calls[1] as [string, string[]];
    expect(killCommand).toBe('C:\\Windows\\System32\\cmd.exe');
    expect(killArgs).toEqual(['/d', '/s', '/c', 'taskkill', '/pid', '4242', '/T', '/F']);

    child.emit('close', null);
    const result = await promise;
    expect(result.errorCode).toBe('timeout');
  });

  it('aborts on the provided signal', async () => {
    const controller = new AbortController();
    const child = new FakeChild();
    spawnMock.mockReturnValue(child as any);

    const promise = execCodex({
      executablePath: '/usr/bin/codex',
      prompt: 'body',
      cwd: '/tmp/iso',
      platform: 'linux',
      signal: controller.signal,
    });

    controller.abort();
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');

    child.emit('close', null);
    const result = await promise;
    expect(result.errorCode).toBe('aborted');
  });
});

describe('parseCodexLoginStatus', () => {
  it('recognizes ChatGPT, API key, and logged-out states', () => {
    expect(parseCodexLoginStatus('Logged in using ChatGPT')).toBe('chatgpt');
    expect(parseCodexLoginStatus('Logged in using an API key')).toBe('api_key');
    expect(parseCodexLoginStatus('Not logged in')).toBe('not_logged_in');
    expect(parseCodexLoginStatus('something unexpected')).toBe('unknown');
  });
});

describe('execCodexLoginStatus', () => {
  it('runs "login status" without an API key and confirms ChatGPT', async () => {
    const child = new FakeChild();
    spawnMock.mockReturnValue(child as any);

    const promise = execCodexLoginStatus({
      executablePath: '/usr/local/bin/codex',
      platform: 'linux',
      env: { PATH: '/usr/bin', OPENAI_API_KEY: 'sk-should-be-removed' },
    });

    const [command, args, spawnOptions] = spawnMock.mock.calls[0] as [string, string[], Record<string, any>];
    expect(command).toBe('/usr/local/bin/codex');
    expect(args).toEqual(buildCodexLoginArgs());
    expect(spawnOptions.env.OPENAI_API_KEY).toBeUndefined();

    child.stdout.emit('data', 'Logged in using ChatGPT\n');
    child.emit('close', 0);

    const result = await promise;
    expect(result.ok).toBe(true);
    expect(result.mode).toBe('chatgpt');
    expect(result.exitCode).toBe(0);
  });

  it('rejects API key authentication', async () => {
    const child = new FakeChild();
    spawnMock.mockReturnValue(child as any);

    const promise = execCodexLoginStatus({ executablePath: '/usr/bin/codex', platform: 'linux' });
    child.stdout.emit('data', 'Logged in using an API key\n');
    child.emit('close', 0);

    const result = await promise;
    expect(result.ok).toBe(false);
    expect(result.mode).toBe('api_key');
  });

  it('routes Windows .cmd shims through cmd.exe', async () => {
    const child = new FakeChild();
    spawnMock.mockReturnValue(child as any);

    const promise = execCodexLoginStatus({
      executablePath: 'C:\\Volta\\bin\\codex.cmd',
      platform: 'win32',
      env: { ComSpec: 'C:\\Windows\\System32\\cmd.exe' },
    });

    const [command, args] = spawnMock.mock.calls[0] as [string, string[]];
    expect(command).toBe('C:\\Windows\\System32\\cmd.exe');
    expect(args).toEqual(['/d', '/s', '/c', 'C:\\Volta\\bin\\codex.cmd', 'login', 'status']);

    child.emit('close', 126);
    const result = await promise;
    expect(result.ok).toBe(false);
    expect(result.mode).toBe('unknown');
  });
});
