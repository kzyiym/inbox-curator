import { describe, expect, it, vi } from 'vitest';
import {
  buildReviewDiagnosticFileName,
  isReviewDiagnosticFileName,
  isReviewDiagnosticFilePath,
  listReviewDiagnosticFiles,
  removeReviewDiagnosticFiles,
  writeReviewDiagnostic,
  DIAGNOSTIC_FOLDER,
} from '../src/utils/reviewDiagnostics';
import { sanitizeSensitiveData } from '../src/utils/sensitiveData';
import type { ReviewDiagnosticCapture } from '../src/reviewPipeline';

function createMockApp() {
  const writes = new Map<string, string>();
  const mkdirs: string[] = [];
  const app = {
    vault: {
      adapter: {
        exists: async () => false,
        mkdir: async (path: string) => {
          mkdirs.push(path);
        },
        write: async (path: string, content: string) => {
          writes.set(path, content);
        },
      },
    },
  };
  return { app: app as never, writes, mkdirs };
}

const baseDiagnostic = (): ReviewDiagnosticCapture => ({
  capturedAt: '2026-09-24T01:02:03.000Z',
  operationId: 'diag-123',
  notePath: 'AI Archive/note.md',
  noteTitle: 'note',
  provider: 'openai-compatible',
  model: 'gpt-4o-mini',
  reviewMode: 'standard',
  promptLanguage: 'japanese',
  contentType: 'plain_note',
  inputProfile: 'plain_note',
  fetchStatus: 'not_applicable',
  imageAttachmentCount: 0,
  systemPrompt: 'system',
  userPrompt: 'user',
  rawResponseText: '{"summary":["x"]}',
  normalized: {
    summary: ['x'],
    readingDecision: 'read_source',
    readingDecisionReason: 'reason',
    takeaways: [],
    recommendedAction: 'archive',
    priority: 'medium',
    credibilityReview: '',
  },
});

describe('buildReviewDiagnosticFileName', () => {
  it('builds a timestamped json file name with a sanitized operation id', () => {
    const name = buildReviewDiagnosticFileName(new Date('2026-09-24T01:02:03'), 'diag/../1 2');
    expect(name).toBe('review-20260924-010203-diag12.json');
  });

  it('works without an operation id', () => {
    const name = buildReviewDiagnosticFileName(new Date('2026-09-24T01:02:03'));
    expect(name).toBe('review-20260924-010203.json');
  });
});

describe('writeReviewDiagnostic', () => {
  it('creates the diagnostics folder and writes sanitized JSON', async () => {
    const { app, writes, mkdirs } = createMockApp();
    const diagnostic = baseDiagnostic();
    diagnostic.userPrompt = 'Authorization: Bearer abcdef123456 and image data:image/png;base64,QUJDREVG';
    diagnostic.systemPrompt = 'plain system prompt';

    const path = await writeReviewDiagnostic(app, diagnostic);

    expect(mkdirs).toContain(DIAGNOSTIC_FOLDER);
    expect(path.startsWith(`${DIAGNOSTIC_FOLDER}/review-`)).toBe(true);
    expect(path.endsWith('.json')).toBe(true);

    const raw = writes.get(path);
    expect(raw).toBeDefined();
    const parsed = JSON.parse(raw as string);
    expect(parsed.normalized.summary).toEqual(['x']);
    expect(parsed.normalized.readingDecision).toBe('read_source');
    expect(raw).not.toContain('Bearer abcdef123456');
    expect(raw).toContain('data:image/png;base64,[OMITTED]');
  });

  it('does not include any API key field', async () => {
    const { app, writes } = createMockApp();
    const diagnostic = baseDiagnostic();
    // Simulate an accidentally attached secret field.
    (diagnostic as unknown as Record<string, unknown>).apiKey = 'sk-secret-value';

    const path = await writeReviewDiagnostic(app, diagnostic);
    const raw = writes.get(path) as string;

    expect(raw).not.toContain('sk-secret-value');
    expect(JSON.parse(raw).apiKey).toBe('[REDACTED]');
  });
});

describe('isReviewDiagnosticFileName', () => {
  it.each([
    'review-20260924-010203.json',
    'review-20260924-010203-diag123.json',
    'review-a_b.c-d.json',
  ])('accepts %s', (name) => {
    expect(isReviewDiagnosticFileName(name)).toBe(true);
  });

  it.each([
    'data.json',
    'other.json',
    'review.json',
    'review-.json',
    'review-20260924.txt',
    'sub/review-1.json',
    'review-1.json.bak',
  ])('rejects %s', (name) => {
    expect(isReviewDiagnosticFileName(name)).toBe(false);
  });
});

describe('isReviewDiagnosticFilePath', () => {
  it('accepts only exact diagnostics-directory review files', () => {
    expect(isReviewDiagnosticFilePath('.inbox-curator/diagnostics/review-1.json')).toBe(true);
    expect(isReviewDiagnosticFilePath('.inbox-curator/diagnostics/sub/review-1.json')).toBe(false);
    expect(isReviewDiagnosticFilePath('.inbox-curator/logs/review-1.json')).toBe(false);
    expect(isReviewDiagnosticFilePath('.inbox-curator/diagnostics/../review-1.json')).toBe(false);
    expect(isReviewDiagnosticFilePath('.inbox-curator/diagnostics/other.json')).toBe(false);
    expect(isReviewDiagnosticFilePath('review-1.json')).toBe(false);
  });
});

describe('listReviewDiagnosticFiles / removeReviewDiagnosticFiles', () => {
  it('lists only review-*.json files in the diagnostics folder', async () => {
    const app = {
      vault: {
        adapter: {
          list: async () => ({
            files: [
              '.inbox-curator/diagnostics/review-1.json',
              '.inbox-curator/diagnostics/other.json',
              '.inbox-curator/diagnostics/notes.md',
            ],
            folders: [],
          }),
        },
      },
    };

    await expect(listReviewDiagnosticFiles(app as never)).resolves.toEqual([
      '.inbox-curator/diagnostics/review-1.json',
    ]);
  });

  it('returns an empty list when the folder cannot be listed', async () => {
    const app = {
      vault: {
        adapter: {
          list: async () => {
            throw new Error('missing folder');
          },
        },
      },
    };

    await expect(listReviewDiagnosticFiles(app as never)).resolves.toEqual([]);
  });

  it('removes only the confirmed paths and never re-lists', async () => {
    const removed: string[] = [];
    const list = vi.fn(async () => ({
      files: ['.inbox-curator/diagnostics/review-1.json', '.inbox-curator/diagnostics/review-2.json'],
      folders: [],
    }));
    const app = {
      vault: {
        adapter: {
          list,
          exists: async () => true,
          remove: async (path: string) => {
            removed.push(path);
          },
        },
      },
    };

    await expect(
      removeReviewDiagnosticFiles(app as never, ['.inbox-curator/diagnostics/review-1.json']),
    ).resolves.toEqual({ removed: 1, failed: 0 });
    expect(removed).toEqual(['.inbox-curator/diagnostics/review-1.json']);
    expect(list).not.toHaveBeenCalled();
  });

  it('rejects invalid or out-of-scope confirmed paths', async () => {
    const removed: string[] = [];
    const app = {
      vault: {
        adapter: {
          exists: async () => true,
          remove: async (path: string) => {
            removed.push(path);
          },
        },
      },
    };

    await expect(
      removeReviewDiagnosticFiles(app as never, [
        '.inbox-curator/diagnostics/other.json',
        '.inbox-curator/logs/review-1.json',
        '.inbox-curator/diagnostics/sub/review-1.json',
        '.inbox-curator/diagnostics/../review-1.json',
      ]),
    ).resolves.toEqual({ removed: 0, failed: 4 });
    expect(removed).toEqual([]);
  });

  it('counts a confirmed path that disappeared before removal as failed', async () => {
    const removed: string[] = [];
    const app = {
      vault: {
        adapter: {
          exists: async () => false,
          remove: async (path: string) => {
            removed.push(path);
          },
        },
      },
    };

    await expect(
      removeReviewDiagnosticFiles(app as never, ['.inbox-curator/diagnostics/review-1.json']),
    ).resolves.toEqual({ removed: 0, failed: 1 });
    expect(removed).toEqual([]);
  });

  it('counts partial failures without touching other files', async () => {
    const removed: string[] = [];
    const app = {
      vault: {
        adapter: {
          exists: async () => true,
          remove: async (path: string) => {
            if (path.endsWith('review-2.json')) throw new Error('locked');
            removed.push(path);
          },
        },
      },
    };

    await expect(
      removeReviewDiagnosticFiles(app as never, [
        '.inbox-curator/diagnostics/review-1.json',
        '.inbox-curator/diagnostics/review-2.json',
      ]),
    ).resolves.toEqual({ removed: 1, failed: 1 });
    expect(removed).toEqual(['.inbox-curator/diagnostics/review-1.json']);
  });
});

describe('sanitizeSensitiveData boundary', () => {
  it('redacts secrets but leaves ordinary note text intact', () => {
    const sanitized = sanitizeSensitiveData({
      userPrompt: 'Private meeting note about Project X. Authorization: Bearer abc.def.ghi',
      apiKey: 'sk-secret-value',
      image: 'data:image/png;base64,QUJDREVG',
    });

    expect(sanitized.userPrompt).toContain('Private meeting note about Project X.');
    expect(sanitized.userPrompt).not.toContain('Bearer abc.def.ghi');
    expect((sanitized as Record<string, unknown>).apiKey).toBe('[REDACTED]');
    expect(sanitized.image).toContain('[OMITTED]');
  });
});
