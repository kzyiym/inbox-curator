import { describe, it, expect } from 'vitest';
import { TFile, TFolder } from 'obsidian';
import { collectProposedActions } from '../src/utils/proposedActions';
import { DEFAULT_SETTINGS, type InboxCuratorSettings } from '../src/settings';

interface FileSpec {
  path: string;
  frontmatter: Record<string, unknown> | undefined;
  content?: string;
}

function makeFile(path: string): TFile {
  const file = new TFile();
  file.path = path;
  const name = path.split('/').pop() as string;
  (file as unknown as { name: string }).name = name;
  file.basename = name.replace(/\.md$/, '');
  file.extension = 'md';
  return file;
}

function buildApp(watched: string, specs: FileSpec[], existingPaths: string[] = []) {
  const folder = new TFolder();
  folder.path = watched;
  const files = specs.map((s) => makeFile(s.path));
  (folder as unknown as { children: unknown[] }).children = files;

  const cacheByPath = new Map<string, Record<string, unknown> | undefined>();
  const contentByPath = new Map<string, string>();
  specs.forEach((s, i) => {
    cacheByPath.set(files[i].path, s.frontmatter);
    contentByPath.set(files[i].path, s.content ?? '');
  });

  const existing = new Set(existingPaths);

  const app = {
    vault: {
      getAbstractFileByPath: (p: string) => {
        if (p === watched) return folder;
        if (existing.has(p)) return makeFile(p);
        return null;
      },
      cachedRead: async (file: TFile) => contentByPath.get(file.path) ?? '',
    },
    metadataCache: {
      getFileCache: (file: TFile) => {
        const fm = cacheByPath.get(file.path);
        return fm ? { frontmatter: fm } : null;
      },
    },
  };

  return app as unknown as Parameters<typeof collectProposedActions>[0];
}

function settings(overrides: Partial<InboxCuratorSettings> = {}): InboxCuratorSettings {
  return { ...DEFAULT_SETTINGS, watchedFolder: 'Inbox', ...overrides };
}

describe('collectProposedActions', () => {
  it('returns empty when watched folder is missing', async () => {
    const app = buildApp('Other', []);
    const items = await collectProposedActions(app, settings());
    expect(items).toEqual([]);
  });

  it('includes only notes with an actionable recommended action', async () => {
    const app = buildApp('Inbox', [
      { path: 'Inbox/a.md', frontmatter: { ai_review_recommended_action: 'archive', ai_review_reliability_label: 'high', ai_review_confidence: 'high' } },
      { path: 'Inbox/b.md', frontmatter: { ai_review_recommended_action: 'keep_as_reference' } },
      { path: 'Inbox/c.md', frontmatter: undefined },
      { path: 'Inbox/d.md', frontmatter: { ai_review_recommended_action: 'read_later', ai_review_reliability_label: 'medium', ai_review_confidence: 'medium' } },
    ]);
    const items = await collectProposedActions(app, settings({ autoExecuteArchive: true, autoExecuteReadLater: true }));
    expect(items.map((i) => i.notePath)).toEqual(['Inbox/a.md', 'Inbox/d.md']);
  });

  it('excludes review output files', async () => {
    const app = buildApp('Inbox', [
      { path: 'Inbox/note.ai-review.md', frontmatter: { ai_review_recommended_action: 'archive' } },
    ]);
    const items = await collectProposedActions(app, settings());
    expect(items).toEqual([]);
  });

  it('computes wouldAutoExecute and reflects allowlist blocking', async () => {
    const app = buildApp('Inbox', [
      { path: 'Inbox/a.md', frontmatter: { ai_review_recommended_action: 'archive', ai_review_reliability_label: 'high', ai_review_confidence: 'high' } },
    ]);
    const allowed = await collectProposedActions(app, settings({ autoExecuteArchive: true }));
    expect(allowed[0].decision.wouldAutoExecute).toBe(true);
    expect(allowed[0].decision.allowedByAllowlist).toBe(true);

    const blocked = await collectProposedActions(app, settings({ autoExecuteArchive: true, allowActionArchive: false }));
    expect(blocked[0].decision.wouldAutoExecute).toBe(false);
    expect(blocked[0].decision.allowedByAllowlist).toBe(false);
    expect(blocked[0].decision.skipCode).toBe('allowlist_blocked');
  });

  it('resolves read_later destination and flags conflicts', async () => {
    const app = buildApp(
      'Inbox',
      [{ path: 'Inbox/a.md', frontmatter: { ai_review_recommended_action: 'read_later', ai_review_reliability_label: 'high', ai_review_confidence: 'high' } }],
      ['Read Later/a.md'],
    );
    const items = await collectProposedActions(app, settings({ readLaterFolder: 'Read Later' }));
    expect(items[0].destinationPath).toBe('Read Later/a.md');
    expect(items[0].destinationConflict).toBe(true);
  });

  it('falls back to reliability label when confidence is absent', async () => {
    const app = buildApp('Inbox', [
      { path: 'Inbox/a.md', frontmatter: { ai_review_recommended_action: 'archive', ai_review_reliability_label: 'high' } },
    ]);
    const items = await collectProposedActions(app, settings({ autoExecuteArchive: true }));
    expect(items[0].confidence).toBe('high');
    expect(items[0].decision.wouldAutoExecute).toBe(true);
  });
});
