import { describe, expect, it } from 'vitest';
import {
  buildReviewDiagnosticFileName,
  writeReviewDiagnostic,
  DIAGNOSTIC_FOLDER,
} from '../src/utils/reviewDiagnostics';
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
