import { sanitizeSensitiveString } from './utils/sensitiveData';

export interface CodexCliSettings {
  enabled: boolean;
  consentAcknowledged: boolean;
  allowBackground: boolean;
  binaryPath: string;
  model: string;
}

export const DEFAULT_CODEX_CLI_SETTINGS: CodexCliSettings = {
  enabled: false,
  consentAcknowledged: false,
  allowBackground: false,
  binaryPath: '',
  model: '',
};

export type CodexAuthMode = 'chatgpt' | 'api-key' | 'logged-out' | 'unavailable' | 'unknown';

export const CODEX_CLI_NOT_FOUND_MESSAGE = 'Codex CLI not found. Set the CLI path in settings, or make it available on PATH.';
export const CODEX_CLI_POWERSHELL_UNSUPPORTED_MESSAGE = 'Codex CLI path points to a PowerShell script (.ps1). Use codex.cmd or codex.exe instead.';
export const CODEX_CLI_UNSAFE_ARGUMENT_MESSAGE = 'Codex CLI arguments contain characters that cannot be passed safely through cmd.exe (", %, line breaks, or a trailing backslash). Check the Codex model setting and the temp folder path.';

export interface CodexLoginStatus {
  ok: boolean;
  authMode: CodexAuthMode;
  authenticated: boolean;
}

export type CodexFailureReason =
  | 'disabled'
  | 'login'
  | 'unavailable'
  | 'timeout'
  | 'aborted'
  | 'exit'
  | 'invalid-output';

export type CodexExecResult =
  | { ok: true; content: string }
  | { ok: false; error: string; retryable: boolean; reason: CodexFailureReason };

export interface CodexExecRequest {
  prompt: string;
  model?: string;
  binaryPath?: string;
  timeoutMs?: number;
  isUnloaded?: () => boolean;
  background?: boolean;
  allowBackground?: boolean;
}

export interface CodexCliDependencies {
  platform(): string;
  tmpdir(): string;
  env(): Record<string, string | undefined>;
  mkdtemp(prefix: string): Promise<string>;
  writeFile(path: string, data: string): Promise<void>;
  rm(path: string, options: { recursive: boolean; force: boolean }): Promise<void>;
  spawn(
    command: string,
    args: string[],
    options: { cwd: string; env: Record<string, string>; windowsVerbatimArguments?: boolean },
  ): CodexChildProcess;
  killTree?(pid: number): void;
  fileExists?(path: string): Promise<boolean>;
}

export interface CodexChildProcess {
  pid?: number;
  stdin: { write(data: string): void; end(): void };
  stdout: { on(event: 'data', listener: (chunk: unknown) => void): void };
  stderr: { on(event: 'data', listener: (chunk: unknown) => void): void };
  on(event: 'error', listener: (error: Error) => void): void;
  on(event: 'close', listener: (code: number | null) => void): void;
  kill(signal?: string): void;
}

const SECRET_ENV_PATTERN = /(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH)/i;
const MAX_CAPTURE_BYTES = 5 * 1024 * 1024;

export function buildScrubbedEnv(base: Record<string, string | undefined>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(base)) {
    if (typeof value !== 'string') continue;
    if (SECRET_ENV_PATTERN.test(key)) continue;
    env[key] = value;
  }
  return env;
}

// Obsidian launched from the macOS GUI inherits a minimal PATH (no shell rc files),
// so common user-level install locations are appended as a fallback.
const PATH_FALLBACK_DIRS = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/local/sbin'];
const HOME_PATH_FALLBACK_DIRS = ['.local/bin', '.volta/bin', '.bun/bin', '.yarn/bin', '.pnpm'];

function getEnvValueIgnoreCase(env: Record<string, string | undefined>, name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(env)) {
    if (key.toLowerCase() === lower && typeof value === 'string' && value !== '') return value;
  }
  return undefined;
}

function trimWindowsDir(dir: string): string {
  return dir.replace(/[\\/]+$/, '');
}

export function joinPlatformPath(platform: string, dir: string, name: string): string {
  if (platform === 'win32') return `${trimWindowsDir(dir)}\\${name}`;
  return `${dir.replace(/\/+$/, '')}/${name}`;
}

function buildWindowsFallbackDirs(env: Record<string, string>): string[] {
  const dirs: string[] = [];
  const appData = getEnvValueIgnoreCase(env, 'APPDATA');
  const localAppData = getEnvValueIgnoreCase(env, 'LOCALAPPDATA');
  const programFiles = getEnvValueIgnoreCase(env, 'ProgramFiles');
  const programData = getEnvValueIgnoreCase(env, 'ProgramData');
  const home = getEnvValueIgnoreCase(env, 'USERPROFILE') || getEnvValueIgnoreCase(env, 'HOME');
  if (appData) dirs.push(joinPlatformPath('win32', appData, 'npm'));
  if (localAppData) {
    dirs.push(joinPlatformPath('win32', localAppData, 'Volta\\bin'));
    dirs.push(joinPlatformPath('win32', localAppData, 'pnpm'));
  }
  if (programFiles) dirs.push(joinPlatformPath('win32', programFiles, 'nodejs'));
  if (home) {
    dirs.push(joinPlatformPath('win32', home, '.volta\\bin'));
    dirs.push(joinPlatformPath('win32', home, '.bun\\bin'));
    dirs.push(joinPlatformPath('win32', home, 'scoop\\shims'));
  }
  if (programData) dirs.push(joinPlatformPath('win32', programData, 'chocolatey\\bin'));
  return dirs;
}

function buildWindowsSpawnEnv(env: Record<string, string>): Record<string, string> {
  // Windows env names are case-insensitive, but a plain object copy is not, so keep a single PATH key.
  const pathKeys = Object.keys(env).filter((key) => key.toLowerCase() === 'path');
  const pathKey = pathKeys.find((key) => env[key] !== '') ?? pathKeys[0] ?? 'Path';
  const entries = (env[pathKey] ?? '').split(';').filter((entry) => entry.trim() !== '');
  const seen = new Set(entries.map((entry) => trimWindowsDir(entry).toLowerCase()));
  for (const candidate of buildWindowsFallbackDirs(env)) {
    const normalized = candidate.toLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    entries.push(candidate);
  }
  for (const key of pathKeys) delete env[key];
  env[pathKey] = entries.join(';');
  return env;
}

export function buildCodexSpawnEnv(base: Record<string, string | undefined>, platform = 'darwin'): Record<string, string> {
  const env = buildScrubbedEnv(base);
  if (platform === 'win32') return buildWindowsSpawnEnv(env);

  const home = (env.HOME || env.USERPROFILE || '').replace(/\/+$/, '');
  const candidates = [...PATH_FALLBACK_DIRS];
  if (home) {
    for (const dir of HOME_PATH_FALLBACK_DIRS) candidates.push(`${home}/${dir}`);
  }

  const entries = (env.PATH ?? '').split(':').filter((entry) => entry !== '');
  for (const candidate of candidates) {
    if (!entries.includes(candidate)) entries.push(candidate);
  }
  env.PATH = entries.join(':');
  return env;
}

export function buildCodexExecArgs(options: { schemaPath: string; cwd: string; model?: string }): string[] {
  const args = [
    'exec',
    '--ephemeral',
    '--ignore-user-config',
    '--sandbox',
    'read-only',
    '--skip-git-repo-check',
    '--disable',
    'plugins',
    '--disable',
    'apps',
    '--disable',
    'hooks',
    '--output-schema',
    options.schemaPath,
    '-C',
    options.cwd,
    '--json',
  ];
  const model = options.model?.trim();
  if (model) {
    args.push('--model', model);
  }
  args.push('-');
  return args;
}

export type CodexExecutableResolution =
  | { ok: true; executable: string }
  | { ok: false; error: string };

export interface CodexSpawnInvocation {
  command: string;
  args: string[];
  windowsVerbatimArguments?: boolean;
}

const WINDOWS_EXECUTABLE_EXTENSIONS = ['.exe', '.cmd', '.bat'];
const WINDOWS_BATCH_PATTERN = /\.(?:cmd|bat)$/i;

function hasWindowsExecutableExtension(path: string): boolean {
  const lower = path.toLowerCase();
  return WINDOWS_EXECUTABLE_EXTENSIONS.some((ext) => lower.endsWith(ext)) || lower.endsWith('.com');
}

async function fileExistsSafe(deps: CodexCliDependencies, path: string): Promise<boolean> {
  try {
    return (await deps.fileExists?.(path)) === true;
  } catch {
    return false;
  }
}

// On Windows, spawn() without a shell only finds .exe/.com on PATH, while npm installs Codex as codex.cmd,
// so the executable is resolved here before choosing how to launch it.
export async function resolveCodexExecutable(
  deps: CodexCliDependencies,
  platform: string,
  binaryPath: string | undefined,
  spawnEnv: Record<string, string>,
): Promise<CodexExecutableResolution> {
  const explicit = binaryPath?.trim() ?? '';
  if (platform !== 'win32') return { ok: true, executable: explicit || 'codex' };

  if (explicit) {
    if (/\.ps1$/i.test(explicit)) return { ok: false, error: CODEX_CLI_POWERSHELL_UNSUPPORTED_MESSAGE };
    if (!deps.fileExists) return { ok: true, executable: explicit };
    if (hasWindowsExecutableExtension(explicit)) {
      return (await fileExistsSafe(deps, explicit))
        ? { ok: true, executable: explicit }
        : { ok: false, error: CODEX_CLI_NOT_FOUND_MESSAGE };
    }
    for (const ext of WINDOWS_EXECUTABLE_EXTENSIONS) {
      if (await fileExistsSafe(deps, `${explicit}${ext}`)) return { ok: true, executable: `${explicit}${ext}` };
    }
    return { ok: false, error: CODEX_CLI_NOT_FOUND_MESSAGE };
  }

  if (!deps.fileExists) return { ok: true, executable: 'codex' };
  const pathValue = getEnvValueIgnoreCase(spawnEnv, 'PATH') ?? '';
  for (const dir of pathValue.split(';')) {
    if (dir.trim() === '') continue;
    for (const ext of WINDOWS_EXECUTABLE_EXTENSIONS) {
      const candidate = joinPlatformPath('win32', dir.trim(), `codex${ext}`);
      if (await fileExistsSafe(deps, candidate)) return { ok: true, executable: candidate };
    }
  }
  return { ok: false, error: CODEX_CLI_NOT_FOUND_MESSAGE };
}

// cmd.exe expands %VAR% even inside quotes and cannot escape a literal quote, so such arguments are refused.
// A trailing backslash is refused too: the CLI's argv parser would read `\"` as an escaped quote.
const CMD_UNSAFE_ARGUMENT = /["%\r\n\0]|\\$/;

export function buildCodexSpawnInvocation(
  platform: string,
  executable: string,
  args: string[],
  comspec: string,
): CodexSpawnInvocation | undefined {
  if (platform !== 'win32' || !WINDOWS_BATCH_PATTERN.test(executable)) {
    return { command: executable, args };
  }
  const parts = [executable, ...args];
  if (parts.some((part) => CMD_UNSAFE_ARGUMENT.test(part))) return undefined;
  const commandLine = parts.map((part) => `"${part}"`).join(' ');
  // Node refuses to spawn .cmd/.bat directly (CVE-2024-27980), so run it through cmd.exe the same way
  // Node's own `shell: true` does, with every argument quoted so cmd metacharacters stay literal.
  return {
    command: comspec,
    args: ['/d', '/v:off', '/s', '/c', `"${commandLine}"`],
    windowsVerbatimArguments: true,
  };
}

function resolveComspec(env: Record<string, string | undefined>): string {
  const comspec = getEnvValueIgnoreCase(env, 'ComSpec');
  if (comspec) return comspec;
  const systemRoot = getEnvValueIgnoreCase(env, 'SystemRoot') || 'C:\\Windows';
  return joinPlatformPath('win32', systemRoot, 'System32\\cmd.exe');
}

export function buildCodexOutputSchema(): string {
  return JSON.stringify(
    {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      required: ['summary'],
      properties: {
        summary: { type: 'array', items: { type: 'string' } },
        verdict: {
          type: 'object',
          properties: {
            recommendedAction: {
              type: 'string',
              enum: ['keep_as_reference', 'archive', 'read_later', 'task', 'delete_candidate'],
            },
          },
          additionalProperties: true,
        },
      },
      additionalProperties: true,
    },
    null,
    2,
  );
}

export function parseCodexLoginStatus(text: string): CodexLoginStatus {
  const lower = text.toLowerCase();
  if (lower.includes('logged in using chatgpt') || lower.includes('logged in with chatgpt')) {
    return { ok: true, authMode: 'chatgpt', authenticated: true };
  }
  if (lower.includes('api key')) {
    return { ok: false, authMode: 'api-key', authenticated: true };
  }
  if (lower.includes('not logged in') || lower.includes('logged out') || lower.includes('no credentials')) {
    return { ok: false, authMode: 'logged-out', authenticated: false };
  }
  return { ok: false, authMode: 'unknown', authenticated: false };
}

function parseJsonLines(stdout: string): unknown[] {
  const parsed: unknown[] = [];
  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith('{')) continue;
    try {
      parsed.push(JSON.parse(line));
    } catch {
      // Ignore non-JSON lines.
    }
  }
  return parsed;
}

function findFailureMessage(value: unknown, depth = 0): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value) || depth > 2) return undefined;
  const record = value as Record<string, unknown>;
  if (record.type === 'error' && typeof record.message === 'string') {
    return record.message;
  }
  if (record.type === 'turn.failed') {
    const error = record.error;
    if (error && typeof error === 'object' && typeof (error as Record<string, unknown>).message === 'string') {
      return (error as Record<string, unknown>).message as string;
    }
  }
  for (const key of ['msg', 'payload']) {
    const nested = findFailureMessage(record[key], depth + 1);
    if (typeof nested === 'string') return nested;
  }
  return undefined;
}

const MAX_FAILURE_REASON_CHARS = 300;
const BARE_API_KEY = /\bsk-[A-Za-z0-9_-]{8,}/g;

function sanitizeFailureReason(raw: string): string | undefined {
  // Sanitize before truncating so a secret cut in half cannot slip past the patterns.
  const singleLine = sanitizeSensitiveString(raw).replace(BARE_API_KEY, '[REDACTED]').replace(/\s+/g, ' ').trim();
  if (!singleLine) return undefined;
  return singleLine.length > MAX_FAILURE_REASON_CHARS
    ? `${singleLine.slice(0, MAX_FAILURE_REASON_CHARS)}...`
    : singleLine;
}

export function extractCodexFailureReason(stdout: string, stderr: string): string | undefined {
  let jsonReason: string | undefined;
  for (const entry of parseJsonLines(stdout)) {
    const message = findFailureMessage(entry);
    if (typeof message === 'string' && message.trim() !== '') jsonReason = message;
  }
  if (jsonReason) return sanitizeFailureReason(jsonReason);

  const stderrLines = stderr.split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== '');
  const lastStderrLine = stderrLines[stderrLines.length - 1];
  return lastStderrLine ? sanitizeFailureReason(lastStderrLine) : undefined;
}

function findAgentMessageText(value: unknown, depth = 0): string | undefined {
  if (!value || typeof value !== 'object' || depth > 6) return undefined;

  if (Array.isArray(value)) {
    let found: string | undefined;
    for (const entry of value) {
      const nested = findAgentMessageText(entry, depth + 1);
      if (typeof nested === 'string') found = nested;
    }
    return found;
  }

  const record = value as Record<string, unknown>;
  const item = record.item;
  if (item && typeof item === 'object') {
    const itemRecord = item as Record<string, unknown>;
    const itemType = typeof itemRecord.type === 'string' ? itemRecord.type : itemRecord.item_type;
    if (itemType === 'agent_message' && typeof itemRecord.text === 'string') {
      return itemRecord.text;
    }
  }

  const directType = typeof record.type === 'string' ? record.type : record.item_type;
  if (directType === 'agent_message' && typeof record.text === 'string') {
    return record.text;
  }

  for (const key of ['item', 'message', 'msg', 'data', 'payload']) {
    const nested = findAgentMessageText(record[key], depth + 1);
    if (typeof nested === 'string') return nested;
  }
  return undefined;
}

export function extractLastAgentMessage(stdout: string): string | undefined {
  let last: string | undefined;
  for (const entry of parseJsonLines(stdout)) {
    const text = findAgentMessageText(entry);
    if (typeof text === 'string') last = text;
  }
  return last;
}

let activeRuns = 0;
const runWaiters: Array<() => void> = [];

async function acquireRunSlot(): Promise<void> {
  if (activeRuns < 1) {
    activeRuns += 1;
    return;
  }
  await new Promise<void>((resolve) => runWaiters.push(resolve));
  activeRuns += 1;
}

function releaseRunSlot(): void {
  activeRuns = Math.max(0, activeRuns - 1);
  const next = runWaiters.shift();
  if (next) next();
}

let codexCliDependencies: CodexCliDependencies | undefined;

export function setCodexCliDependencies(dependencies: CodexCliDependencies | undefined): void {
  codexCliDependencies = dependencies;
}

function loadNodeModule<T>(name: string): T | undefined {
  try {
    const nodeRequire = typeof require === 'function' ? (require as (id: string) => unknown) : undefined;
    if (!nodeRequire) return undefined;
    return nodeRequire(name) as T;
  } catch {
    return undefined;
  }
}

function createDefaultDependencies(): CodexCliDependencies {
  const childProcess = loadNodeModule<{ spawn: unknown }>('node:child_process') ?? loadNodeModule<{ spawn: unknown }>('child_process');
  const fs = loadNodeModule<Record<string, unknown>>('node:fs/promises') ?? loadNodeModule<Record<string, unknown>>('fs/promises');
  const os = loadNodeModule<Record<string, unknown>>('node:os') ?? loadNodeModule<Record<string, unknown>>('os');

  if (!childProcess || !fs || !os) {
    return {
      platform: () => 'unsupported',
      tmpdir: () => '',
      env: () => ({}),
      mkdtemp: async () => {
        throw new Error('Codex CLI dependencies are unavailable.');
      },
      writeFile: async () => {
        throw new Error('Codex CLI dependencies are unavailable.');
      },
      rm: async () => {},
      spawn: () => {
        throw new Error('Codex CLI dependencies are unavailable.');
      },
    };
  }

  const platform = String((os.platform as () => string)());
  const isWindows = platform === 'win32';
  const spawnChild = childProcess.spawn as (c: string, a: string[], o: unknown) => CodexChildProcess;

  return {
    platform: () => platform,
    tmpdir: () => String((os.tmpdir as () => string)()),
    env: () => process.env as Record<string, string | undefined>,
    mkdtemp: (prefix) => (fs.mkdtemp as (p: string) => Promise<string>)(prefix),
    writeFile: (path, data) => (fs.writeFile as (p: string, d: string) => Promise<void>)(path, data),
    rm: (path, options) => (fs.rm as (p: string, o: { recursive: boolean; force: boolean }) => Promise<void>)(path, options),
    fileExists: async (path) => {
      try {
        const stats = await (fs.stat as (p: string) => Promise<{ isFile(): boolean }>)(path);
        return stats.isFile();
      } catch {
        return false;
      }
    },
    spawn: (command, args, options) => spawnChild(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      // A detached child on Windows gets its own console window; the tree is killed with taskkill instead.
      detached: !isWindows,
      windowsHide: true,
      windowsVerbatimArguments: options.windowsVerbatimArguments === true,
    }),
    killTree: (pid) => {
      if (isWindows) {
        try {
          const systemRoot = getEnvValueIgnoreCase(process.env as Record<string, string | undefined>, 'SystemRoot') || 'C:\\Windows';
          const killer = spawnChild(joinPlatformPath('win32', systemRoot, 'System32\\taskkill.exe'), ['/pid', String(pid), '/T', '/F'], {
            stdio: 'ignore',
            windowsHide: true,
          });
          killer.on('error', () => {
            try {
              process.kill(pid);
            } catch {
              // Process already gone.
            }
          });
        } catch {
          try {
            process.kill(pid);
          } catch {
            // Process already gone.
          }
        }
        return;
      }
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          // Process already gone.
        }
      }
    },
  };
}

function getDependencies(): CodexCliDependencies {
  if (!codexCliDependencies) {
    codexCliDependencies = createDefaultDependencies();
  }
  return codexCliDependencies;
}

interface CapturedRun {
  stdout: string;
  stderr: string;
  code: number | null;
  timedOut: boolean;
  aborted: boolean;
  spawned: boolean;
  spawnFailed: boolean;
  truncated: boolean;
}

function runChild(
  deps: CodexCliDependencies,
  invocation: CodexSpawnInvocation,
  options: { cwd: string; env: Record<string, string>; input: string; timeoutMs: number; isUnloaded?: () => boolean },
): Promise<CapturedRun> {
  return new Promise<CapturedRun>((resolve) => {
    const state: CapturedRun = { stdout: '', stderr: '', code: null, timedOut: false, aborted: false, spawned: false, spawnFailed: false, truncated: false };
    let settled = false;
    let child: CodexChildProcess;
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
    let unloadTimer: ReturnType<typeof setInterval> | undefined;

    const terminate = () => {
      try {
        if (deps.killTree && typeof child?.pid === 'number') {
          deps.killTree(child.pid);
        } else {
          child?.kill('SIGKILL');
        }
      } catch {
        // Process already gone.
      }
    };

    const finish = () => {
      if (settled) return;
      settled = true;
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (unloadTimer) clearInterval(unloadTimer);
      resolve(state);
    };

    try {
      child = deps.spawn(invocation.command, invocation.args, {
        cwd: options.cwd,
        env: options.env,
        ...(invocation.windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}),
      });
    } catch {
      state.code = -1;
      state.spawnFailed = true;
      finish();
      return;
    }
    state.spawned = true;

    timeoutTimer = options.timeoutMs > 0 ? setTimeout(() => {
      state.timedOut = true;
      terminate();
    }, options.timeoutMs) : undefined;

    if (options.isUnloaded) {
      unloadTimer = setInterval(() => {
        if (options.isUnloaded?.()) {
          state.aborted = true;
          terminate();
        }
      }, 500);
    }

    child.stdout.on('data', (chunk) => {
      const text = chunkToText(chunk);
      if (state.stdout.length + text.length > MAX_CAPTURE_BYTES) {
        state.truncated = true;
        state.stdout += text.slice(0, Math.max(0, MAX_CAPTURE_BYTES - state.stdout.length));
        return;
      }
      state.stdout += text;
    });
    child.stderr.on('data', (chunk) => {
      if (state.stderr.length < MAX_CAPTURE_BYTES) state.stderr += chunkToText(chunk);
    });
    child.on('error', (error) => {
      state.code = -1;
      if (isSpawnFailure(error)) state.spawnFailed = true;
      finish();
    });
    child.on('close', (code) => {
      state.code = code;
      finish();
    });

    try {
      child.stdin.write(options.input);
      child.stdin.end();
    } catch {
      terminate();
    }
  });
}

const SPAWN_FAILURE_CODES = new Set(['ENOENT', 'EACCES', 'ENOTDIR']);

function isSpawnFailure(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && SPAWN_FAILURE_CODES.has(code);
}

function chunkToText(chunk: unknown): string {
  if (typeof chunk === 'string') return chunk;
  if (chunk && typeof (chunk as { toString?: unknown }).toString === 'function') {
    return String(chunk);
  }
  return '';
}

interface CodexRunContext {
  platform: string;
  env: Record<string, string>;
  executable: string;
  comspec: string;
}

async function prepareCodexRun(
  deps: CodexCliDependencies,
  binaryPath: string | undefined,
): Promise<{ ok: true; context: CodexRunContext } | { ok: false; error: string }> {
  const platform = deps.platform();
  const rawEnv = deps.env();
  const env = buildCodexSpawnEnv(rawEnv, platform);
  const resolution = await resolveCodexExecutable(deps, platform, binaryPath, env);
  if (!resolution.ok) return resolution;
  return {
    ok: true,
    context: {
      platform,
      env,
      executable: resolution.executable,
      comspec: platform === 'win32' ? resolveComspec(rawEnv) : '',
    },
  };
}

function buildInvocationFor(context: CodexRunContext, args: string[]): CodexSpawnInvocation | undefined {
  return buildCodexSpawnInvocation(context.platform, context.executable, args, context.comspec);
}

const LOGIN_STATUS_ARGS = ['login', 'status'];

async function runCodexLoginStatusInternal(deps: CodexCliDependencies, context: CodexRunContext): Promise<CodexLoginStatus> {
  const invocation = buildInvocationFor(context, LOGIN_STATUS_ARGS);
  if (!invocation) {
    return { ok: false, authMode: 'unavailable', authenticated: false };
  }

  let tempDir = '';
  try {
    tempDir = await deps.mkdtemp(joinPlatformPath(context.platform, deps.tmpdir(), 'inbox-curator-codex-login-'));
    const captured = await runChild(deps, invocation, {
      cwd: tempDir,
      env: context.env,
      input: '',
      timeoutMs: 15000,
    });
    if (captured.spawnFailed) {
      return { ok: false, authMode: 'unavailable', authenticated: false };
    }
    return parseCodexLoginStatus(`${captured.stdout}\n${captured.stderr}`);
  } catch {
    return { ok: false, authMode: 'unknown', authenticated: false };
  } finally {
    if (tempDir) {
      try {
        await deps.rm(tempDir, { recursive: true, force: true });
      } catch {
        // Best effort cleanup.
      }
    }
  }
}

export async function getCodexLoginStatus(binaryPath?: string): Promise<CodexLoginStatus> {
  const deps = getDependencies();
  await acquireRunSlot();
  try {
    const prepared = await prepareCodexRun(deps, binaryPath);
    if (!prepared.ok) return { ok: false, authMode: 'unavailable', authenticated: false };
    return await runCodexLoginStatusInternal(deps, prepared.context);
  } catch {
    return { ok: false, authMode: 'unknown', authenticated: false };
  } finally {
    releaseRunSlot();
  }
}

export async function runCodexExec(request: CodexExecRequest): Promise<CodexExecResult> {
  if (request.background && request.allowBackground !== true) {
    return { ok: false, error: 'Codex CLI background runs are disabled.', retryable: false, reason: 'disabled' };
  }

  const deps = getDependencies();

  await acquireRunSlot();
  let tempDir = '';
  try {
    const prepared = await prepareCodexRun(deps, request.binaryPath);
    if (!prepared.ok) {
      return { ok: false, error: prepared.error, retryable: false, reason: 'unavailable' };
    }
    const context = prepared.context;
    if (!buildInvocationFor(context, LOGIN_STATUS_ARGS)) {
      return { ok: false, error: CODEX_CLI_UNSAFE_ARGUMENT_MESSAGE, retryable: false, reason: 'unavailable' };
    }

    const loginStatus = await runCodexLoginStatusInternal(deps, context);
    if (loginStatus.authMode === 'unavailable') {
      return { ok: false, error: CODEX_CLI_NOT_FOUND_MESSAGE, retryable: false, reason: 'unavailable' };
    }
    if (!loginStatus.ok) {
      return {
        ok: false,
        error: loginStatus.authMode === 'api-key'
          ? 'Codex CLI is authenticated with an API key; ChatGPT login is required.'
          : 'Codex CLI is not logged in with ChatGPT.',
        retryable: false,
        reason: 'login',
      };
    }

    tempDir = await deps.mkdtemp(joinPlatformPath(context.platform, deps.tmpdir(), 'inbox-curator-codex-'));
    const schemaPath = joinPlatformPath(context.platform, tempDir, 'schema.json');
    const args = buildCodexExecArgs({ schemaPath, cwd: tempDir, model: request.model });
    const invocation = buildInvocationFor(context, args);
    if (!invocation) {
      return { ok: false, error: CODEX_CLI_UNSAFE_ARGUMENT_MESSAGE, retryable: false, reason: 'unavailable' };
    }
    await deps.writeFile(schemaPath, buildCodexOutputSchema());

    const captured = await runChild(deps, invocation, {
      cwd: tempDir,
      env: context.env,
      input: request.prompt,
      timeoutMs: request.timeoutMs && request.timeoutMs > 0 ? request.timeoutMs : 120000,
      isUnloaded: request.isUnloaded,
    });

    if (captured.spawnFailed) {
      return { ok: false, error: CODEX_CLI_NOT_FOUND_MESSAGE, retryable: false, reason: 'unavailable' };
    }

    if (captured.aborted) {
      return { ok: false, error: 'Codex CLI run was cancelled.', retryable: true, reason: 'aborted' };
    }
    if (captured.timedOut) {
      return { ok: false, error: 'Codex CLI run timed out.', retryable: true, reason: 'timeout' };
    }
    if (captured.code !== 0) {
      const exitCode = captured.code === null ? 'unknown' : captured.code;
      const failureReason = extractCodexFailureReason(captured.stdout, captured.stderr);
      return {
        ok: false,
        error: failureReason
          ? `Codex CLI exited with code ${exitCode}: ${failureReason}`
          : `Codex CLI exited with code ${exitCode}.`,
        retryable: false,
        reason: 'exit',
      };
    }
    if (captured.truncated) {
      return { ok: false, error: 'Codex CLI output was truncated.', retryable: false, reason: 'invalid-output' };
    }

    const content = extractLastAgentMessage(captured.stdout);
    if (!content || content.trim() === '') {
      return { ok: false, error: 'Codex CLI produced no final message.', retryable: false, reason: 'invalid-output' };
    }

    return { ok: true, content: sanitizeSensitiveString(content) };
  } catch {
    return { ok: false, error: 'Codex CLI could not be started.', retryable: false, reason: 'unavailable' };
  } finally {
    if (tempDir) {
      try {
        await deps.rm(tempDir, { recursive: true, force: true });
      } catch {
        // Best effort cleanup.
      }
    }
    releaseRunSlot();
  }
}

export function isCodexCliRunnable(settings: CodexCliSettings): boolean {
  return settings.enabled && settings.consentAcknowledged;
}
