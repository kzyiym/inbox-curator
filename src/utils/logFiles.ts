import { App, normalizePath, TFile } from 'obsidian';
import { ensureFolder } from './folder';

export type LogLevel = 'off' | 'errors' | 'operations';

let logLevelGetter: (() => LogLevel) | null = null;

export function setLogLevelGetter(getter: () => LogLevel): void {
  logLevelGetter = getter;
}

export function getCurrentLogLevel(): LogLevel {
  return logLevelGetter?.() ?? 'errors';
}

export function isErrorLoggingEnabled(): boolean {
  const level = getCurrentLogLevel();
  return level === 'errors' || level === 'operations';
}

export function isOperationLoggingEnabled(): boolean {
  return getCurrentLogLevel() === 'operations';
}

export const LOG_FOLDER = normalizePath('.inbox-curator/logs');

export function getLogFilePath(prefix: string, date?: Date): string {
  const now = date ?? new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return normalizePath(`${LOG_FOLDER}/${prefix}-${y}-${m}-${d}.log`);
}

export function getLogFilePrefix(fileName: string): string | null {
  const match = fileName.match(/^(.+?)-\d{4}-\d{2}-\d{2}\.log$/);
  return match ? match[1] : null;
}

export function parseLogFileDate(fileName: string): Date | null {
  const match = fileName.match(/-(\d{4})-(\d{2})-(\d{2})\.log$/);
  if (!match) return null;
  const ts = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00.000Z`);
  return isNaN(ts.getTime()) ? null : ts;
}

export async function ensureLogFolder(app: App): Promise<void> {
  await ensureFolder(app, LOG_FOLDER);
}

export async function appendToFile(app: App, path: string, content: string): Promise<void> {
  const existing = app.vault.getAbstractFileByPath(path);
  if (existing instanceof TFile) {
    await app.vault.process(existing, (data) => data + content);
  } else {
    try {
      await app.vault.create(path, content);
    } catch {
      const retryFile = app.vault.getAbstractFileByPath(path);
      if (retryFile instanceof TFile) {
        await app.vault.process(retryFile, (data) => data + content);
      } else {
        throw new Error(`Failed to create log file: ${path}`);
      }
    }
  }
}

async function listAllLogFiles(app: App): Promise<string[]> {
  const adapter = app.vault.adapter;
  const exists = await adapter.exists(LOG_FOLDER);
  if (!exists) return [];
  const entries = await adapter.list(LOG_FOLDER);
  return entries.files.filter((f) => f.endsWith('.log'));
}

export async function listLogFilesByPrefix(app: App, prefix: string): Promise<string[]> {
  const all = await listAllLogFiles(app);
  return all.filter((f) => {
    const name = f.split('/').pop() ?? '';
    return name.startsWith(`${prefix}-`) && name.endsWith('.log');
  });
}

export async function removeLogFilesOlderThan(app: App, prefix: string, days: number, referenceDate?: Date): Promise<void> {
  const now = referenceDate?.getTime() ?? Date.now();
  const cutoff = now - days * 24 * 60 * 60 * 1000;
  const files = await listLogFilesByPrefix(app, prefix);
  const adapter = app.vault.adapter;
  for (const f of files) {
    const date = parseLogFileDate(f);
    if (date && date.getTime() < cutoff) {
      try {
        await adapter.remove(normalizePath(f));
      } catch (e) {
        console.warn('Inbox Curator: Failed to remove old log file', f, e);
      }
    }
  }
}

export async function readLogFileContent(app: App, path: string): Promise<string> {
  const adapter = app.vault.adapter;
  if (await adapter.exists(path)) {
    return await adapter.read(path);
  }
  return '';
}

export async function getLogFileCount(app: App, prefix: string): Promise<number> {
  const files = await listLogFilesByPrefix(app, prefix);
  return files.length;
}

export async function getLogEntryCount(app: App, prefix: string): Promise<number> {
  const files = await listLogFilesByPrefix(app, prefix);
  let total = 0;
  for (const f of files) {
    const content = await readLogFileContent(app, normalizePath(f));
    const lines = content.trim().split('\n').filter((l) => l.length > 0);
    total += lines.length;
  }
  return total;
}

export async function clearLogFilesByPrefix(app: App, prefix: string): Promise<void> {
  const files = await listLogFilesByPrefix(app, prefix);
  const adapter = app.vault.adapter;
  for (const f of files) {
    try {
      await adapter.remove(normalizePath(f));
    } catch (e) {
      console.warn('Inbox Curator: Failed to clear log file', f, e);
    }
  }
}
