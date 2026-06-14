import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', async (importOriginal) => {
  const actual = await importOriginal<typeof import('obsidian')>();
  return {
    ...actual,
    requestUrl: vi.fn(),
  };
});

import { requestUrl } from 'obsidian';
import { fetchUrlContext, isValidFetchUrl } from '../src/urlExtraction';

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

  it('generates low confidence and warning for navigation-heavy HTML', async () => {
    vi.mocked(requestUrl).mockResolvedValue({
      status: 200,
      text: `<html><body>
        <div id="nav">
          <a href="/1">Link 1</a>
          <a href="/2">Link 2</a>
          <a href="/3">Link 3</a>
          <a href="/4">Link 4</a>
          <a href="/5">Link 5</a>
          <a href="/6">Link 6</a>
          <a href="/7">Link 7</a>
          <a href="/8">Link 8</a>
        </div>
        <div>
          <p>This is too short link page.</p>
        </div>
      </body></html>`,
    } as never);

    const result = await fetchUrlContext('https://example.com', 'Inbox/example.md', {
      fetchMetadata: true,
      extractArticle: true,
      maxExtractedCharacters: 12000,
    });

    expect(result.fetchStatus).toBe('success');
    // High link density or short text will lead to extractionUsed: false (quality gate failure) or low confidence
    if (result.extractionUsed) {
      expect(result.extractionConfidence).toBeLessThan(0.4);
      expect(result.extractionWarnings).toContain('Extracted text content is very short (< 500 chars).');
    } else {
      expect(result.extractionUsed).toBe(false);
    }
  });

  it('generates high confidence for article-like content', async () => {
    const paragraphs = Array(12).fill(`<p>This is a long sentence that forms part of a rich paragraph intended to represent genuine article content. ${'C'.repeat(100)}</p>`).join('\n');
    vi.mocked(requestUrl).mockResolvedValue({
      status: 200,
      text: `<html><body><article id="main-content">
        <h1>Genuine Article</h1>
        ${paragraphs}
      </article></body></html>`,
    } as never);

    const result = await fetchUrlContext('https://example.com', 'Inbox/example.md', {
      fetchMetadata: true,
      extractArticle: true,
      maxExtractedCharacters: 12000,
    });

    expect(result.fetchStatus).toBe('success');
    expect(result.extractionUsed).toBe(true);
    expect(result.extractionConfidence).toBeGreaterThan(0.6);
    expect(result.extractionWarnings).not.toContain('Extracted text content is very short (< 500 chars).');
  });

  it('gives score bonus to Wikipedia content container', async () => {
    vi.mocked(requestUrl).mockResolvedValue({
      status: 200,
      text: `<html><body>
        <div id="sidebar">Sidebar stuff</div>
        <div id="mw-content-text"><p>${'W'.repeat(1000)}</p></div>
      </body></html>`,
    } as never);

    const result = await fetchUrlContext('https://en.wikipedia.org/wiki/Test', 'Inbox/example.md', {
      fetchMetadata: true,
      extractArticle: true,
      maxExtractedCharacters: 12000,
    });

    expect(result.fetchStatus).toBe('success');
    expect(result.extractionUsed).toBe(true);
    expect(result.extractedText).toContain('W'.repeat(1000));
  });

  it('gives score bonus to GitHub content container', async () => {
    vi.mocked(requestUrl).mockResolvedValue({
      status: 200,
      text: `<html><body>
        <div class="markdown-body"><p>${'G'.repeat(1000)}</p></div>
      </body></html>`,
    } as never);

    const result = await fetchUrlContext('https://github.com/test/repo', 'Inbox/example.md', {
      fetchMetadata: true,
      extractArticle: true,
      maxExtractedCharacters: 12000,
    });

    expect(result.fetchStatus).toBe('success');
    expect(result.extractionUsed).toBe(true);
    expect(result.extractedText).toContain('G'.repeat(1000));
  });

  it('falls back to metadata-only for PDF URLs', async () => {
    const result = await fetchUrlContext('https://example.com/document.pdf', 'Inbox/example.md', {
      fetchMetadata: true,
      extractArticle: true,
      maxExtractedCharacters: 12000,
    });

    expect(result.fetchStatus).toBe('success');
    expect(result.extractionUsed).toBe(false);
    expect(result.extractionConfidence).toBe(0);
    expect(result.extractionWarnings?.[0]).toContain('PDF files cannot be fully parsed');
    expect(result.extractionMethod).toBe('PDF-fallback');
  });

  it('falls back to metadata-only when response header content-type is PDF', async () => {
    vi.mocked(requestUrl).mockResolvedValue({
      status: 200,
      headers: {
        'content-type': 'application/pdf',
      },
      text: '%PDF-1.4 ... binary stuff',
    } as never);

    const result = await fetchUrlContext('https://example.com/document-service', 'Inbox/example.md', {
      fetchMetadata: true,
      extractArticle: true,
      maxExtractedCharacters: 12000,
    });

    expect(result.fetchStatus).toBe('success');
    expect(result.extractionUsed).toBe(false);
    expect(result.extractionConfidence).toBe(0);
    expect(result.extractionWarnings?.[0]).toContain('PDF files cannot be fully parsed');
    expect(result.extractionMethod).toBe('PDF-fallback');
  });

  it('conservatively filters out obvious advertisement and iframe lines from extracted text', async () => {
    vi.mocked(requestUrl).mockResolvedValue({
      status: 200,
      text: `<html><body><article>
        <h1>Article Header</h1>
        <p>This is standard article text paragraph that should remain in the output.</p>
        <div>広告</div>
        <p>Another genuine paragraph explaining the concept details.</p>
        <div>## Advertisement</div>
        <p>Third genuine paragraph that is long enough to pass quality gates.</p>
        <div>iframe</div>
        <p>Fourth paragraph to ensure we have enough content to satisfy quality gates.</p>
      </article></body></html>`,
    } as never);

    const result = await fetchUrlContext('https://example.com', 'Inbox/example.md', {
      fetchMetadata: true,
      extractArticle: true,
      maxExtractedCharacters: 12000,
    });

    expect(result.fetchStatus).toBe('success');
    expect(result.extractionUsed).toBe(true);
    expect(result.extractedText).toContain('This is standard article text');
    expect(result.extractedText).not.toContain('広告');
    expect(result.extractedText).not.toContain('Advertisement');
    expect(result.extractedText).not.toContain('iframe');
  });
});

describe('isValidFetchUrl', () => {
  it.each([
    'http://localhost',
    'http://service.local/path',
    'http://127.0.0.1',
    'http://169.254.169.254/latest/meta-data',
    'http://100.64.0.1',
    'http://[::1]/',
    'https://user:password@example.com/',
  ])('blocks unsafe target %s', (url) => {
    expect(isValidFetchUrl(url)).toBe(false);
  });

  it('allows a normal public HTTPS URL', () => {
    expect(isValidFetchUrl('https://example.com/article')).toBe(true);
  });
});
