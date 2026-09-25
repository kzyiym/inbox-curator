import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';

export type CodexFailureCode =
  | 'not_installed'
  | 'not_logged_in'
  | 'usage_limit'
  | 'auth_expired'
  | 'timeout'
  | 'aborted'
  | 'invalid_output'
  | 'unknown';

export interface CodexExecResult {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  finalMessage?: string;
  errorCode?: CodexFailureCode;
}

export interface CodexExecOptions {
  executablePath: string;
  prompt: string;
  cwd: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  timeoutMs?: number;
  signal?: AbortSignal;
  outputSchemaPath?: string;
  outputLastMessagePath?: string;
  model?: string;
  jsonEvents?: boolean;
}

export interface CodexResolveOptions {
  manualPath?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  homeDir?: string;
  fileExists?: (path: string) => boolean;
}

export interface SpawnInvocation {
  command: string;
  args: string[];
}

const SCRUBBED_ENV_KEYS = ['OPENAI_API_KEY', 'CODEX_API_KEY', 'CODEX_ACCESS_TOKEN'];

export function scrubCodexEnv(baseEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const scrubbed: NodeJS.ProcessEnv = { ...baseEnv };
  for (const key of SCRUBBED_ENV_KEYS) {
    delete scrubbed[key];
  }
  return scrubbed;
}

export function buildCodexArgs(options: {
  outputSchemaPath?: string;
  outputLastMessagePath?: string;
  model?: string;
  jsonEvents?: boolean;
}): string[] {
  const args = [
    'exec',
    '--sandbox',
    'read-only',
    '--skip-git-repo-check',
    '--ephemeral',
    '--ignore-user-config',
    '--ignore-rules',
  ];
  if (options.jsonEvents !== false) {
    args.push('--json');
  }
  if (options.model) {
    args.push('--model', options.model);
  }
  if (options.outputSchemaPath) {
    args.push('--output-schema', options.outputSchemaPath);
  }
  if (options.outputLastMessagePath) {
    args.push('-o', options.outputLastMessagePath);
  }
  args.push('-');
  return args;
}

export function buildSpawnInvocation(
  executablePath: string,
  args: string[],
  platform: NodeJS.Platform,
  comspec?: string,
): SpawnInvocation {
  if (platform === 'win32' && /\.(cmd|bat)$/i.test(executablePath)) {
    return {
      command: comspec || 'cmd.exe',
      args: ['/d', '/s', '/c', executablePath, ...args],
    };
  }
  return { command: executablePath, args };
}

export function getProcessTreeKillPlan(
  pid: number,
  platform: NodeJS.Platform,
  comspec?: string,
): SpawnInvocation | null {
  if (platform === 'win32') {
    return {
      command: comspec || 'cmd.exe',
      args: ['/d', '/s', '/c', 'taskkill', '/pid', String(pid), '/T', '/F'],
    };
  }
  return null;
}

function joinFor(platform: NodeJS.Platform, ...parts: string[]): string {
  const sep = platform === 'win32' ? '\\' : '/';
  return parts
    .filter((part) => part.length > 0)
    .join(sep)
    .replace(platform === 'win32' ? /[\\/]+/g : /\/+/g, sep);
}

function splitFor(platform: NodeJS.Platform, value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  const delimiter = platform === 'win32' ? ';' : ':';
  return value.split(delimiter).filter((entry) => entry.length > 0);
}

export function getCodexExecutableNames(platform: NodeJS.Platform): string[] {
  if (platform === 'win32') {
    return ['codex.exe', 'codex.cmd', 'codex.bat'];
  }
  return ['codex'];
}

export function getCodexSearchDirs(env: NodeJS.ProcessEnv, platform: NodeJS.Platform, homeDir: string): string[] {
  const dirs: string[] = [];
  if (platform === 'win32') {
    if (env.APPDATA) {
      dirs.push(joinFor(platform, env.APPDATA, 'npm'));
    }
    if (env.LOCALAPPDATA) {
      dirs.push(joinFor(platform, env.LOCALAPPDATA, 'Programs', 'codex', 'bin'));
      dirs.push(joinFor(platform, env.LOCALAPPDATA, 'Programs', 'codex'));
      dirs.push(joinFor(platform, env.LOCALAPPDATA, 'Volta', 'bin'));
      dirs.push(joinFor(platform, env.LOCALAPPDATA, 'pnpm'));
      dirs.push(joinFor(platform, env.LOCALAPPDATA, 'pnpm', 'bin'));
    }
    if (env.ProgramData) {
      dirs.push(joinFor(platform, env.ProgramData, 'chocolatey', 'bin'));
    }
    dirs.push(joinFor(platform, homeDir, '.volta', 'bin'));
    dirs.push(joinFor(platform, homeDir, '.codex', 'bin'));
    dirs.push(joinFor(platform, homeDir, 'scoop', 'shims'));
  } else {
    dirs.push(joinFor(platform, homeDir, '.local', 'bin'));
    dirs.push(joinFor(platform, homeDir, '.bun', 'bin'));
    dirs.push(joinFor(platform, homeDir, '.volta', 'bin'));
    dirs.push(joinFor(platform, homeDir, '.npm-global', 'bin'));
    dirs.push(joinFor(platform, homeDir, '.local', 'share', 'pnpm'));
    dirs.push(joinFor(platform, homeDir, 'Library', 'pnpm'));
    dirs.push('/opt/homebrew/bin');
    dirs.push('/usr/local/bin');
    dirs.push('/home/linuxbrew/.linuxbrew/bin');
  }
  dirs.push(...splitFor(platform, env.PATH || env.Path));
  return Array.from(new Set(dirs));
}

export function resolveCodexExecutable(options: CodexResolveOptions = {}): string | null {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const homeDir = options.homeDir ?? homedir();
  const fileExists = options.fileExists ?? existsSync;

  if (options.manualPath) {
    if (/\.ps1$/i.test(options.manualPath)) {
      return null;
    }
    return fileExists(options.manualPath) ? options.manualPath : null;
  }

  const names = getCodexExecutableNames(platform);
  for (const dir of getCodexSearchDirs(env, platform, homeDir)) {
    for (const name of names) {
      const candidate = joinFor(platform, dir, name);
      if (fileExists(candidate)) {
        return candidate;
      }
    }
  }
  return null;
}

export function parseCodexJsonlFinalMessage(stdout: string): string | undefined {
  let finalMessage: string | undefined;
  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith('{')) {
      continue;
    }
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (!event || typeof event !== 'object') {
      continue;
    }
    const record = event as Record<string, unknown>;
    const item = record.item as Record<string, unknown> | undefined;
    if (record.type === 'item.completed' && item && item.type === 'agent_message' && typeof item.text === 'string') {
      finalMessage = item.text;
    }
  }
  return finalMessage;
}

export function parseCodexStructuredOutput(text: string | undefined): unknown | undefined {
  if (!text) {
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export function classifyCodexFailure(input: {
  exitCode: number | null;
  stderr: string;
  timedOut?: boolean;
  aborted?: boolean;
}): CodexFailureCode {
  if (input.timedOut) {
    return 'timeout';
  }
  if (input.aborted) {
    return 'aborted';
  }
  const text = input.stderr || '';
  if (/command not found|not recognized as an internal|enoent|no such file or directory|is not defined/i.test(text)) {
    return 'not_installed';
  }
  if (/not logged in|login required|please (run )?log ?in|codex login|no credentials|missing bearer|missing authentication|missing credentials/i.test(text)) {
    return 'not_logged_in';
  }
  if (/usage limit|rate limit|quota|too many requests|\b429\b/i.test(text)) {
    return 'usage_limit';
  }
  if (/expired|unauthorized|\b401\b|invalid token|reauth|re-authenticate/i.test(text)) {
    return 'auth_expired';
  }
  return 'unknown';
}

export function execCodex(options: CodexExecOptions): Promise<CodexExecResult> {
  return new Promise((resolve) => {
    const env = scrubCodexEnv(options.env ?? process.env);
    const platform = options.platform ?? process.platform;
    const args = buildCodexArgs({
      outputSchemaPath: options.outputSchemaPath,
      outputLastMessagePath: options.outputLastMessagePath,
      model: options.model,
      jsonEvents: options.jsonEvents,
    });

    const invocation = buildSpawnInvocation(options.executablePath, args, platform, env.ComSpec);
    let child: ChildProcess;
    try {
      child = spawn(invocation.command, invocation.args, {
        cwd: options.cwd,
        env,
        shell: false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch {
      resolve({ ok: false, exitCode: null, stdout: '', stderr: '', errorCode: 'not_installed' });
      return;
    }

    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    let aborted = false;

    const cleanup = () => {
      if (timer) {
        clearTimeout(timer);
      }
      if (options.signal) {
        options.signal.removeEventListener('abort', onAbort);
      }
    };

    const killProcess = () => {
      if (!child.pid) {
        return;
      }
      const plan = getProcessTreeKillPlan(child.pid, platform, env.ComSpec);
      if (plan) {
        try {
          spawn(plan.command, plan.args, { shell: false, windowsHide: true, stdio: 'ignore' });
          return;
        } catch {
          void 0;
        }
      }
      try {
        child.kill('SIGKILL');
      } catch {
        void 0;
      }
    };

    const finish = (result: Omit<CodexExecResult, 'ok' | 'stdout' | 'stderr'> & { ok?: boolean }) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve({
        ok: result.ok ?? (result.exitCode === 0 && !result.errorCode),
        exitCode: result.exitCode,
        stdout,
        stderr,
        finalMessage: result.finalMessage,
        errorCode: result.errorCode,
      });
    };

    const onAbort = () => {
      aborted = true;
      killProcess();
    };

    if (options.signal) {
      if (options.signal.aborted) {
        onAbort();
      } else {
        options.signal.addEventListener('abort', onAbort, { once: true });
      }
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    if (options.timeoutMs && options.timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        killProcess();
      }, options.timeoutMs);
    }

    child.stdout?.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on('error', () => {
      finish({ exitCode: null, errorCode: 'not_installed' });
    });

    child.on('close', (code) => {
      const finalMessage = parseCodexJsonlFinalMessage(stdout);
      const errorCode =
        code === 0 && !timedOut && !aborted
          ? undefined
          : classifyCodexFailure({ exitCode: code, stderr, timedOut, aborted });
      finish({ exitCode: code, finalMessage, errorCode });
    });

    try {
      child.stdin?.end(options.prompt);
    } catch {
      child.stdin?.destroy();
    }
  });
}

export type CodexLoginMode = 'chatgpt' | 'api_key' | 'not_logged_in' | 'unknown';

export interface CodexLoginStatusResult {
  ok: boolean;
  mode: CodexLoginMode;
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

export function buildCodexLoginArgs(): string[] {
  return ['login', 'status'];
}

export function parseCodexLoginStatus(text: string): CodexLoginMode {
  const value = text || '';
  if (/not logged in|not signed in|logged out|signed out|no credentials|not authenticated|missing bearer|no active (session|account)/i.test(value)) {
    return 'not_logged_in';
  }
  if (/api[- ]?key|openai_api_key/i.test(value)) {
    return 'api_key';
  }
  if (/chatgpt|logged in|signed in|authenticated/i.test(value)) {
    return 'chatgpt';
  }
  return 'unknown';
}

export function execCodexLoginStatus(options: {
  executablePath: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  timeoutMs?: number;
}): Promise<CodexLoginStatusResult> {
  return new Promise((resolve) => {
    const env = scrubCodexEnv(options.env ?? process.env);
    const platform = options.platform ?? process.platform;
    const invocation = buildSpawnInvocation(options.executablePath, buildCodexLoginArgs(), platform, env.ComSpec);

    let child: ChildProcess;
    try {
      child = spawn(invocation.command, invocation.args, {
        env,
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch {
      resolve({ ok: false, mode: 'unknown', stdout: '', stderr: '', exitCode: null });
      return;
    }

    let stdout = '';
    let stderr = '';
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const finish = (exitCode: number | null) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer) {
        clearTimeout(timer);
      }
      const mode = parseCodexLoginStatus(`${stdout}\n${stderr}`);
      resolve({ ok: mode === 'chatgpt', mode, stdout, stderr, exitCode });
    };

    if (options.timeoutMs && options.timeoutMs > 0) {
      timer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          void 0;
        }
      }, options.timeoutMs);
    }

    child.stdout?.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });
    child.on('error', () => finish(null));
    child.on('close', (code) => finish(code));
  });
}
