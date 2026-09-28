import { afterEach, describe, expect, it } from 'vitest';
import {
  buildCodexExecArgs,
  buildCodexOutputSchema,
  buildCodexSpawnEnv,
  buildScrubbedEnv,
  CODEX_CLI_NOT_FOUND_MESSAGE,
  extractLastAgentMessage,
  getCodexLoginStatus,
  parseCodexLoginStatus,
  runCodexExec,
  setCodexCliDependencies,
  type CodexCliDependencies,
} from '../src/codexCli';
import { testConnection } from '../src/connectionTest';
import { postProviderChat } from '../src/providerClient';
import { DEFAULT_SETTINGS } from '../src/settings';

afterEach(() => {
  setCodexCliDependencies(undefined);
});

describe('codex CLI settings defaults', () => {
  it('defaults the provider off and consent unacknowledged', () => {
    expect(DEFAULT_SETTINGS.codexCliEnabled).toBe(false);
    expect(DEFAULT_SETTINGS.codexCliConsentAcknowledged).toBe(false);
    expect(DEFAULT_SETTINGS.codexCliAllowBackground).toBe(false);
  });
});

describe('buildCodexSpawnEnv', () => {
  it('keeps inherited PATH entries first and appends only missing fallbacks', () => {
    const base = { PATH: '/usr/local/bin:/usr/bin', HOME: '/Users/me/' };
    const env = buildCodexSpawnEnv(base);

    expect(env.PATH.split(':')).toEqual([
      '/usr/local/bin',
      '/usr/bin',
      '/opt/homebrew/bin',
      '/usr/local/sbin',
      '/Users/me/.local/bin',
      '/Users/me/.volta/bin',
      '/Users/me/.bun/bin',
      '/Users/me/.yarn/bin',
      '/Users/me/.pnpm',
    ]);
    expect(base.PATH).toBe('/usr/local/bin:/usr/bin');
  });

  it('skips home-relative fallbacks when home cannot be resolved and falls back to USERPROFILE', () => {
    expect(buildCodexSpawnEnv({}).PATH).toBe('/opt/homebrew/bin:/usr/local/bin:/usr/local/sbin');
    expect(buildCodexSpawnEnv({ USERPROFILE: '/home/p' }).PATH).toContain('/home/p/.local/bin');
  });

  it('still removes secret-bearing variables', () => {
    const env = buildCodexSpawnEnv({ PATH: '/usr/bin', OPENAI_API_KEY: 'sk-secret' });
    expect(env.OPENAI_API_KEY).toBeUndefined();
  });
});

describe('buildCodexExecArgs', () => {
  it('includes the hardened flags, stdin marker, and no prompt text', () => {
    const args = buildCodexExecArgs({ schemaPath: '/tmp/schema.json', cwd: '/tmp/work', model: 'gpt-5-codex' });

    expect(args[0]).toBe('exec');
    expect(args).toContain('--ephemeral');
    expect(args).toContain('--ignore-user-config');
    expect(args).toEqual(expect.arrayContaining(['--sandbox', 'read-only', '--skip-git-repo-check']));
    expect(args).toEqual(expect.arrayContaining(['--disable', 'plugins']));
    expect(args).toEqual(expect.arrayContaining(['--disable', 'apps']));
    expect(args).toEqual(expect.arrayContaining(['--disable', 'hooks']));
    expect(args).toEqual(expect.arrayContaining(['--output-schema', '/tmp/schema.json']));
    expect(args).toEqual(expect.arrayContaining(['-C', '/tmp/work']));
    expect(args).toEqual(expect.arrayContaining(['--model', 'gpt-5-codex']));
    expect(args).toContain('--json');
    expect(args[args.length - 1]).toBe('-');
    expect(args).not.toContain('--ignore-rules');
  });
});

describe('buildScrubbedEnv', () => {
  it('removes secret-bearing variables and keeps the rest', () => {
    const env = buildScrubbedEnv({
      PATH: '/usr/bin',
      HOME: '/home/u',
      OPENAI_API_KEY: 'sk-secret',
      CODEX_API_KEY: 'x',
      ANTHROPIC_API_KEY: 'y',
      MY_TOKEN: 'z',
      PASSWORD: 'p',
    });

    expect(env.PATH).toBe('/usr/bin');
    expect(env.HOME).toBe('/home/u');
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.CODEX_API_KEY).toBeUndefined();
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.MY_TOKEN).toBeUndefined();
    expect(env.PASSWORD).toBeUndefined();
  });
});

describe('parseCodexLoginStatus', () => {
  it('accepts ChatGPT auth only', () => {
    expect(parseCodexLoginStatus('Logged in using ChatGPT')).toMatchObject({ ok: true, authMode: 'chatgpt' });
    expect(parseCodexLoginStatus('Logged in using an API key')).toMatchObject({ ok: false, authMode: 'api-key' });
    expect(parseCodexLoginStatus('Not logged in')).toMatchObject({ ok: false, authMode: 'logged-out' });
    expect(parseCodexLoginStatus('something else')).toMatchObject({ ok: false, authMode: 'unknown' });
  });
});

describe('extractLastAgentMessage', () => {
  it('returns the last agent_message from JSONL', () => {
    const stdout = [
      '{"type":"thread.started"}',
      '{"type":"item.completed","item":{"type":"agent_message","text":"FIRST"}}',
      '{"type":"turn.completed"}',
      '{"type":"item.completed","item":{"type":"agent_message","text":"{\\"summary\\":[\\"ok\\"]}"}}',
    ].join('\n');

    expect(extractLastAgentMessage(stdout)).toBe('{"summary":["ok"]}');
  });

  it('ignores preceding banner lines and non-JSON output', () => {
    const stdout = 'banner text\nnot json\n{"item":{"type":"agent_message","text":"HELLO"}}\n';
    expect(extractLastAgentMessage(stdout)).toBe('HELLO');
  });
});

describe('buildCodexOutputSchema', () => {
  it('is valid JSON requiring a summary array', () => {
    const schema = JSON.parse(buildCodexOutputSchema());
    expect(schema.type).toBe('object');
    expect(schema.required).toContain('summary');
    expect(schema.properties.summary.type).toBe('array');
  });
});

interface FakePlan {
  stdout?: string;
  stderr?: string;
  code?: number | null;
  noClose?: boolean;
  errorCode?: string;
}

function makeDeps(
  plans: FakePlan[],
  platform = 'darwin',
  resolves: (command: string, env: Record<string, string>) => boolean = () => true,
) {
  const spawnCalls: Array<{ command: string; args: string[]; cwd: string; env: Record<string, string> }> = [];
  const removed: string[] = [];
  let index = 0;

  const deps: CodexCliDependencies = {
    platform: () => platform,
    tmpdir: () => '/tmp',
    env: () => ({ PATH: '/usr/bin', HOME: '/home/u', OPENAI_API_KEY: 'sk-secret' }),
    mkdtemp: async (prefix) => `${prefix}${index}`,
    writeFile: async () => {},
    rm: async (path) => {
      removed.push(path);
    },
    spawn: (command, args, options) => {
      spawnCalls.push({ command, args, cwd: options.cwd, env: options.env });
      const plan = plans[index] ?? { code: 0 };
      index += 1;
      const child = {
        pid: 1000 + index,
        stdin: { write: () => {}, end: () => {} },
        stdout: { on: (_event: string, callback: (chunk: unknown) => void) => { (child as unknown as { out?: (c: unknown) => void }).out = callback; } },
        stderr: { on: (_event: string, callback: (chunk: unknown) => void) => { (child as unknown as { err?: (c: unknown) => void }).err = callback; } },
        on: (event: string, callback: (value: unknown) => void) => { (child as unknown as Record<string, unknown>)[event] = callback; },
        kill: () => { (child as unknown as { close?: (code: number | null) => void }).close?.(null); },
      } as unknown as ReturnType<CodexCliDependencies['spawn']>;
      const errorCode = plan.errorCode ?? (resolves(command, options.env) ? undefined : 'ENOENT');
      setTimeout(() => {
        if (errorCode) {
          const error = Object.assign(new Error(`spawn ${command} ${errorCode}`), { code: errorCode });
          (child as unknown as { error?: (e: Error) => void }).error?.(error);
          return;
        }
        if (plan.stdout) (child as unknown as { out?: (c: unknown) => void }).out?.(plan.stdout);
        if (plan.stderr) (child as unknown as { err?: (c: unknown) => void }).err?.(plan.stderr);
        if (!plan.noClose) (child as unknown as { close?: (code: number | null) => void }).close?.(plan.code ?? 0);
      }, 0);
      return child;
    },
  };

  return { deps, spawnCalls, removed };
}

const CHATGPT = 'Logged in using ChatGPT\n';
const JSONL = '{"type":"item.completed","item":{"type":"agent_message","text":"{\\"summary\\":[\\"ok\\"]}"}}\n';

describe('runCodexExec', () => {
  it('verifies ChatGPT login in the same scrubbed env, runs from a temp cwd, and keeps the prompt off argv', async () => {
    const { deps, spawnCalls, removed } = makeDeps([{ stdout: CHATGPT }, { stdout: JSONL }]);
    setCodexCliDependencies(deps);

    const result = await runCodexExec({ prompt: 'SECRET_NOTE_BODY', binaryPath: '/opt/homebrew/bin/codex' });

    expect(result).toEqual({ ok: true, content: '{"summary":["ok"]}' });
    expect(spawnCalls).toHaveLength(2);
    expect(spawnCalls[0].command).toBe('/opt/homebrew/bin/codex');
    expect(spawnCalls[0].args).toEqual(['login', 'status']);
    expect(spawnCalls[1].args[0]).toBe('exec');
    expect(spawnCalls[1].env.OPENAI_API_KEY).toBeUndefined();
    expect(spawnCalls[1].args.join(' ')).not.toContain('SECRET_NOTE_BODY');
    expect(removed.length).toBeGreaterThanOrEqual(2);
  });

  it('fails closed when login is API-key based', async () => {
    const { deps } = makeDeps([{ stdout: 'Logged in using an API key\n' }]);
    setCodexCliDependencies(deps);

    const result = await runCodexExec({ prompt: 'x' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('login');
  });

  it('fails when no final agent message is present', async () => {
    const { deps } = makeDeps([{ stdout: CHATGPT }, { stdout: '{"type":"turn.completed"}\n' }]);
    setCodexCliDependencies(deps);

    const result = await runCodexExec({ prompt: 'x' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid-output');
  });

  it('reports a timeout and kills the process', async () => {
    const { deps } = makeDeps([{ stdout: CHATGPT }, { noClose: true }]);
    setCodexCliDependencies(deps);

    const result = await runCodexExec({ prompt: 'x', timeoutMs: 20 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('timeout');
  });

  it('refuses background runs without spawning when background is not allowed', async () => {
    const { deps, spawnCalls } = makeDeps([]);
    setCodexCliDependencies(deps);

    const implicit = await runCodexExec({ prompt: 'x', background: true });
    const explicit = await runCodexExec({ prompt: 'x', background: true, allowBackground: false });

    for (const result of [implicit, explicit]) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('disabled');
    }
    expect(spawnCalls).toHaveLength(0);
  });

  it('runs background requests when background is explicitly allowed', async () => {
    const { deps, spawnCalls } = makeDeps([{ stdout: CHATGPT }, { stdout: JSONL }]);
    setCodexCliDependencies(deps);

    const result = await runCodexExec({ prompt: 'x', background: true, allowBackground: true });

    expect(result).toEqual({ ok: true, content: '{"summary":["ok"]}' });
    expect(spawnCalls).toHaveLength(2);
  });

  it('appends GUI PATH fallbacks so codex resolves when the inherited PATH lacks it', async () => {
    const resolvesFromHomebrew = (command: string, env: Record<string, string>) =>
      command !== 'codex' || env.PATH.split(':').includes('/opt/homebrew/bin');
    const { deps, spawnCalls } = makeDeps([{ stdout: CHATGPT }, { stdout: JSONL }], 'darwin', resolvesFromHomebrew);
    setCodexCliDependencies(deps);

    const result = await runCodexExec({ prompt: 'x' });

    expect(result).toEqual({ ok: true, content: '{"summary":["ok"]}' });
    for (const call of spawnCalls) {
      expect(call.command).toBe('codex');
      expect(call.env.PATH.split(':')).toEqual([
        '/usr/bin',
        '/opt/homebrew/bin',
        '/usr/local/bin',
        '/usr/local/sbin',
        '/home/u/.local/bin',
        '/home/u/.volta/bin',
        '/home/u/.bun/bin',
        '/home/u/.yarn/bin',
        '/home/u/.pnpm',
      ]);
      expect(call.env.OPENAI_API_KEY).toBeUndefined();
    }
  });

  it('uses an explicit binaryPath as-is regardless of PATH augmentation', async () => {
    const onlyExplicit = (command: string) => command === '/custom/bin/codex';
    const { deps, spawnCalls } = makeDeps([{ stdout: CHATGPT }, { stdout: JSONL }], 'darwin', onlyExplicit);
    setCodexCliDependencies(deps);

    const result = await runCodexExec({ prompt: 'x', binaryPath: '/custom/bin/codex' });

    expect(result.ok).toBe(true);
    expect(spawnCalls.map((call) => call.command)).toEqual(['/custom/bin/codex', '/custom/bin/codex']);
  });

  it('reports a missing binary as unavailable instead of not logged in', async () => {
    const { deps, spawnCalls } = makeDeps([{ errorCode: 'ENOENT' }]);
    setCodexCliDependencies(deps);

    const result = await runCodexExec({ prompt: 'x' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('unavailable');
      expect(result.error).toBe(CODEX_CLI_NOT_FOUND_MESSAGE);
    }
    expect(spawnCalls).toHaveLength(1);
  });

  it('reports login status as unavailable when the binary cannot be spawned', async () => {
    const { deps } = makeDeps([{ errorCode: 'ENOENT' }]);
    setCodexCliDependencies(deps);

    const status = await getCodexLoginStatus();

    expect(status).toEqual({ ok: false, authMode: 'unavailable', authenticated: false });
  });

  it('reports Windows as unsupported', async () => {
    const { deps } = makeDeps([], 'win32');
    setCodexCliDependencies(deps);

    const result = await runCodexExec({ prompt: 'x' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('unsupported-platform');
  });
});

describe('postProviderChat codex-cli dispatch', () => {
  it('runs the CLI and returns content when enabled and consented', async () => {
    const { deps } = makeDeps([{ stdout: CHATGPT }, { stdout: JSONL }]);
    setCodexCliDependencies(deps);

    const result = await postProviderChat({
      provider: 'codex-cli',
      endpointUrl: '',
      model: '',
      apiKey: '',
      messages: [{ role: 'user', content: 'hello' }],
      codexCli: {
        settings: {
          enabled: true,
          consentAcknowledged: true,
          allowBackground: false,
          binaryPath: '',
          model: '',
        },
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.content).toBe('{"summary":["ok"]}');
  });

  it('runs a background job when background runs are allowed', async () => {
    const { deps, spawnCalls } = makeDeps([{ stdout: CHATGPT }, { stdout: JSONL }]);
    setCodexCliDependencies(deps);

    const result = await postProviderChat({
      provider: 'codex-cli',
      endpointUrl: '',
      model: '',
      apiKey: '',
      messages: [{ role: 'user', content: 'hello' }],
      codexCli: {
        background: true,
        settings: {
          enabled: true,
          consentAcknowledged: true,
          allowBackground: true,
          binaryPath: '',
          model: '',
        },
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.content).toBe('{"summary":["ok"]}');
    expect(spawnCalls).toHaveLength(2);
  });

  it('fails closed for a background job when background runs are not allowed', async () => {
    const { deps, spawnCalls } = makeDeps([]);
    setCodexCliDependencies(deps);

    const result = await postProviderChat({
      provider: 'codex-cli',
      endpointUrl: '',
      model: '',
      apiKey: '',
      messages: [{ role: 'user', content: 'hello' }],
      codexCli: {
        background: true,
        settings: {
          enabled: true,
          consentAcknowledged: true,
          allowBackground: false,
          binaryPath: '',
          model: '',
        },
      },
    });

    expect(result.ok).toBe(false);
    expect(spawnCalls).toHaveLength(0);
  });

  it('fails closed when not enabled', async () => {
    const { deps } = makeDeps([]);
    setCodexCliDependencies(deps);

    const result = await postProviderChat({
      provider: 'codex-cli',
      endpointUrl: '',
      model: '',
      apiKey: '',
      messages: [{ role: 'user', content: 'hello' }],
      codexCli: {
        settings: {
          enabled: false,
          consentAcknowledged: false,
          allowBackground: false,
          binaryPath: '',
          model: '',
        },
      },
    });

    expect(result.ok).toBe(false);
  });
});

describe('testConnection codex-cli', () => {
  it('reports a missing binary as not found instead of not logged in', async () => {
    const { deps } = makeDeps([{ errorCode: 'ENOENT' }]);
    setCodexCliDependencies(deps);

    const result = await testConnection({
      provider: 'codex-cli',
      endpointUrl: '',
      model: '',
      apiKey: '',
      codexCli: {
        enabled: true,
        consentAcknowledged: true,
        allowBackground: false,
        binaryPath: '',
        model: '',
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(CODEX_CLI_NOT_FOUND_MESSAGE);
      expect(result.error).not.toMatch(/not logged in/i);
    }
  });
});
