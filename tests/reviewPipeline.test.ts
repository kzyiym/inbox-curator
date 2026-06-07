import { describe, expect, it, vi } from 'vitest';
import { TFile } from 'obsidian';

vi.mock('../src/urlExtraction', () => ({
  fetchUrlContext: vi.fn(),
}));

import { buildReviewModelInputPayload, buildReviewSourceInfo, loadAndConvertImages } from '../src/reviewPipeline';
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

describe('loadAndConvertImages multimodal limits', () => {
  function createMockAppForImages(files: Map<string, any>) {
    return {
      vault: {
        getAbstractFileByPath: (path: string) => files.get(path) || null,
        readBinary: async (file: any) => file.buffer,
      },
    };
  }

  it('limits image count to 3, skips >5MB files, and ignores non-images', async () => {
    const attachments = [
      { path: 'img1.png', kind: 'image', exists: true, extension: 'png', displayName: '1', embedded: true },
      { path: 'img2.jpg', kind: 'image', exists: true, extension: 'jpg', displayName: '2', embedded: true },
      { path: 'img3.webp', kind: 'image', exists: true, extension: 'webp', displayName: '3', embedded: true },
      { path: 'img4.gif', kind: 'image', exists: true, extension: 'gif', displayName: '4', embedded: true }, // Should be skipped due to count > 3
      { path: 'huge.png', kind: 'image', exists: true, extension: 'png', displayName: 'Huge', embedded: true }, // Should be skipped due to size > 5MB
      { path: 'doc.pdf', kind: 'pdf', exists: true, extension: 'pdf', displayName: 'Doc', embedded: true }, // Non-image kind
    ] as any[];

    const files = new Map<string, any>();
    files.set('img1.png', Object.assign(Object.create(TFile.prototype), { path: 'img1.png', extension: 'png', stat: { size: 100 * 1024 }, buffer: new ArrayBuffer(8) }));
    files.set('img2.jpg', Object.assign(Object.create(TFile.prototype), { path: 'img2.jpg', extension: 'jpg', stat: { size: 200 * 1024 }, buffer: new ArrayBuffer(8) }));
    files.set('img3.webp', Object.assign(Object.create(TFile.prototype), { path: 'img3.webp', extension: 'webp', stat: { size: 300 * 1024 }, buffer: new ArrayBuffer(8) }));
    files.set('img4.gif', Object.assign(Object.create(TFile.prototype), { path: 'img4.gif', extension: 'gif', stat: { size: 400 * 1024 }, buffer: new ArrayBuffer(8) }));
    files.set('huge.png', Object.assign(Object.create(TFile.prototype), { path: 'huge.png', extension: 'png', stat: { size: 6 * 1024 * 1024 }, buffer: new ArrayBuffer(8) })); // 6MB > 5MB

    const mockApp = createMockAppForImages(files);

    // Test with all images in attachments (img1, img2, img3, img4, huge)
    // Ordered: img1, img2, img3 (these three should be accepted)
    // huge.png is placed in list before img3 to test size skip
    const testAttachments = [
      attachments[0], // img1.png (OK)
      attachments[4], // huge.png (Skip size)
      attachments[1], // img2.jpg (OK)
      attachments[5], // doc.pdf (Skip non-image kind)
      attachments[2], // img3.webp (OK)
      attachments[3], // img4.gif (Skip due to max 3 count limit of loaded)
    ];

    const result = await loadAndConvertImages(mockApp as any, testAttachments);

    expect(result).toHaveLength(3); // Capped at 3 successfully loaded
    expect(result[0].url).toContain('data:image/png;base64,');
    expect(result[1].url).toContain('data:image/jpeg;base64,');
    expect(result[2].url).toContain('data:image/webp;base64,');

    // Ensure huge.png, doc.pdf, and img4.gif (which would exceed 3 successfully loaded images) are not in the result
    const urls = result.map((r: any) => r.url);
    expect(urls).not.toContain('image/gif'); // img4.gif is excluded as it is the 4th image
  });
});
