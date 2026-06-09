import { describe, expect, it, vi, beforeEach } from 'vitest';
import { TFile } from 'obsidian';
import InboxCuratorPlugin from '../main.ts';
import { buildReviewSourceInfo } from '../src/reviewPipeline';
import { readAiReviewSourceHash } from '../src/frontmatter';

vi.mock('../src/reviewPipeline', () => ({
  buildReviewSourceInfo: vi.fn(),
}));

vi.mock('../src/frontmatter', () => ({
  readAiReviewSourceHash: vi.fn(),
}));

describe('InboxCuratorPlugin Polling I/O Cache', () => {
  let plugin: InboxCuratorPlugin;
  let mockApp: any;
  let file: TFile;

  beforeEach(() => {
    vi.clearAllMocks();

    file = new TFile();
    file.path = 'Inbox/my-note.md';
    file.extension = 'md';
    file.stat = {
      mtime: 1000,
      ctime: 900,
      size: 100,
    };

    mockApp = {
      vault: {
        read: vi.fn().mockResolvedValue('note content'),
        on: vi.fn().mockReturnValue({}),
      },
      metadataCache: {
        getFileCache: vi.fn(),
      },
    };

    plugin = new InboxCuratorPlugin(mockApp, {});
    plugin.settings = {
      ...plugin.settings,
      reviewOutputFolder: 'AI Reviews',
    };
  });

  it('falls back to read if metadataCache is unavailable', async () => {
    mockApp.metadataCache.getFileCache.mockReturnValue(null);
    vi.mocked(buildReviewSourceInfo).mockReturnValue({ sourceHash: 'hash123' } as any);
    vi.mocked(readAiReviewSourceHash).mockReturnValue('hash123');

    const shouldSkip = await (plugin as any).shouldSkipWatchedFile(file);

    expect(shouldSkip).toBe(true);
    expect(mockApp.vault.read).toHaveBeenCalledTimes(1);
    expect(mockApp.vault.read).toHaveBeenCalledWith(file);
    // Cache should be set on successful match
    expect((plugin as any).fileSkipCache.get(file.path)).toEqual({
      mtime: 1000,
      reviewHash: 'hash123',
    });
  });

  it('deletes cache and returns false if metadataCache has frontmatter but no ai_review_source_hash', async () => {
    // Populate cache first to verify deletion
    (plugin as any).fileSkipCache.set(file.path, { mtime: 1000, reviewHash: 'hash123' });

    mockApp.metadataCache.getFileCache.mockReturnValue({
      frontmatter: {
        // no ai_review_source_hash
      },
    });

    const shouldSkip = await (plugin as any).shouldSkipWatchedFile(file);

    expect(shouldSkip).toBe(false);
    expect(mockApp.vault.read).not.toHaveBeenCalled();
    expect((plugin as any).fileSkipCache.has(file.path)).toBe(false);
  });

  it('skips read and returns true if cached mtime and hash match metadataCache', async () => {
    mockApp.metadataCache.getFileCache.mockReturnValue({
      frontmatter: {
        ai_review_source_hash: 'hash123',
      },
    });

    // Populate skip cache
    (plugin as any).fileSkipCache.set(file.path, {
      mtime: 1000, // matches file.stat.mtime
      reviewHash: 'hash123', // matches frontmatter.ai_review_source_hash
    });

    const shouldSkip = await (plugin as any).shouldSkipWatchedFile(file);

    expect(shouldSkip).toBe(true);
    expect(mockApp.vault.read).not.toHaveBeenCalled();
  });

  it('performs read if cached reviewHash does not match metadataCache hash', async () => {
    mockApp.metadataCache.getFileCache.mockReturnValue({
      frontmatter: {
        ai_review_source_hash: 'new_hash',
      },
    });

    // Populate skip cache with mismatched hash
    (plugin as any).fileSkipCache.set(file.path, {
      mtime: 1000,
      reviewHash: 'old_hash',
    });

    vi.mocked(buildReviewSourceInfo).mockReturnValue({ sourceHash: 'new_hash' } as any);
    vi.mocked(readAiReviewSourceHash).mockReturnValue('new_hash');

    const shouldSkip = await (plugin as any).shouldSkipWatchedFile(file);

    expect(shouldSkip).toBe(true);
    expect(mockApp.vault.read).toHaveBeenCalledTimes(1);
    expect((plugin as any).fileSkipCache.get(file.path)).toEqual({
      mtime: 1000,
      reviewHash: 'new_hash',
    });
  });

  it('performs read if cached mtime does not match file mtime', async () => {
    mockApp.metadataCache.getFileCache.mockReturnValue({
      frontmatter: {
        ai_review_source_hash: 'hash123',
      },
    });

    // Populate skip cache with mismatched mtime (999 instead of 1000)
    (plugin as any).fileSkipCache.set(file.path, {
      mtime: 999,
      reviewHash: 'hash123',
    });

    vi.mocked(buildReviewSourceInfo).mockReturnValue({ sourceHash: 'hash123' } as any);
    vi.mocked(readAiReviewSourceHash).mockReturnValue('hash123');

    const shouldSkip = await (plugin as any).shouldSkipWatchedFile(file);

    expect(shouldSkip).toBe(true);
    expect(mockApp.vault.read).toHaveBeenCalledTimes(1);
    expect((plugin as any).fileSkipCache.get(file.path)).toEqual({
      mtime: 1000, // updated to 1000
      reviewHash: 'hash123',
    });
  });

  it('deletes cache and returns false if fresh read hash does not match computed sourceHash', async () => {
    mockApp.metadataCache.getFileCache.mockReturnValue({
      frontmatter: {
        ai_review_source_hash: 'mismatch_hash',
      },
    });

    (plugin as any).fileSkipCache.set(file.path, {
      mtime: 999,
      reviewHash: 'mismatch_hash',
    });

    vi.mocked(buildReviewSourceInfo).mockReturnValue({ sourceHash: 'computed_hash' } as any);
    vi.mocked(readAiReviewSourceHash).mockReturnValue('mismatch_hash'); // mismatched from computed

    const shouldSkip = await (plugin as any).shouldSkipWatchedFile(file);

    expect(shouldSkip).toBe(false);
    expect(mockApp.vault.read).toHaveBeenCalledTimes(1);
    expect((plugin as any).fileSkipCache.has(file.path)).toBe(false);
  });

  it('clears cache on onunload', async () => {
    await plugin.onload();
    (plugin as any).fileSkipCache.set(file.path, { mtime: 1000, reviewHash: 'hash123' });
    plugin.onunload();
    expect((plugin as any).fileSkipCache.size).toBe(0);
  });

  it('deletes old path from cache on vault rename event', async () => {
    const vaultEvents: Record<string, Function> = {};
    mockApp.vault.on = vi.fn().mockImplementation((name, cb) => {
      vaultEvents[name] = cb;
      return {};
    });

    await plugin.onload();

    (plugin as any).fileSkipCache.set('Inbox/old-name.md', { mtime: 1000, reviewHash: 'hash' });
    expect((plugin as any).fileSkipCache.has('Inbox/old-name.md')).toBe(true);

    // Trigger rename event
    if (vaultEvents['rename']) {
      vaultEvents['rename']({ path: 'Inbox/new-name.md' }, 'Inbox/old-name.md');
    }

    expect((plugin as any).fileSkipCache.has('Inbox/old-name.md')).toBe(false);
  });

  it('deletes path from cache on vault delete event', async () => {
    const vaultEvents: Record<string, Function> = {};
    mockApp.vault.on = vi.fn().mockImplementation((name, cb) => {
      vaultEvents[name] = cb;
      return {};
    });

    await plugin.onload();

    (plugin as any).fileSkipCache.set('Inbox/to-delete.md', { mtime: 1000, reviewHash: 'hash' });
    expect((plugin as any).fileSkipCache.has('Inbox/to-delete.md')).toBe(true);

    // Trigger delete event
    if (vaultEvents['delete']) {
      vaultEvents['delete']({ path: 'Inbox/to-delete.md' });
    }

    expect((plugin as any).fileSkipCache.has('Inbox/to-delete.md')).toBe(false);
  });
});
