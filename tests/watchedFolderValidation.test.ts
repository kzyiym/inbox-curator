import { describe, expect, it, vi, beforeEach } from 'vitest';
import { TFile, TFolder } from 'obsidian';
import InboxCuratorPlugin from '../main.ts';

function createMockFolder(path: string): TFolder {
  const folder = new TFolder();
  folder.path = path;
  const parts = path.split('/');
  folder.name = parts[parts.length - 1];
  return folder;
}

function createMockFile(path: string): TFile {
  const file = new TFile();
  file.path = path;
  file.extension = 'md';
  const parts = path.split('/');
  file.name = parts[parts.length - 1];
  file.basename = file.name.replace(/\.md$/, '');
  return file;
}

describe('InboxCuratorPlugin WatchedFolder Validation', () => {
  let plugin: InboxCuratorPlugin;
  let mockApp: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockApp = {
      vault: {
        getAbstractFileByPath: vi.fn(),
        getMarkdownFiles: vi.fn().mockReturnValue([]),
        on: vi.fn().mockReturnValue({}),
      },
    };

    plugin = new InboxCuratorPlugin(mockApp, {});
  });

  describe('isWatchedFolderValid', () => {
    it('returns false when watchedFolder is empty', () => {
      plugin.settings.watchedFolder = '';
      expect((plugin as any).isWatchedFolderValid()).toBe(false);
    });

    it('returns false when watchedFolder path does not exist (undefined)', () => {
      plugin.settings.watchedFolder = 'NonExistentFolder';
      mockApp.vault.getAbstractFileByPath.mockReturnValue(undefined);
      expect((plugin as any).isWatchedFolderValid()).toBe(false);
    });

    it('returns false when watchedFolder path points to a file (TFile, not TFolder)', () => {
      plugin.settings.watchedFolder = 'Inbox/some-file.md';
      mockApp.vault.getAbstractFileByPath.mockReturnValue(createMockFile('Inbox/some-file.md'));
      expect((plugin as any).isWatchedFolderValid()).toBe(false);
    });

    it('returns true when watchedFolder exists as a TFolder', () => {
      plugin.settings.watchedFolder = 'Inbox';
      mockApp.vault.getAbstractFileByPath.mockReturnValue(createMockFolder('Inbox'));
      expect((plugin as any).isWatchedFolderValid()).toBe(true);
    });
  });

  describe('processWatchedFolder entry guard', () => {
    it('returns early without starting processing when watchedFolder does not exist', async () => {
      plugin.settings.watchedFolder = 'NonExistentFolder';
      mockApp.vault.getAbstractFileByPath.mockReturnValue(undefined);

      expect((plugin as any).processingInProgress).toBe(false);
      await (plugin as any).processWatchedFolder();
      expect((plugin as any).processingInProgress).toBe(false);
    });
  });

  describe('handleWatchedFolderCreate entry guard', () => {
    it('silently returns when watchedFolder does not exist', async () => {
      plugin.settings.watchedFolder = 'NonExistentFolder';
      mockApp.vault.getAbstractFileByPath.mockReturnValue(undefined);
      plugin.settings.enableAutomaticWatching = true;
      plugin.settings.autoReviewOnCreate = true;

      const file = createMockFile('NonExistentFolder/note.md');
      await expect((plugin as any).handleWatchedFolderCreate(file)).resolves.toBeUndefined();
    });
  });

  describe('handleWatchedFolderModify entry guard', () => {
    it('silently returns when watchedFolder does not exist', async () => {
      plugin.settings.watchedFolder = 'NonExistentFolder';
      mockApp.vault.getAbstractFileByPath.mockReturnValue(undefined);
      plugin.settings.enableAutomaticWatching = true;
      plugin.settings.autoReviewOnModify = true;

      const file = createMockFile('NonExistentFolder/note.md');
      await expect((plugin as any).handleWatchedFolderModify(file)).resolves.toBeUndefined();
    });
  });

  describe('runPollingSweep entry guard', () => {
    it('silently returns without starting a sweep when watchedFolder does not exist', async () => {
      plugin.settings.watchedFolder = 'NonExistentFolder';
      mockApp.vault.getAbstractFileByPath.mockReturnValue(undefined);
      plugin.settings.enablePolling = true;

      expect((plugin as any).pollingInProgress).toBe(false);
      await (plugin as any).runPollingSweep();
      expect((plugin as any).pollingInProgress).toBe(false);
    });
  });

  describe('.inbox-curator/ exclusion', () => {
    it('excludes files inside .inbox-curator/ from review candidates', () => {
      plugin.settings.watchedFolder = '';
      plugin.settings.reviewOutputFolder = 'AI Reviews';

      const hiddenFile = createMockFile('.inbox-curator/auto-sort-history.json');
      hiddenFile.extension = 'json';
      expect((plugin as any).isWatchedFolderReviewCandidate(hiddenFile)).toBe(false);

      const mdInHidden = createMockFile('.inbox-curator/some-note.md');
      expect((plugin as any).isWatchedFolderReviewCandidate(mdInHidden)).toBe(false);

      const nestedHidden = createMockFile('Inbox/.inbox-curator/note.md');
      expect((plugin as any).isWatchedFolderReviewCandidate(nestedHidden)).toBe(false);
    });
  });
});
