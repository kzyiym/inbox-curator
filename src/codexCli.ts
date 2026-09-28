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
  | 'invalid-output'
  | 'unsupported-platform';

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
  spawn(command: string, args: string[], options: { cwd: string; env: Record<string, string>; detached?: boolean }): CodexChildProcess;
  killTree?(pid: number): void;
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

export function buildCodexSpawnEnv(base: Record<string, string | undefined>): Record<string, string> {
  const env = buildScrubbedEnv(base);
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

function extractTextFromMessageLine(line: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }
  return findAgentMessageText(parsed);
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
  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith('{')) continue;
    const text = extractTextFromMessageLine(line);
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

  return {
    platform: () => String((os.platform as () => string)()),
    tmpdir: () => String((os.tmpdir as () => string)()),
    env: () => process.env as Record<string, string | undefined>,
    mkdtemp: (prefix) => (fs.mkdtemp as (p: string) => Promise<string>)(prefix),
    writeFile: (path, data) => (fs.writeFile as (p: string, d: string) => Promise<void>)(path, data),
    rm: (path, options) => (fs.rm as (p: string, o: { recursive: boolean; force: boolean }) => Promise<void>)(path, options),
    spawn: (command, args, options) => (childProcess.spawn as (c: string, a: string[], o: unknown) => CodexChildProcess)(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true,
    }),
    killTree: (pid) => {
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
  command: string,
  args: string[],
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
      child = deps.spawn(command, args, { cwd: options.cwd, env: options.env });
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

async function runCodexLoginStatusInternal(deps: CodexCliDependencies, binaryPath?: string): Promise<CodexLoginStatus> {
  if (deps.platform() === 'win32') {
    return { ok: false, authMode: 'unknown', authenticated: false };
  }

  let tempDir = '';
  try {
    tempDir = await deps.mkdtemp(`${deps.tmpdir()}/inbox-curator-codex-login-`);
    const env = buildCodexSpawnEnv(deps.env());
    const command = binaryPath?.trim() || 'codex';
    const captured = await runChild(deps, command, ['login', 'status'], {
      cwd: tempDir,
      env,
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
    return await runCodexLoginStatusInternal(deps, binaryPath);
  } finally {
    releaseRunSlot();
  }
}

export async function runCodexExec(request: CodexExecRequest): Promise<CodexExecResult> {
  if (request.background && request.allowBackground !== true) {
    return { ok: false, error: 'Codex CLI background runs are disabled.', retryable: false, reason: 'disabled' };
  }

  const deps = getDependencies();
  const platform = deps.platform();
  if (platform === 'win32') {
    return {
      ok: false,
      error: 'Codex CLI is not supported on Windows in this version.',
      retryable: false,
      reason: 'unsupported-platform',
    };
  }

  await acquireRunSlot();
  let tempDir = '';
  try {
    const loginStatus = await runCodexLoginStatusInternal(deps, request.binaryPath);
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

    tempDir = await deps.mkdtemp(`${deps.tmpdir()}/inbox-curator-codex-`);
    const schemaPath = `${tempDir}/schema.json`;
    await deps.writeFile(schemaPath, buildCodexOutputSchema());

    const args = buildCodexExecArgs({ schemaPath, cwd: tempDir, model: request.model });
    const env = buildCodexSpawnEnv(deps.env());
    const command = request.binaryPath?.trim() || 'codex';

    const captured = await runChild(deps, command, args, {
      cwd: tempDir,
      env,
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
      return {
        ok: false,
        error: `Codex CLI exited with code ${captured.code === null ? 'unknown' : captured.code}.`,
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
