import { describe, expect, it, vi } from 'vitest';
import { TFile } from 'obsidian';
import {
  isCollectionReviewNote,
  isExcludedFromCollectionReview,
  hasCollectionReviewFrontmatter,
  writeCollectionReviewNote,
  getFolderMarkdownFilesForCollectionReview,
} from '../src/collectionReview';
import type { CollectionReviewPipelineOptions } from '../src/types';

function createMockApp(vaultFiles: Map<string, { content: string; isFolder?: boolean }> = new Map()) {
  const files = vaultFiles;
  return {
    vault: {
      read: async (file: TFile) => {
        const entry = files.get(file.path);
        return entry?.content ?? '';
      },
      create: async (_path: string, _content: string) => {
        files.set(_path, { content: _content });
      },
      getMarkdownFiles: () => {
        const mdFiles: TFile[] = [];
        for (const [path, entry] of files) {
          if (!entry.isFolder && path.endsWith('.md')) {
            const f = new TFile();
            f.path = path;
            f.basename = path.split('/').pop()?.replace(/\.md$/, '') ?? '';
            f.extension = 'md';
            f.name = path.split('/').pop() ?? '';
            mdFiles.push(f);
          }
        }
        return mdFiles;
      },
      getAbstractFileByPath: (path: string) => {
        const entry = files.get(path);
        if (!entry) return null;
        if (entry.isFolder) {
          const folder = {
            path,
            name: path.split('/').pop() ?? '',
            isFolder: true,
          };
          return folder;
        }
        const f = new TFile();
        f.path = path;
        f.basename = path.split('/').pop()?.replace(/\.md$/, '') ?? '';
        f.extension = 'md';
        f.name = path.split('/').pop() ?? '';
        return f;
      },
      createFolder: async (_path: string) => {
        files.set(_path, { content: '', isFolder: true });
      },
      adapter: {
        getFullPath: (p: string) => p,
      },
    },
    metadataCache: {
      getFileCache: (_file: TFile) => null,
    },
    fileManager: {
      renameFile: async () => {},
    },
  };
}

function createMockOptions(overrides: Partial<CollectionReviewPipelineOptions> = {}): CollectionReviewPipelineOptions {
  return {
    outputFolder: 'Collection Reviews',
    provider: 'openai-compatible',
    endpointUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    apiKey: 'test-key',
    maxNotes: 30,
    maxExcerptCharsPerNote: 2000,
    useExistingReviewsFirst: true,
    includeExcerptWhenNeeded: true,
    promptLanguage: 'english',
    requestTimeoutMs: 60000,
    maxOutputTokens: 4096,
    isUnloaded: () => false,
    ...overrides,
  };
}

describe('isExcludedFromCollectionReview', () => {
  it('excludes non-markdown files', () => {
    const f = new TFile();
    f.extension = 'png';
    f.name = 'test.png';
    expect(isExcludedFromCollectionReview(f)).toBe(true);
  });

  it('excludes ai-review.md files', () => {
    const f = new TFile();
    f.extension = 'md';
    f.name = 'note.ai-review.md';
    expect(isExcludedFromCollectionReview(f)).toBe(true);
  });

  it('excludes collection-review files', () => {
    const f = new TFile();
    f.extension = 'md';
    f.name = 'collection-review-2026-06-10-1430.md';
    expect(isExcludedFromCollectionReview(f)).toBe(true);
  });

  it('allows normal markdown files', () => {
    const f = new TFile();
    f.extension = 'md';
    f.name = 'my note.md';
    expect(isExcludedFromCollectionReview(f)).toBe(false);
  });
});

describe('isCollectionReviewNote', () => {
  it('returns true for ai-review files', () => {
    const f = new TFile();
    f.extension = 'md';
    f.name = 'test.ai-review.md';
    expect(isCollectionReviewNote(f)).toBe(true);
  });

  it('returns true for collection-review files', () => {
    const f = new TFile();
    f.extension = 'md';
    f.name = 'collection-review-2026-06-10-1430.md';
    expect(isCollectionReviewNote(f)).toBe(true);
  });

  it('returns false for normal notes', () => {
    const f = new TFile();
    f.extension = 'md';
    f.name = 'note.md';
    expect(isCollectionReviewNote(f)).toBe(false);
  });
});

describe('hasCollectionReviewFrontmatter', () => {
  it('detects collection review frontmatter via metadata cache', async () => {
    const app = createMockApp();
    app.metadataCache.getFileCache = () => ({
      frontmatter: {
        inbox_curator_review_type: 'collection',
      },
    });

    const f = new TFile();
    f.path = 'Collection Reviews/test.md';
    const result = await hasCollectionReviewFrontmatter(app as any, f);
    expect(result).toBe(true);
  });

  it('detects collection review frontmatter via content read', async () => {
    const files = new Map<string, { content: string }>();
    files.set('Inbox/test.md', {
      content: '---\ninbox_curator_review_type: collection\n---\nBody',
    });
    const app = createMockApp(files);

    const f = new TFile();
    f.path = 'Inbox/test.md';
    const result = await hasCollectionReviewFrontmatter(app as any, f);
    expect(result).toBe(true);
  });

  it('returns false for non-collection frontmatter', async () => {
    const files = new Map<string, { content: string }>();
    files.set('Inbox/test.md', {
      content: '---\ntitle: Normal Note\n---\nBody',
    });
    const app = createMockApp(files);

    const f = new TFile();
    f.path = 'Inbox/test.md';
    const result = await hasCollectionReviewFrontmatter(app as any, f);
    expect(result).toBe(false);
  });

  it('returns false when frontmatter has different review_type', async () => {
    const app = createMockApp();
    app.metadataCache.getFileCache = () => ({
      frontmatter: {
        inbox_curator_review_type: 'individual',
      },
    });

    const f = new TFile();
    f.path = 'Inbox/test.md';
    const result = await hasCollectionReviewFrontmatter(app as any, f);
    expect(result).toBe(false);
  });
});

describe('writeCollectionReviewNote', () => {
  it('writes note with correct frontmatter including source_notes', async () => {
    const files = new Map<string, { content: string; isFolder?: boolean }>();
    const app = createMockApp(files);

    const sourceNotes = ['Inbox/Note A.md', 'Inbox/Note B.md'];
    const outputPath = await writeCollectionReviewNote(
      app as any,
      'Collection Reviews',
      '# Collection Review\n\nContent here.',
      sourceNotes,
      'selected_notes',
      '',
    );

    expect(outputPath).toContain('Collection Reviews/collection-review-');

    const content = files.get(outputPath)?.content ?? '';
    expect(content).toContain('inbox_curator_review_type: collection');
    expect(content).toContain('created_by: inbox-curator');
    expect(content).toContain('source_type: selected_notes');
    expect(content).toContain('Inbox/Note A.md');
    expect(content).toContain('Inbox/Note B.md');
    expect(content).toContain('# Collection Review');
    expect(content).toContain('Content here.');
    expect(content).toContain('source_notes:');
  });

  it('writes note with folder source type', async () => {
    const files = new Map<string, { content: string; isFolder?: boolean }>();
    const app = createMockApp(files);

    const outputPath = await writeCollectionReviewNote(
      app as any,
      'Collection Reviews',
      '# Collection Review\n\nBody.',
      ['Inbox/a.md'],
      'folder',
      'Inbox',
    );

    const content = files.get(outputPath)?.content ?? '';
    expect(content).toContain('source_type: folder');
    expect(content).toContain('source_folder: "Inbox"');
  });

  it('creates unique filenames when conflict exists', async () => {
    const files = new Map<string, { content: string; isFolder?: boolean }>();

    const now = new Date();
    const y = now.getFullYear();
    const mo = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const h = String(now.getHours()).padStart(2, '0');
    const mi = String(now.getMinutes()).padStart(2, '0');
    const baseName = `collection-review-${y}-${mo}-${d}-${h}${mi}`;
    files.set(`Collection Reviews/${baseName}.md`, { content: 'existing' });

    const app = createMockApp(files);

    const outputPath = await writeCollectionReviewNote(
      app as any,
      'Collection Reviews',
      '# Body',
      ['Inbox/a.md'],
      'selected_notes',
      '',
    );

    expect(outputPath).toContain('Collection Reviews/');
    const fileName = outputPath.split('/').pop() ?? '';
    expect(fileName).toContain('-2.md');
  });

  it('required sections are present in the output', async () => {
    const files = new Map<string, { content: string; isFolder?: boolean }>();
    const app = createMockApp(files);

    const outputPath = await writeCollectionReviewNote(
      app as any,
      'Collection Reviews',
      `# Collection Review

## Collection Summary
Summary text.

## AI Perspective
Perspective text.

## Main Themes
- Theme 1

## Key Notes
### [[Note A]]
Important note.

## Suggested Links
### [[Note A]] → [[Note B]]
Type: supports

## Suggested Knowledge Map / MOC
Title: MOC Example

## Duplicate or Overlap Candidates
### [[Note A]] / [[Note B]]
Overlap.

## Contradictions or Tensions
Tension point.

## Suggested Next Actions
- Action 1
`,
      ['Inbox/a.md'],
      'selected_notes',
      '',
    );

    const content = files.get(outputPath)?.content ?? '';
    expect(content).toContain('## Collection Summary');
    expect(content).toContain('## AI Perspective');
    expect(content).toContain('## Main Themes');
    expect(content).toContain('## Key Notes');
    expect(content).toContain('## Suggested Links');
    expect(content).toContain('## Suggested Knowledge Map / MOC');
    expect(content).toContain('## Duplicate or Overlap Candidates');
    expect(content).toContain('## Contradictions or Tensions');
    expect(content).toContain('## Suggested Next Actions');
  });

  it('original source notes are not modified', async () => {
    const files = new Map<string, { content: string; isFolder?: boolean }>();
    const originalContent = '---\ntitle: Original\n---\nOriginal body content.';
    files.set('Inbox/original.md', { content: originalContent });

    const app = createMockApp(files);

    await writeCollectionReviewNote(
      app as any,
      'Collection Reviews',
      '# Review',
      ['Inbox/original.md'],
      'selected_notes',
      '',
    );

    const afterContent = files.get('Inbox/original.md')?.content ?? '';
    expect(afterContent).toBe(originalContent);
  });
});

describe('getFolderMarkdownFilesForCollectionReview', () => {
  it('returns markdown files from a folder', async () => {
    const files = new Map<string, { content: string; isFolder?: boolean }>();
    files.set('Inbox', { content: '', isFolder: true });
    files.set('Inbox/note1.md', { content: '---\ntitle: Note 1\n---\nBody 1' });
    files.set('Inbox/note2.md', { content: '---\ntitle: Note 2\n---\nBody 2' });

    const app = createMockApp(files);
    const options = createMockOptions();
    const result = await getFolderMarkdownFilesForCollectionReview(app as any, 'Inbox', options);

    expect(result).toHaveLength(2);
    const paths = result.map((f) => f.path);
    expect(paths).toContain('Inbox/note1.md');
    expect(paths).toContain('Inbox/note2.md');
  });

  it('excludes ai-review files from folder results', async () => {
    const files = new Map<string, { content: string; isFolder?: boolean }>();
    files.set('Inbox', { content: '', isFolder: true });
    files.set('Inbox/note1.md', { content: '---\ntitle: Note 1\n---\nBody 1' });
    files.set('Inbox/note1.ai-review.md', { content: '# AI Review\nReview content.' });

    const app = createMockApp(files);
    const options = createMockOptions();
    const result = await getFolderMarkdownFilesForCollectionReview(app as any, 'Inbox', options);

    expect(result).toHaveLength(1);
    expect(result[0].path).toBe('Inbox/note1.md');
  });

  it('excludes collection-review files from folder results', async () => {
    const files = new Map<string, { content: string; isFolder?: boolean }>();
    files.set('Inbox', { content: '', isFolder: true });
    files.set('Inbox/note1.md', { content: '---\ntitle: Note 1\n---\nBody 1' });
    files.set('Inbox/collection-review-2026-06-10-1430.md', {
      content: '---\ninbox_curator_review_type: collection\n---\nBody',
    });

    const app = createMockApp(files);
    const options = createMockOptions();
    const result = await getFolderMarkdownFilesForCollectionReview(app as any, 'Inbox', options);

    expect(result).toHaveLength(1);
    expect(result[0].path).toBe('Inbox/note1.md');
  });

  it('respects maxNotes limit', async () => {
    const files = new Map<string, { content: string; isFolder?: boolean }>();
    files.set('Inbox', { content: '', isFolder: true });
    for (let i = 1; i <= 10; i++) {
      files.set(`Inbox/note${i}.md`, { content: `---\ntitle: Note ${i}\n---\nBody ${i}` });
    }

    const app = createMockApp(files);
    const options = createMockOptions({ maxNotes: 3 });
    const result = await getFolderMarkdownFilesForCollectionReview(app as any, 'Inbox', options);

    expect(result).toHaveLength(3);
  });

  it('excludes notes with collection frontmatter', async () => {
    const app = createMockApp();
    app.metadataCache.getFileCache = (file: TFile) => {
      if (file.path === 'Inbox/collection.md') {
        return { frontmatter: { inbox_curator_review_type: 'collection' } };
      }
      return null;
    };

    const files = new Map<string, { content: string; isFolder?: boolean }>();
    files.set('Inbox', { content: '', isFolder: true });
    files.set('Inbox/note1.md', { content: '---\ntitle: Note 1\n---\nBody 1' });
    files.set('Inbox/collection.md', {
      content: '---\ninbox_curator_review_type: collection\n---\nBody',
    });

    const app2 = createMockApp(files);
    app2.metadataCache.getFileCache = app.metadataCache.getFileCache;

    const options = createMockOptions();
    const result = await getFolderMarkdownFilesForCollectionReview(app2 as any, 'Inbox', options);

    expect(result).toHaveLength(1);
    expect(result[0].path).toBe('Inbox/note1.md');
  });
});

describe('Collection Review settings defaults', () => {
  it('DEFAULT_SETTINGS includes collection review fields', async () => {
    const { DEFAULT_SETTINGS } = await import('../src/settings');
    expect(DEFAULT_SETTINGS.collectionReviewOutputFolder).toBe('Collection Reviews');
    expect(DEFAULT_SETTINGS.collectionReviewUseExistingReviewsFirst).toBe(true);
    expect(DEFAULT_SETTINGS.collectionReviewIncludeExcerptWhenNeeded).toBe(true);
    expect(DEFAULT_SETTINGS.collectionReviewMaxNotes).toBe(30);
    expect(DEFAULT_SETTINGS.collectionReviewMaxExcerptCharsPerNote).toBe(2000);
  });
});

describe('Collection Review prompt includes key constraints', () => {
  it('English prompt includes safety constraints', async () => {
    const { buildCollectionReviewInput } = await import('../src/collectionReview');

    const files = new Map<string, { content: string; isFolder?: boolean }>();
    files.set('Inbox/a.md', { content: '---\ntitle: A\n---\nNote A body content here.' });
    files.set('Inbox/b.md', { content: '---\ntitle: B\n---\nNote B body content here.' });

    const app = createMockApp(files);
    const tfA = new TFile();
    tfA.path = 'Inbox/a.md';
    tfA.basename = 'a';
    tfA.extension = 'md';
    tfA.name = 'a.md';
    const tfB = new TFile();
    tfB.path = 'Inbox/b.md';
    tfB.basename = 'b';
    tfB.extension = 'md';
    tfB.name = 'b.md';

    const options = createMockOptions({
      useExistingReviewsFirst: false,
      promptLanguage: 'english',
    });

    const result = await buildCollectionReviewInput(app as any, [tfA, tfB], options);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.prompt).toContain('Collection Summary');
      expect(result.prompt).toContain('AI Perspective');
      expect(result.prompt).toContain('Suggested Next Actions');
      expect(result.prompt).toContain('Do not produce output that assumes source notes will be modified');
      expect(result.prompt).toContain('Write as suggestions, not automatic actions');
      expect(result.prompt).toContain('Always include Suggested Next Actions');
      expect(result.sourceNotePaths).toHaveLength(2);
    }
  });

  it('English prompt includes recurring themes guidance for creative notes', async () => {
    const { buildCollectionReviewInput } = await import('../src/collectionReview');

    const files = new Map<string, { content: string; isFolder?: boolean }>();
    files.set('Inbox/a.md', { content: '---\ntitle: A\n---\nNote A body.' });
    files.set('Inbox/b.md', { content: '---\ntitle: B\n---\nNote B body.' });

    const app = createMockApp(files);
    const tfA = new TFile();
    tfA.path = 'Inbox/a.md';
    tfA.basename = 'a';
    tfA.extension = 'md';
    tfA.name = 'a.md';
    const tfB = new TFile();
    tfB.path = 'Inbox/b.md';
    tfB.basename = 'b';
    tfB.extension = 'md';
    tfB.name = 'b.md';

    const options = createMockOptions({
      useExistingReviewsFirst: false,
      promptLanguage: 'english',
    });

    const result = await buildCollectionReviewInput(app as any, [tfA, tfB], options);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.prompt).toContain('Recurring Themes / Motifs');
      expect(result.prompt).toContain('revisitations of a theme');
      expect(result.prompt).toContain('evolution over time');
      expect(result.prompt).toContain('Synthesis or consolidation opportunities');
      expect(result.prompt).toContain('Specific notes to read or explore deeper');
    }
  });

  it('Japanese prompt includes recurring themes guidance for creative notes', async () => {
    const { buildCollectionReviewInput } = await import('../src/collectionReview');

    const files = new Map<string, { content: string; isFolder?: boolean }>();
    files.set('Inbox/a.md', { content: '---\ntitle: A\n---\nNote A body.' });
    files.set('Inbox/b.md', { content: '---\ntitle: B\n---\nNote B body.' });

    const app = createMockApp(files);
    const tfA = new TFile();
    tfA.path = 'Inbox/a.md';
    tfA.basename = 'a';
    tfA.extension = 'md';
    tfA.name = 'a.md';
    const tfB = new TFile();
    tfB.path = 'Inbox/b.md';
    tfB.basename = 'b';
    tfB.extension = 'md';
    tfB.name = 'b.md';

    const options = createMockOptions({
      useExistingReviewsFirst: false,
      promptLanguage: 'japanese',
    });

    const result = await buildCollectionReviewInput(app as any, [tfA, tfB], options);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.prompt).toContain('繰り返し現れるモチーフ・パターン');
      expect(result.prompt).toContain('時間経過による発展');
      expect(result.prompt).toContain('重複ではなく');
      expect(result.prompt).toContain('特定のノートを読む・深掘りする');
    }
  });

  it('Japanese prompt includes safety constraints', async () => {
    const { buildCollectionReviewInput } = await import('../src/collectionReview');

    const files = new Map<string, { content: string; isFolder?: boolean }>();
    files.set('Inbox/a.md', { content: '---\ntitle: A\n---\nNote A body content here.' });
    files.set('Inbox/b.md', { content: '---\ntitle: B\n---\nNote B body content here.' });

    const app = createMockApp(files);
    const tfA = new TFile();
    tfA.path = 'Inbox/a.md';
    tfA.basename = 'a';
    tfA.extension = 'md';
    tfA.name = 'a.md';
    const tfB = new TFile();
    tfB.path = 'Inbox/b.md';
    tfB.basename = 'b';
    tfB.extension = 'md';
    tfB.name = 'b.md';

    const options = createMockOptions({
      useExistingReviewsFirst: false,
      promptLanguage: 'japanese',
    });

    const result = await buildCollectionReviewInput(app as any, [tfA, tfB], options);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.prompt).toContain('全体の要約');
      expect(result.prompt).toContain('AI視点での総評');
      expect(result.prompt).toContain('次のアクション');
      expect(result.prompt).toContain('元ノートを変更する前提の出力はしないでください');
      expect(result.prompt).toContain('次のアクションは必ず出力してください');
    }
  });
});

describe('buildCollectionReviewInput error cases', () => {
  it('returns error for 0 notes', async () => {
    const { buildCollectionReviewInput } = await import('../src/collectionReview');
    const app = createMockApp();
    const options = createMockOptions();
    const result = await buildCollectionReviewInput(app as any, [], options);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('No notes');
    }
  });

  it('returns error for 1 note only', async () => {
    const { buildCollectionReviewInput } = await import('../src/collectionReview');

    const files = new Map<string, { content: string }>();
    files.set('Inbox/a.md', { content: '---\ntitle: A\n---\nBody' });

    const app = createMockApp(files);
    const tfA = new TFile();
    tfA.path = 'Inbox/a.md';
    tfA.basename = 'a';
    tfA.extension = 'md';
    tfA.name = 'a.md';

    const options = createMockOptions();
    const result = await buildCollectionReviewInput(app as any, [tfA], options);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('at least 2');
    }
  });

  it('returns error when all notes are excluded', async () => {
    const { buildCollectionReviewInput } = await import('../src/collectionReview');
    const app = createMockApp();

    const tfA = new TFile();
    tfA.path = 'Inbox/a.ai-review.md';
    tfA.basename = 'a';
    tfA.extension = 'md';
    tfA.name = 'a.ai-review.md';

    const tfB = new TFile();
    tfB.path = 'Inbox/b.ai-review.md';
    tfB.basename = 'b';
    tfB.extension = 'md';
    tfB.name = 'b.ai-review.md';

    const options = createMockOptions();
    const result = await buildCollectionReviewInput(app as any, [tfA, tfB], options);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('excluded');
    }
  });

  it('returns error when too many notes', async () => {
    const { buildCollectionReviewInput } = await import('../src/collectionReview');
    const files = new Map<string, { content: string }>();
    for (let i = 1; i <= 35; i++) {
      files.set(`Inbox/note${i}.md`, { content: `---\ntitle: Note ${i}\n---\nBody ${i}` });
    }

    const app = createMockApp(files);
    const tFiles = [];
    for (let i = 1; i <= 35; i++) {
      const tf = new TFile();
      tf.path = `Inbox/note${i}.md`;
      tf.basename = `note${i}`;
      tf.extension = 'md';
      tf.name = `note${i}.md`;
      tFiles.push(tf);
    }

    const options = createMockOptions({ maxNotes: 30 });
    const result = await buildCollectionReviewInput(app as any, tFiles, options);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('Too many notes');
    }
  });
});

describe('existing review priority', () => {
  it('uses existing review content when available', async () => {
    const { buildCollectionReviewInput } = await import('../src/collectionReview');

    const files = new Map<string, { content: string; isFolder?: boolean }>();
    files.set('Inbox/a.md', { content: '---\ntitle: A\n---\nNote A body content here.' });
    files.set('Inbox/a.ai-review.md', {
      content: '# Review of A\n\nThis is the existing review for note A.',
    });
    files.set('Inbox/b.md', { content: '---\ntitle: B\n---\nNote B body content here.' });

    const app = createMockApp(files);
    const tfA = new TFile();
    tfA.path = 'Inbox/a.md';
    tfA.basename = 'a';
    tfA.extension = 'md';
    tfA.name = 'a.md';
    const tfB = new TFile();
    tfB.path = 'Inbox/b.md';
    tfB.basename = 'b';
    tfB.extension = 'md';
    tfB.name = 'b.md';

    const options = createMockOptions({ useExistingReviewsFirst: true });
    const result = await buildCollectionReviewInput(app as any, [tfA, tfB], options);

    expect(result.ok).toBe(true);
    if (result.ok) {
      const noteA = result.notesInput.find((n) => n.notePath === 'Inbox/a.md');
      expect(noteA).toBeDefined();
      expect(noteA!.hasExistingReview).toBe(true);
      expect(noteA!.existingReviewContent).toContain('existing review for note A');

      const noteB = result.notesInput.find((n) => n.notePath === 'Inbox/b.md');
      expect(noteB).toBeDefined();
      expect(noteB!.hasExistingReview).toBe(false);
      expect(noteB!.excerpt).toBeTruthy();
    }
  });

  it('falls back to excerpt when no existing review and useExistingReviewsFirst is false', async () => {
    const { buildCollectionReviewInput } = await import('../src/collectionReview');

    const files = new Map<string, { content: string; isFolder?: boolean }>();
    files.set('Inbox/a.md', { content: '---\ntitle: A\n---\nNote A body content here with more text.' });
    files.set('Inbox/a.ai-review.md', {
      content: '# Review of A\n\nExisting review.',
    });
    files.set('Inbox/b.md', { content: '---\ntitle: B\n---\nNote B body content here with more text.' });

    const app = createMockApp(files);
    const tfA = new TFile();
    tfA.path = 'Inbox/a.md';
    tfA.basename = 'a';
    tfA.extension = 'md';
    tfA.name = 'a.md';
    const tfB = new TFile();
    tfB.path = 'Inbox/b.md';
    tfB.basename = 'b';
    tfB.extension = 'md';
    tfB.name = 'b.md';

    const options = createMockOptions({ useExistingReviewsFirst: false });
    const result = await buildCollectionReviewInput(app as any, [tfA, tfB], options);

    expect(result.ok).toBe(true);
    if (result.ok) {
      const noteA = result.notesInput.find((n) => n.notePath === 'Inbox/a.md');
      expect(noteA!.hasExistingReview).toBe(false);
      expect(noteA!.excerpt).toBeTruthy();

      const noteB = result.notesInput.find((n) => n.notePath === 'Inbox/b.md');
      expect(noteB!.hasExistingReview).toBe(false);
      expect(noteB!.excerpt).toBeTruthy();
    }
  });

  it('includes short excerpt even when existing review is available, if includeExcerptWhenNeeded is true', async () => {
    const { buildCollectionReviewInput } = await import('../src/collectionReview');

    const files = new Map<string, { content: string; isFolder?: boolean }>();
    files.set('Inbox/a.md', { content: '---\ntitle: A\n---\nNote A body content here with more text.' });
    files.set('Inbox/a.ai-review.md', {
      content: '# Review of A\n\nExisting review.',
    });
    files.set('Inbox/b.md', { content: '---\ntitle: B\n---\nNote B body content here with more text.' });

    const app = createMockApp(files);
    const tfA = new TFile();
    tfA.path = 'Inbox/a.md';
    tfA.basename = 'a';
    tfA.extension = 'md';
    tfA.name = 'a.md';
    const tfB = new TFile();
    tfB.path = 'Inbox/b.md';
    tfB.basename = 'b';
    tfB.extension = 'md';
    tfB.name = 'b.md';

    const options = createMockOptions({
      useExistingReviewsFirst: true,
      includeExcerptWhenNeeded: true,
    });
    const result = await buildCollectionReviewInput(app as any, [tfA, tfB], options);

    expect(result.ok).toBe(true);
    if (result.ok) {
      const noteA = result.notesInput.find((n) => n.notePath === 'Inbox/a.md');
      expect(noteA!.hasExistingReview).toBe(true);
      expect(noteA!.existingReviewContent).toContain('Existing review');
      expect(noteA!.excerpt).toBeTruthy();
    }
  });
});

describe('source note immutability', () => {
  it('does not modify source notes during collection review input building', async () => {
    const { buildCollectionReviewInput } = await import('../src/collectionReview');

    const files = new Map<string, { content: string; isFolder?: boolean }>();
    const originalContent = '---\ntitle: Original Note\n---\nOriginal body that should not change.';
    files.set('Inbox/original.md', { content: originalContent });

    const app = createMockApp(files);
    const tf = new TFile();
    tf.path = 'Inbox/original.md';
    tf.basename = 'original';
    tf.extension = 'md';
    tf.name = 'original.md';

    const tf2 = new TFile();
    tf2.path = 'Inbox/second.md';
    tf2.basename = 'second';
    tf2.extension = 'md';
    tf2.name = 'second.md';
    files.set('Inbox/second.md', { content: '---\ntitle: Second\n---\nSecond body.' });

    const options = createMockOptions();
    await buildCollectionReviewInput(app as any, [tf, tf2], options);

    const afterContent = files.get('Inbox/original.md')?.content;
    expect(afterContent).toBe(originalContent);
  });

  it('does not modify source notes after writing collection review', async () => {
    const files = new Map<string, { content: string; isFolder?: boolean }>();
    const originalContentA = '---\ntitle: A\n---\nBody A.';
    const originalContentB = '---\ntitle: B\n---\nBody B.';
    files.set('Inbox/a.md', { content: originalContentA });
    files.set('Inbox/b.md', { content: originalContentB });

    const app = createMockApp(files);

    await writeCollectionReviewNote(
      app as any,
      'Collection Reviews',
      '# Review',
      ['Inbox/a.md', 'Inbox/b.md'],
      'selected_notes',
      '',
    );

    expect(files.get('Inbox/a.md')?.content).toBe(originalContentA);
    expect(files.get('Inbox/b.md')?.content).toBe(originalContentB);
  });
});
