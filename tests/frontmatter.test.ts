import { describe, expect, it } from 'vitest';
import { upsertReviewFrontmatter } from '../src/frontmatter';
import type { ReviewResult } from '../src/types';

function createBaseResult(overrides: Partial<ReviewResult> = {}): ReviewResult {
  return {
    source: {
      noteTitle: 'Example',
      notePath: 'Inbox/example.md',
      outputPath: 'AI Reviews/example.ai-review.md',
      generatedAt: '2026-06-07T00:00:00.000Z',
      sourceHash: 'deadbeef',
    },
    contentType: 'plain_note',
    inputProfile: 'plain_note',
    fetchStatus: 'not_applicable',
    domainProfile: 'none',
    provider: 'openai-compatible',
    model: 'gpt-4o-mini',
    verdict: {
      readingValueLabel: 'medium',
      savingValueLabel: 'medium',
      reliabilityLabel: 'medium',
      recommendedAction: 'keep_as_reference',
      priority: 'medium',
    },
    scores: {
      readingValue: 50,
      savingValue: 50,
      reliability: 0,
      practicality: 50,
    },
    summary: [],
    detailedSummary: '',
    credibilityReview: '',
    practicalityReview: '',
    strengths: [],
    risksOrGaps: [],
    verificationNeeded: [],
    nextActions: [],
    suggestedTags: [],
    flags: {
      needsVerification: false,
      deleteCandidate: false,
    },
    ...overrides,
  };
}

function createMockApp(initialContent: string) {
  let stored = initialContent;
  return {
    app: {
      vault: {
        read: async () => stored,
        modify: async (_file: unknown, next: string) => {
          stored = next;
        },
        process: async (_file: unknown, callback: (content: string) => string) => {
          stored = callback(stored);
          return stored;
        },
      },
    },
    getContent: () => stored,
  };
}

describe('upsertReviewFrontmatter', () => {
  it('adds attachment counts and source url while preserving non ai_review frontmatter', async () => {
    const mock = createMockApp('---\ntitle: Keep me\ncategory: inbox\n---\nBody\n');
    const result = createBaseResult({
      source: {
        noteTitle: 'Example',
        notePath: 'Inbox/example.md',
        outputPath: 'AI Reviews/example.ai-review.md',
        generatedAt: '2026-06-07T00:00:00.000Z',
        sourceHash: 'deadbeef',
        sourceUrl: 'https://example.com/article',
      },
      attachmentSummary: {
        totalCount: 3,
        imageCount: 1,
        videoCount: 0,
        audioCount: 0,
        pdfCount: 1,
        documentCount: 1,
        archiveCount: 0,
        otherCount: 0,
        unresolvedCount: 1,
      },
    });

    await upsertReviewFrontmatter(mock.app as never, {} as never, result);

    const content = mock.getContent();
    expect(content).toContain('title: Keep me');
    expect(content).toContain('category: inbox');
    expect(content).toContain('ai_review_attachment_count: 3');
    expect(content).toContain('ai_review_unresolved_attachment_count: 1');
    expect(content).toContain('ai_review_source_url: "https://example.com/article"');
  });

  it('removes stale attachment counts and stale source url when absent in the new result', async () => {
    const mock = createMockApp('---\ntitle: Keep me\nai_review_attachment_count: 9\nai_review_unresolved_attachment_count: 4\nai_review_source_url: https://old.example.com\n---\nBody\n');
    const result = createBaseResult();

    await upsertReviewFrontmatter(mock.app as never, {} as never, result);

    const content = mock.getContent();
    expect(content).not.toContain('ai_review_attachment_count:');
    expect(content).not.toContain('ai_review_unresolved_attachment_count:');
    expect(content).not.toContain('ai_review_source_url:');
    expect(content).toContain('title: Keep me');
  });

  it('does not update frontmatter when the source changed before the atomic write', async () => {
    const initial = '---\ntitle: Keep me\n---\nChanged body\n';
    const mock = createMockApp(initial);

    const applied = await upsertReviewFrontmatter(
      mock.app as never,
      {} as never,
      createBaseResult(),
      undefined,
      (content) => content.includes('Original body'),
    );

    expect(applied).toBe(false);
    expect(mock.getContent()).toBe(initial);
  });
});
