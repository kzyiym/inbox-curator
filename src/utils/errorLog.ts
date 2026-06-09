import { App, normalizePath, TFile } from 'obsidian';
import { ensureFolder } from './folder';
import { isErrorLoggingEnabled } from './logFiles';

const LOG_FOLDER = normalizePath('.inbox-curator/logs');

function getLogFilePath(date?: Date): string {
  const now = date ?? new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return normalizePath(`${LOG_FOLDER}/errors-${y}-${m}-${d}.log`);
}

function formatEntry(
  timestamp: string,
  level: string,
  message: string,
  details?: Record<string, unknown>,
): string {
  const lines = [`[${timestamp}] [${level}] ${message}`];
  if (details) {
    for (const [key, value] of Object.entries(details)) {
      const str = typeof value === 'string' ? value : JSON.stringify(value);
      lines.push(`  ${key}: ${str}`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

export async function logError(
  app: App,
  level: 'ERROR' | 'WARN',
  message: string,
  details?: Record<string, unknown>,
): Promise<void> {
  if (!isErrorLoggingEnabled()) {
    return;
  }

  const timestamp = new Date().toISOString();

  console.warn(message, details);

  try {
    await ensureFolder(app, LOG_FOLDER);
    const path = getLogFilePath();
    const existing = app.vault.getAbstractFileByPath(path);
    let content = '';
    if (existing instanceof TFile) {
      content = await app.vault.read(existing);
    }
    content += formatEntry(timestamp, level, message, details);
    if (existing instanceof TFile) {
      await app.vault.modify(existing, content);
    } else {
      await app.vault.create(path, content);
    }
  } catch (e) {
    console.error('Inbox Curator: Failed to write error log file', e);
  }
}

export interface ErrorLogStats {
  totalEntries: number;
  latestTimestamp: string | null;
  fileSize: number;
  todayEntries: number;
}

const ENTRY_REGEX = /^\[/gm;

async function listLogFiles(app: App): Promise<string[]> {
  const adapter = app.vault.adapter;
  const exists = await adapter.exists(LOG_FOLDER);
  if (!exists) return [];

  const entries = await adapter.list(LOG_FOLDER);
  return entries.files.filter((f) => f.endsWith('.log'));
}

async function readLogFile(app: App, path: string): Promise<string> {
  const adapter = app.vault.adapter;
  if (await adapter.exists(path)) {
    return await adapter.read(path);
  }
  return '';
}

export async function getErrorLogStats(app: App): Promise<ErrorLogStats> {
  const stats: ErrorLogStats = {
    totalEntries: 0,
    latestTimestamp: null,
    fileSize: 0,
    todayEntries: 0,
  };

  try {
    const files = await listLogFiles(app);
    if (files.length === 0) return stats;

    const todayPath = getLogFilePath();
    const todayFullPath = normalizePath(todayPath);

    let total = 0;
    for (const f of files) {
      const fullPath = normalizePath(f);
      const content = await readLogFile(app, fullPath);
      const matches = content.match(ENTRY_REGEX);
      const count = matches ? matches.length : 0;
      total += count;

      if (fullPath === todayFullPath) {
        stats.fileSize = content.length;
        stats.todayEntries = count;

        const firstLine = content.split('\n').find((l) => l.startsWith('['));
        if (firstLine) {
          const ts = firstLine.slice(1, firstLine.indexOf(']'));
          stats.latestTimestamp = ts;
        }
      }
    }
    stats.totalEntries = total;
  } catch (e) {
    console.warn('Inbox Curator: Failed to read error log stats', e);
  }

  return stats;
}

export async function clearErrorLogs(app: App): Promise<void> {
  try {
    const files = await listLogFiles(app);
    const adapter = app.vault.adapter;
    for (const f of files) {
      await adapter.remove(normalizePath(f));
    }
  } catch (e) {
    console.warn('Inbox Curator: Failed to clear error logs', e);
  }
}

export function getErrorLogFolderPath(): string {
  return LOG_FOLDER;
}
