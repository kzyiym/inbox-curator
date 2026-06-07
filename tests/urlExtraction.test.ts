import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', async (importOriginal) => {
  const actual = await importOriginal<typeof import('obsidian')>();
  return {
    ...actual,
    requestUrl: vi.fn(),
  };
});

import { requestUrl } from 'obsidian';
import { fetchUrlContext } from '../src/urlExtraction';

afterEach(() => {
  vi.clearAllMocks();
});

describe('fetchUrlContext', () => {
  it('parses title, description, open graph fields, and canonical url', async () => {
    vi.mocked(requestUrl).mockResolvedValue({
      status: 200,
      text: `<!doctype html><html><head>
        <title>Example Title</title>
        <meta name="description" content="Example description">
        <meta property="og:title" content="OG Title">
        <meta property="og:description" content="OG Description">
        <link rel="canonical" href="https://example.com/canonical">
      </head><body><article><p>${'A'.repeat(240)}</p></article></body></html>`,
    } as never);

    const result = await fetchUrlContext('https://example.com', 'Inbox/example.md', {
      fetchMetadata: true,
      extractArticle: true,
      maxExtractedCharacters: 12000,
    });

    expect(result.fetchStatus).toBe('success');
    expect(result.metadata).toMatchObject({
      title: 'Example Title',
      description: 'Example description',
      ogTitle: 'OG Title',
      ogDescription: 'OG Description',
      canonicalUrl: 'https://example.com/canonical',
    });
    expect(result.extractionUsed).toBe(true);
  });

  it('returns metadata safely when article extraction fails the quality gate', async () => {
    vi.mocked(requestUrl).mockResolvedValue({
      status: 200,
      text: '<html><head><title>Short</title></head><body><article><p>Too short.</p></article></body></html>',
    } as never);

    const result = await fetchUrlContext('https://example.com', 'Inbox/example.md', {
      fetchMetadata: true,
      extractArticle: true,
      maxExtractedCharacters: 12000,
    });

    expect(result.fetchStatus).toBe('success');
    expect(result.metadata).toMatchObject({ title: 'Short' });
    expect(result.extractionUsed).toBe(false);
    expect(result.extractedText).toBeUndefined();
  });

  it('caps extracted content by maxExtractedCharacters and does not throw on malformed html', async () => {
    vi.mocked(requestUrl).mockResolvedValue({
      status: 200,
      text: `<html><head><title>Broken</title></head><body><article><p>${'B'.repeat(3000)}</p>`,
    } as never);

    const result = await fetchUrlContext('https://example.com', 'Inbox/example.md', {
      fetchMetadata: true,
      extractArticle: true,
      maxExtractedCharacters: 1100,
    });

    expect(result.fetchStatus).toBe('success');
    expect(result.extractionUsed).toBe(true);
    expect(result.extractedText?.length).toBeLessThanOrEqual(1101);
    expect(result.extractedTitle).toBe('Broken');
  });
});
