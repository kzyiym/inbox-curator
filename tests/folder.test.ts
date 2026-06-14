import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ensureDotFolder, resolveSafeSuggestedPath, validateFolderPath } from '../src/utils/folder';

function createMockApp() {
  const files = new Map<string, string>();
  const adapter = {
    exists: vi.fn(async (path: string) => files.has(path)),
    mkdir: vi.fn(async (path: string) => { files.set(path, ''); }),
  };
  const vault = {
    adapter,
    getAbstractFileByPath: vi.fn(() => null),
    createFolder: vi.fn(async () => {}),
  };
  return { vault } as any;
}

describe('ensureDotFolder', () => {
  let app: any;

  beforeEach(() => {
    app = createMockApp();
  });

  it('creates .inbox-curator via adapter.mkdir when it does not exist', async () => {
    await ensureDotFolder(app, '.inbox-curator');
    expect(app.vault.adapter.mkdir).toHaveBeenCalledWith('.inbox-curator');
    expect(app.vault.createFolder).not.toHaveBeenCalled();
  });

  it('does not call adapter.mkdir when folder already exists', async () => {
    app.vault.adapter.exists.mockResolvedValueOnce(true);
    await ensureDotFolder(app, '.inbox-curator');
    expect(app.vault.adapter.mkdir).not.toHaveBeenCalled();
  });

  it('creates nested path .inbox-curator/logs correctly', async () => {
    await ensureDotFolder(app, '.inbox-curator/logs');
    expect(app.vault.adapter.mkdir).toHaveBeenCalledTimes(2);
    expect(app.vault.adapter.mkdir).toHaveBeenCalledWith('.inbox-curator');
    expect(app.vault.adapter.mkdir).toHaveBeenCalledWith('.inbox-curator/logs');
  });

  it('creates only missing parts of nested path', async () => {
    app.vault.adapter.exists.mockImplementation(async (path: string) => path === '.inbox-curator');
    await ensureDotFolder(app, '.inbox-curator/logs');
    // mkdir called only for logs (parent already exists)
    expect(app.vault.adapter.mkdir).toHaveBeenCalledTimes(1);
    expect(app.vault.adapter.mkdir).toHaveBeenCalledWith('.inbox-curator/logs');
  });

  it('never calls vault.createFolder or vault.getAbstractFileByPath', async () => {
    await ensureDotFolder(app, '.inbox-curator/logs');
    expect(app.vault.createFolder).not.toHaveBeenCalled();
    expect(app.vault.getAbstractFileByPath).not.toHaveBeenCalled();
  });

  it('is a no-op for root path', async () => {
    await ensureDotFolder(app, '.');
    expect(app.vault.adapter.mkdir).not.toHaveBeenCalled();
    expect(app.vault.adapter.exists).not.toHaveBeenCalled();
  });

  it('is a no-op for empty path', async () => {
    await ensureDotFolder(app, '');
    expect(app.vault.adapter.mkdir).not.toHaveBeenCalled();
  });
});

describe('validateFolderPath', () => {
  it('accepts plain folder names', () => {
    const r = validateFolderPath('Inbox', 'Inbox');
    expect(r.sanitized).toBe('Inbox');
    expect(r.changed).toBe(false);
  });

  it('accepts nested paths', () => {
    const r = validateFolderPath('Projects/Inbox', 'Inbox');
    expect(r.sanitized).toBe('Projects/Inbox');
    expect(r.changed).toBe(false);
  });

  it('accepts pathes with spaces', () => {
    const r = validateFolderPath('AI Reviews', 'AI Reviews');
    expect(r.sanitized).toBe('AI Reviews');
    expect(r.changed).toBe(false);
  });

  it('accepts empty string and resets to default', () => {
    const r = validateFolderPath('', 'Inbox');
    expect(r.sanitized).toBe('Inbox');
    expect(r.changed).toBe(true);
    expect(r.reason).toBe('empty');
  });

  it('rejects dot-prefixed folder name', () => {
    const r = validateFolderPath('.private', 'Inbox');
    expect(r.sanitized).toBe('Inbox');
    expect(r.changed).toBe(true);
    expect(r.reason).toBe('dot_prefix');
  });

  it('rejects nested dot-prefixed path', () => {
    const r = validateFolderPath('Inbox/.private', 'Inbox');
    expect(r.sanitized).toBe('Inbox');
    expect(r.changed).toBe(true);
    expect(r.reason).toBe('dot_prefix');
  });

  it('rejects .inbox-curator', () => {
    const r = validateFolderPath('.inbox-curator', 'Inbox');
    expect(r.sanitized).toBe('Inbox');
    expect(r.changed).toBe(true);
    expect(r.reason).toBe('dot_prefix');
  });

  it('rejects .inbox-curator/logs', () => {
    const r = validateFolderPath('.inbox-curator/logs', 'Inbox');
    expect(r.sanitized).toBe('Inbox');
    expect(r.changed).toBe(true);
    expect(r.reason).toBe('dot_prefix');
  });

  it('handles whitespace-only input', () => {
    const r = validateFolderPath('   ', 'Inbox');
    expect(r.sanitized).toBe('Inbox');
    expect(r.changed).toBe(true);
    expect(r.reason).toBe('empty');
  });

  it('normalizes backslashes', () => {
    const r = validateFolderPath('AI\\Reviews', 'Inbox');
    expect(r.sanitized).toBe('AI/Reviews');
    expect(r.changed).toBe(true);
  });

  it.each([
    '../Secrets',
    'C:\\Users\\Secrets',
    '/absolute/path',
    'Inbox/CON',
    'Inbox/name:bad',
  ])('rejects unsafe configured path %s', (value) => {
    const r = validateFolderPath(value, 'Inbox');
    expect(r.sanitized).toBe('Inbox');
    expect(r.changed).toBe(true);
    expect(r.reason).toBe('invalid_path');
  });

  it('allows an empty optional path when the default is empty', () => {
    const r = validateFolderPath('', '');
    expect(r).toEqual({ sanitized: '', changed: false });
  });
});

describe('resolveSafeSuggestedPath', () => {
  it('resolves path with base path and suggested folder', () => {
    expect(resolveSafeSuggestedPath('AI/Thinking', 'Archive')).toBe('Archive/AI/Thinking');
  });

  it('preserves existing behavior when empty base path', () => {
    expect(resolveSafeSuggestedPath('AI/Thinking', '')).toBe('AI/Thinking');
    expect(resolveSafeSuggestedPath('AI/Thinking')).toBe('AI/Thinking');
  });

  it('normalizes backslashes and redundant slashes', () => {
    expect(resolveSafeSuggestedPath('AI\\\\Thinking', 'Archive//')).toBe('Archive/AI/Thinking');
    expect(resolveSafeSuggestedPath('AI/Thinking/', 'Archive/')).toBe('Archive/AI/Thinking');
  });

  it('rejects directory traversal', () => {
    expect(resolveSafeSuggestedPath('../Secrets', 'Archive')).toBeNull();
    expect(resolveSafeSuggestedPath('AI/../Thinking', 'Archive')).toBeNull();
  });

  it('rejects absolute and root paths', () => {
    expect(resolveSafeSuggestedPath('/AI', 'Archive')).toBeNull();
    expect(resolveSafeSuggestedPath('\\AI', 'Archive')).toBeNull();
  });

  it('rejects Windows drive paths', () => {
    expect(resolveSafeSuggestedPath('C:\\foo', 'Archive')).toBeNull();
    expect(resolveSafeSuggestedPath('D:/foo', 'Archive')).toBeNull();
  });

  it('rejects forbidden hidden directories', () => {
    expect(resolveSafeSuggestedPath('.obsidian', 'Archive')).toBeNull();
    expect(resolveSafeSuggestedPath('.git', 'Archive')).toBeNull();
    expect(resolveSafeSuggestedPath('AI/.git', 'Archive')).toBeNull();
    expect(resolveSafeSuggestedPath('AI/.obsidian', 'Archive')).toBeNull();
    expect(resolveSafeSuggestedPath('.hidden', 'Archive')).toBeNull();
  });

  it('rejects Windows reserved names', () => {
    expect(resolveSafeSuggestedPath('CON', 'Archive')).toBeNull();
    expect(resolveSafeSuggestedPath('aux.txt', 'Archive')).toBeNull();
    expect(resolveSafeSuggestedPath('com3', 'Archive')).toBeNull();
  });
});
