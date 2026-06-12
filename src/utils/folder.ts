import { App, normalizePath } from 'obsidian';

/**
 * Creates a dot-prefixed internal folder (e.g. `.inbox-curator/`) using the adapter.
 * The Obsidian Vault API does not track dot-folders, so we bypass it entirely.
 */
export async function ensureDotFolder(app: App, folderPath: string): Promise<void> {
  const adapter = app.vault.adapter;
  const normalized = normalizePath(folderPath);
  if (!normalized || normalized === '.') {
    return;
  }

  const parts = normalized.split('/');
  let current = '';

  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    if (!(await adapter.exists(current))) {
      await adapter.mkdir(current);
    }
  }
}

/**
 * Ensures that the specified folder path exists in the vault.
 * If any parent folders do not exist, they are created automatically.
 * Safe against concurrent creation race conditions.
 */
export async function ensureFolder(app: App, folderPath: string): Promise<void> {
  const normalized = normalizePath(folderPath);
  if (!normalized || normalized === '.') {
    return;
  }

  const parts = normalized.split('/');
  let current = '';

  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    const existing = app.vault.getAbstractFileByPath(current);
    if (!existing) {
      try {
        await app.vault.createFolder(current);
      } catch (error) {
        if (error instanceof Error && error.message.includes('already exists')) {
          continue;
        }
        const checkExisting = app.vault.getAbstractFileByPath(current);
        if (!checkExisting) {
          const existsOnDisk = await app.vault.adapter.exists(current);
          if (!existsOnDisk) {
            console.error('Inbox Curator: Failed to create folder', current, error);
            throw error;
          }
        }
      }
    }
  }
}

/**
 * Safely resolves the final folder path for suggested folders.
 * Appends suggestedFolder to basePath (if configured) and sanitizes against:
 * - Directory traversal (..)
 * - absolute/root paths (/ or \)
 * - restricted folders (.obsidian, .git)
 * - Windows reserved names (CON, PRN, etc.)
 * - Invalid/control characters
 * - Extremely long paths (max 255 chars)
 */
export function resolveSafeSuggestedPath(suggestedFolder: string, basePath?: string): string | null {
  const cleanFolder = suggestedFolder.trim();
  if (
    !cleanFolder ||
    cleanFolder.startsWith('/') ||
    cleanFolder.startsWith('\\') ||
    cleanFolder.startsWith('~') ||
    /^[a-zA-Z]:[/\\]/.test(cleanFolder) ||
    cleanFolder.split(/[/\\]/).some(part => part.trim() === '..')
  ) {
    return null;
  }

  const parts: string[] = [];

  // 1. Process base path first if configured
  if (basePath) {
    const baseClean = basePath.replace(/\\/g, '/').trim();
    if (baseClean) {
      parts.push(...baseClean.split('/'));
    }
  }

  // 2. Process suggested folder
  const suggestedClean = cleanFolder.replace(/\\/g, '/');
  if (suggestedClean) {
    parts.push(...suggestedClean.split('/'));
  }

  const resolvedParts: string[] = [];
  const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
  // eslint-disable-next-line no-control-regex -- Control chars (\0-\x1F) must be matched literally for path sanitization
  const INVALID_CHARS = /[<>:"|?*\\'\0-\x1F]/;

  for (const part of parts) {
    const trimmedPart = part.trim();
    
    if (trimmedPart === '') {
      continue;
    }
    
    // Safety checks:
    // current dir (.), parent dir (..), hidden folders (.obsidian / .git), control chars
    if (
      trimmedPart === '.' ||
      trimmedPart === '..' ||
      trimmedPart.startsWith('.') ||
      INVALID_CHARS.test(trimmedPart)
    ) {
      return null;
    }
    
    // Windows device name check
    if (WINDOWS_RESERVED.test(trimmedPart)) {
      return null;
    }

    resolvedParts.push(trimmedPart);
  }

  if (resolvedParts.length === 0) {
    return null;
  }

  const combinedPath = resolvedParts.join('/');
  if (combinedPath.length > 255) {
    return null;
  }

  // Join and normalize path using Obsidian's helper
  const finalPath = normalizePath(combinedPath);
  
  // Final checks: cannot be root, cannot target hidden files, cannot contain traversal
  if (!finalPath || finalPath === '.' || finalPath.startsWith('.') || finalPath.includes('/.')) {
    return null;
  }

  return finalPath;
}

export type FolderPathValidationReason = 'empty' | 'dot_prefix';

export interface FolderPathValidationResult {
  sanitized: string;
  changed: boolean;
  reason?: FolderPathValidationReason;
}

/**
 * Validates a user-configurable folder path. Dot-prefixed components
 * (e.g. `.inbox-curator`) are rejected because the Obsidian Vault API
 * cannot interact with hidden folders.
 */
export function validateFolderPath(value: string, defaultValue: string): FolderPathValidationResult {
  const trimmed = value.trim();
  if (!trimmed) {
    return { sanitized: defaultValue, changed: true, reason: 'empty' };
  }

  const sanitized = trimmed.replace(/\\/g, '/');
  const parts = sanitized.split('/').filter((p) => p.length > 0);
  if (parts.some((p) => p.startsWith('.'))) {
    return { sanitized: defaultValue, changed: true, reason: 'dot_prefix' };
  }

  return { sanitized, changed: false };
}
