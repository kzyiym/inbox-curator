import { App } from 'obsidian';
import {
  appendToFile,
  ensureLogFolder,
  getLogFilePath,
  isOperationLoggingEnabled,
  removeLogFilesOlderThan,
  getLogFileCount,
  getLogEntryCount,
  clearLogFilesByPrefix,
} from './logFiles';

export type OperationLogLevel = 'INFO' | 'WARN' | 'ERROR';

export interface OperationLogEntry {
  timestamp: string;
  level: OperationLogLevel;
  event: string;
  operationId?: string;
  notePath?: string;
  filePath?: string;
  reviewNotePath?: string;
  provider?: string;
  model?: string;
  durationMs?: number;
  statusCode?: number;
  tokenUsage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  actionType?: string;
  stage?: string;
  message?: string;
  errorKind?: string;
  details?: Record<string, string | number | boolean | null>;
}

const LOG_PREFIX = 'operations';
const RETENTION_DAYS = 7;

export function buildOperationLogFileName(date?: Date): string {
  return getLogFilePath(LOG_PREFIX, date);
}

export async function logOperation(app: App, entry: OperationLogEntry): Promise<void> {
  if (!isOperationLoggingEnabled()) {
    return;
  }

  try {
    await ensureLogFolder(app);
    await removeLogFilesOlderThan(app, LOG_PREFIX, RETENTION_DAYS);
    const path = buildOperationLogFileName();
    const line = JSON.stringify(entry) + '\n';
    await appendToFile(app, path, line);
  } catch (e) {
    console.error('Inbox Curator: Failed to write operation log', e);
  }
}

export async function getOperationLogFileCount(app: App): Promise<number> {
  return getLogFileCount(app, LOG_PREFIX);
}

export async function getOperationLogEntryCount(app: App): Promise<number> {
  return getLogEntryCount(app, LOG_PREFIX);
}

export async function clearOperationLogs(app: App): Promise<void> {
  await clearLogFilesByPrefix(app, LOG_PREFIX);
}

export async function cleanupOldOperationLogs(app: App): Promise<void> {
  try {
    await ensureLogFolder(app);
    await removeLogFilesOlderThan(app, LOG_PREFIX, RETENTION_DAYS);
  } catch (e) {
    console.warn('Inbox Curator: Failed to clean up old operation logs', e);
  }
}
