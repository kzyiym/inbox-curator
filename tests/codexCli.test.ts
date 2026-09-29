import { afterEach, describe, expect, it } from 'vitest';
import {
  buildCodexExecArgs,
  buildCodexOutputSchema,
  buildCodexSpawnEnv,
  buildCodexSpawnInvocation,
  buildScrubbedEnv,
  CODEX_CLI_NOT_FOUND_MESSAGE,
  CODEX_CLI_POWERSHELL_UNSUPPORTED_MESSAGE,
  CODEX_CLI_UNSAFE_ARGUMENT_MESSAGE,
  extractCodexFailureReason,
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

describe('extractCodexFailureReason', () => {
  it('prefers the last JSON failure, reads nested msg events, and collapses whitespace', () => {
    const stdout = '{"type":"error","message":"old"}\n{"msg":{"type":"error","message":"line one\\nline two"}}\n';
    expect(extractCodexFailureReason(stdout, 'stderr last')).toBe('line one line two');
  });

  it('returns undefined when neither stdout nor stderr has a reason', () => {
    expect(extractCodexFailureReason('', '')).toBeUndefined();
    expect(extractCodexFailureReason('{"type":"error","message":"   "}', '\n')).toBeUndefined();
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
  overrides: Partial<CodexCliDependencies> = {},
) {
  const spawnCalls: Array<{
    command: string;
    args: string[];
    cwd: string;
    env: Record<string, string>;
    windowsVerbatimArguments?: boolean;
  }> = [];
  const removed: string[] = [];
  const written: string[] = [];
  let index = 0;

  const deps: CodexCliDependencies = {
    platform: () => platform,
    tmpdir: () => '/tmp',
    env: () => ({ PATH: '/usr/bin', HOME: '/home/u', OPENAI_API_KEY: 'sk-secret' }),
    mkdtemp: async (prefix) => `${prefix}${index}`,
    writeFile: async (path) => {
      written.push(path);
    },
    rm: async (path) => {
      removed.push(path);
    },
    ...overrides,
    spawn: (command, args, options) => {
      spawnCalls.push({
        command,
        args,
        cwd: options.cwd,
        env: options.env,
        windowsVerbatimArguments: options.windowsVerbatimArguments,
      });
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

  return { deps, spawnCalls, removed, written };
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

  it('includes the JSONL error message in a non-zero exit error', async () => {
    const stdout = [
      '{"type":"thread.started"}',
      '{"type":"error","message":"first error"}',
      '{"type":"error","message":"stream disconnected: model unavailable"}',
    ].join('\n');
    const { deps } = makeDeps([{ stdout: CHATGPT }, { stdout, stderr: 'stderr noise\n', code: 1 }]);
    setCodexCliDependencies(deps);

    const result = await runCodexExec({ prompt: 'SECRET_NOTE_BODY' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('exit');
      expect(result.retryable).toBe(false);
      expect(result.error).toBe('Codex CLI exited with code 1: stream disconnected: model unavailable');
      expect(result.error).not.toContain('SECRET_NOTE_BODY');
    }
  });

  it('includes a turn.failed error message and falls back to stderr when JSON has none', async () => {
    const turnFailed = '{"type":"turn.failed","error":{"message":"usage limit reached"}}\n';
    const { deps } = makeDeps([{ stdout: CHATGPT }, { stdout: turnFailed, code: 2 }, { stdout: CHATGPT }, { stdout: 'not json\n', stderr: 'warn\nfatal: config invalid\n\n', code: 3 }]);
    setCodexCliDependencies(deps);

    const first = await runCodexExec({ prompt: 'x' });
    const second = await runCodexExec({ prompt: 'x' });

    expect(first.ok === false && first.error).toBe('Codex CLI exited with code 2: usage limit reached');
    expect(second.ok === false && second.error).toBe('Codex CLI exited with code 3: fatal: config invalid');
  });

  it('masks key-like strings in the surfaced failure reason', async () => {
    const stdout = '{"type":"error","message":"auth failed api_key=sk-livesecret123456 Bearer abc.def.ghi raw sk-proj-ABCDEFGH12345678"}\n';
    const { deps } = makeDeps([{ stdout: CHATGPT }, { stdout, code: 1 }]);
    setCodexCliDependencies(deps);

    const result = await runCodexExec({ prompt: 'x' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('[REDACTED]');
      expect(result.error).not.toContain('sk-livesecret123456');
      expect(result.error).not.toContain('abc.def.ghi');
      expect(result.error).not.toContain('sk-proj-ABCDEFGH12345678');
    }
  });

  it('keeps the code-only message when output has no usable reason', async () => {
    const { deps } = makeDeps([
      { stdout: CHATGPT }, { stdout: '', stderr: '', code: 1 },
      { stdout: CHATGPT }, { stdout: '{not json\n{"type":"error"}\n{"type":"turn.failed","error":{}}\n', stderr: '  \n', code: 4 },
    ]);
    setCodexCliDependencies(deps);

    const empty = await runCodexExec({ prompt: 'x' });
    const invalid = await runCodexExec({ prompt: 'x' });

    expect(empty.ok === false && empty.error).toBe('Codex CLI exited with code 1.');
    expect(invalid.ok === false && invalid.error).toBe('Codex CLI exited with code 4.');
  });

  it('truncates long failure reasons', async () => {
    const longMessage = 'x'.repeat(1000);
    const { deps } = makeDeps([{ stdout: CHATGPT }, { stdout: `{"type":"error","message":"${longMessage}"}\n`, code: 1 }]);
    setCodexCliDependencies(deps);

    const result = await runCodexExec({ prompt: 'x' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      const reason = result.error.replace('Codex CLI exited with code 1: ', '');
      expect(reason).toBe(`${'x'.repeat(300)}...`);
    }
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

});

describe('Codex CLI on Windows', () => {
  const WIN_ENV = {
    Path: 'C:\\Windows\\system32;C:\\Users\\me\\AppData\\Roaming\\npm\\',
    APPDATA: 'C:\\Users\\me\\AppData\\Roaming',
    LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local',
    USERPROFILE: 'C:\\Users\\me',
    ComSpec: 'C:\\Windows\\system32\\cmd.exe',
    OPENAI_API_KEY: 'sk-secret',
  };
  const NPM_SHIM = 'C:\\Users\\me\\AppData\\Roaming\\npm\\codex.cmd';

  function makeWindowsDeps(plans: FakePlan[], existing: string[], env: Record<string, string> = WIN_ENV) {
    const lowerExisting = new Set(existing.map((path) => path.toLowerCase()));
    return makeDeps(plans, 'win32', () => true, {
      tmpdir: () => 'C:\\Users\\me\\AppData\\Local\\Temp',
      env: () => ({ ...env }),
      fileExists: async (path) => lowerExisting.has(path.toLowerCase()),
    });
  }

  it('builds a single semicolon-separated PATH key with Windows fallbacks and no secrets', () => {
    const env = buildCodexSpawnEnv({ ...WIN_ENV, PATH: '' }, 'win32');

    expect(env.PATH).toBeUndefined();
    expect(env.Path.split(';')).toEqual([
      'C:\\Windows\\system32',
      'C:\\Users\\me\\AppData\\Roaming\\npm\\',
      'C:\\Users\\me\\AppData\\Local\\Volta\\bin',
      'C:\\Users\\me\\AppData\\Local\\pnpm',
      'C:\\Users\\me\\.volta\\bin',
      'C:\\Users\\me\\.bun\\bin',
      'C:\\Users\\me\\scoop\\shims',
    ]);
    expect(env.OPENAI_API_KEY).toBeUndefined();
  });

  it('runs an npm codex.cmd shim found on PATH through cmd.exe with quoted verbatim arguments', async () => {
    const { deps, spawnCalls, written } = makeWindowsDeps([{ stdout: CHATGPT }, { stdout: JSONL }], [NPM_SHIM]);
    setCodexCliDependencies(deps);

    const result = await runCodexExec({ prompt: 'SECRET_NOTE_BODY', model: 'gpt-5-codex' });

    expect(result).toEqual({ ok: true, content: '{"summary":["ok"]}' });
    expect(spawnCalls).toHaveLength(2);
    for (const call of spawnCalls) {
      expect(call.command).toBe('C:\\Windows\\system32\\cmd.exe');
      expect(call.args.slice(0, 4)).toEqual(['/d', '/v:off', '/s', '/c']);
      expect(call.windowsVerbatimArguments).toBe(true);
      expect(call.env.OPENAI_API_KEY).toBeUndefined();
      expect(call.args.join(' ')).not.toContain('SECRET_NOTE_BODY');
    }
    expect(spawnCalls[0].args[4]).toBe(`""${NPM_SHIM}" "login" "status""`);
    const tempDir = 'C:\\Users\\me\\AppData\\Local\\Temp\\inbox-curator-codex-1';
    expect(spawnCalls[1].cwd).toBe(tempDir);
    expect(written).toEqual([`${tempDir}\\schema.json`]);
    expect(spawnCalls[1].args[4]).toContain(`"--output-schema" "${tempDir}\\schema.json" "-C" "${tempDir}"`);
    expect(spawnCalls[1].args[4]).toContain('"--model" "gpt-5-codex"');
    expect(spawnCalls[1].args[4].endsWith(' "-""')).toBe(true);
  });

  it('prefers codex.exe from an earlier PATH directory and spawns it directly', async () => {
    const exe = 'C:\\Windows\\system32\\codex.exe';
    const { deps, spawnCalls } = makeWindowsDeps([{ stdout: CHATGPT }, { stdout: JSONL }], [exe, NPM_SHIM]);
    setCodexCliDependencies(deps);

    const result = await runCodexExec({ prompt: 'x', model: '100%-model' });

    expect(result.ok).toBe(true);
    expect(spawnCalls.map((call) => call.command)).toEqual([exe, exe]);
    expect(spawnCalls[0].args).toEqual(['login', 'status']);
    expect(spawnCalls[1].windowsVerbatimArguments).toBeUndefined();
  });

  it('resolves an explicit extensionless path to its .cmd shim', async () => {
    const { deps, spawnCalls } = makeWindowsDeps([{ stdout: CHATGPT }, { stdout: JSONL }], ['D:\\tools\\codex.cmd']);
    setCodexCliDependencies(deps);

    const result = await runCodexExec({ prompt: 'x', binaryPath: 'D:\\tools\\codex' });

    expect(result.ok).toBe(true);
    expect(spawnCalls[0].args[4]).toBe('""D:\\tools\\codex.cmd" "login" "status""');
  });

  it('refuses a PowerShell script path without spawning', async () => {
    const { deps, spawnCalls } = makeWindowsDeps([], ['D:\\tools\\codex.ps1']);
    setCodexCliDependencies(deps);

    const result = await runCodexExec({ prompt: 'x', binaryPath: 'D:\\tools\\codex.ps1' });

    expect(result).toEqual({ ok: false, error: CODEX_CLI_POWERSHELL_UNSUPPORTED_MESSAGE, retryable: false, reason: 'unavailable' });
    expect(spawnCalls).toHaveLength(0);
  });

  it('reports not found without spawning when no codex executable exists', async () => {
    const { deps, spawnCalls } = makeWindowsDeps([], []);
    setCodexCliDependencies(deps);

    const result = await runCodexExec({ prompt: 'x' });
    const status = await getCodexLoginStatus('D:\\missing\\codex.exe');

    expect(result).toEqual({ ok: false, error: CODEX_CLI_NOT_FOUND_MESSAGE, retryable: false, reason: 'unavailable' });
    expect(status).toEqual({ ok: false, authMode: 'unavailable', authenticated: false });
    expect(spawnCalls).toHaveLength(0);
  });

  it('refuses arguments that cmd.exe would expand before running the exec step', async () => {
    const { deps, spawnCalls } = makeWindowsDeps([{ stdout: CHATGPT }], [NPM_SHIM]);
    setCodexCliDependencies(deps);

    const result = await runCodexExec({ prompt: 'x', model: '%OPENAI_API_KEY%' });

    expect(result).toEqual({ ok: false, error: CODEX_CLI_UNSAFE_ARGUMENT_MESSAGE, retryable: false, reason: 'unavailable' });
    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0].args[4]).toContain('"login" "status"');
  });
});

describe('buildCodexSpawnInvocation', () => {
  it('only wraps .cmd/.bat files on Windows', () => {
    expect(buildCodexSpawnInvocation('darwin', '/bin/codex.cmd', ['exec'], '')).toEqual({ command: '/bin/codex.cmd', args: ['exec'] });
    expect(buildCodexSpawnInvocation('win32', 'C:\\bin\\codex.exe', ['exec'], 'cmd.exe')).toEqual({ command: 'C:\\bin\\codex.exe', args: ['exec'] });
    expect(buildCodexSpawnInvocation('win32', 'C:\\My Tools\\codex.BAT', ['exec', 'a & b'], 'cmd.exe')).toEqual({
      command: 'cmd.exe',
      args: ['/d', '/v:off', '/s', '/c', '""C:\\My Tools\\codex.BAT" "exec" "a & b""'],
      windowsVerbatimArguments: true,
    });
    expect(buildCodexSpawnInvocation('win32', 'C:\\bin\\codex.cmd', ['say "hi"'], 'cmd.exe')).toBeUndefined();
    expect(buildCodexSpawnInvocation('win32', 'C:\\bin\\codex.cmd', ['line\nbreak'], 'cmd.exe')).toBeUndefined();
    expect(buildCodexSpawnInvocation('win32', 'C:\\bin\\codex.cmd', ['C:\\dir\\'], 'cmd.exe')).toBeUndefined();
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
