import { describe, expect, it, vi } from 'vitest';
import { TFile } from 'obsidian';

vi.mock('../src/urlExtraction', () => ({
  fetchUrlContext: vi.fn(),
}));

import { buildReviewModelInputPayload, buildReviewSourceInfo } from '../src/reviewPipeline';
import { fetchUrlContext } from '../src/urlExtraction';

function createTFile(path: string) {
  const basename = path.split('/').pop()?.replace(/\.[^.]+$/, '') ?? path;
  return Object.assign(Object.create(TFile.prototype), {
    path,
    basename,
    extension: 'md',
    stat: {
      mtime: 123,
      size: 456,
    },
  }) as TFile;
}

const app = {
  metadataCache: {
    getFirstLinkpathDest: () => null,
  },
};

const options = {
  outputFolder: 'AI Reviews',
  provider: 'openai-compatible' as const,
  endpointUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  fetchUrlMetadata: true,
  extractUrlArticleText: true,
  maxExtractedCharacters: 12000,
  readImages: false,
  readVideos: false,
};

describe('buildReviewSourceInfo source hash behavior', () => {
  it('keeps the same source hash when only ai_review frontmatter and file stat metadata change', () => {
    const file = createTFile('Inbox/note.md');
    const originalContent = `---\ntags:\n  - inbox\n---\nBody text\n`;
    const original = buildReviewSourceInfo(file, 'AI Reviews', originalContent);

    file.stat.mtime = 999999;
    file.stat.size = 999999;

    const reviewedContent = `---\ntags:\n  - inbox\nai_review_status: completed\nai_review_source_hash: deadbeef\nai_review_processed_at: 2026-06-07T00:00:00.000Z\n---\nBody text\n`;
    const reviewed = buildReviewSourceInfo(file, 'AI Reviews', reviewedContent);

    expect(reviewed.sourceHash).toBe(original.sourceHash);
  });
});

describe('buildReviewModelInputPayload URL-only behavior', () => {
  it('treats URL-only body plus heading-only structure as url_only', async () => {
    vi.mocked(fetchUrlContext).mockResolvedValue({
      fetchStatus: 'success',
      metadata: { title: 'Example' },
      extractionUsed: false,
    });

    const file = createTFile('Inbox/link.md');
    const noteContent = '# Clip\n\nhttps://example.com/article\n';
    const source = buildReviewSourceInfo(file, 'AI Reviews', noteContent);

    const result = await buildReviewModelInputPayload(app as never, file, noteContent, source, options);

    expect(result.contentType).toBe('url_only');
    expect(result.inputProfile).toBe('url_only');
    expect(result.sourceUrl).toBe('https://example.com/article');
  });

  it('does not treat meaningful body text as url_only', async () => {
    const file = createTFile('Inbox/note.md');
    const noteContent = 'https://example.com/article\n\nThis note has actual commentary.';
    const source = buildReviewSourceInfo(file, 'AI Reviews', noteContent);

    const result = await buildReviewModelInputPayload(app as never, file, noteContent, source, options);

    expect(result.contentType).toBe('plain_note');
    expect(result.inputProfile).toBe('plain_note');
  });

  it('promotes to fetched_url and web_article only when extracted article text exists', async () => {
    vi.mocked(fetchUrlContext).mockResolvedValue({
      fetchStatus: 'success',
      metadata: { title: 'Example' },
      extractedText: 'A'.repeat(400),
      extractedTitle: 'Example title',
      extractionUsed: true,
    });

    const file = createTFile('Inbox/link.md');
    const noteContent = 'https://example.com/article';
    const source = buildReviewSourceInfo(file, 'AI Reviews', noteContent);

    const result = await buildReviewModelInputPayload(app as never, file, noteContent, source, options);

    expect(result.contentType).toBe('fetched_url');
    expect(result.inputProfile).toBe('web_article');
  });

  it('does not promote when only metadata exists', async () => {
    vi.mocked(fetchUrlContext).mockResolvedValue({
      fetchStatus: 'success',
      metadata: { title: 'Example' },
      extractedTitle: 'Example title',
      extractionUsed: false,
    });

    const file = createTFile('Inbox/link.md');
    const noteContent = 'https://example.com/article';
    const source = buildReviewSourceInfo(file, 'AI Reviews', noteContent);

    const result = await buildReviewModelInputPayload(app as never, file, noteContent, source, options);

    expect(result.contentType).toBe('url_only');
    expect(result.inputProfile).toBe('url_only');
  });
});
