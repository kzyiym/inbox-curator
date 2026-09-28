import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';
import zlib from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createNodeHttpRequest,
  createPinnedLookup,
  fetchUrlContext,
  hardenedFetchUrl,
  isNonPublicIp,
  isValidFetchUrl,
  readResponseBody,
  setUrlExtractionDependencies,
  type HardenedHttpResponse,
  type HardenedRequestSpec,
  type NodeLookup,
  type ResolvedAddress,
  type UrlExtractionDependencies,
} from '../src/urlExtraction';

const PUBLIC_ADDRESS: ResolvedAddress = { address: '93.184.216.34', family: 4 };
const PRIVATE_ADDRESS: ResolvedAddress = { address: '10.0.0.5', family: 4 };

const requestMock = vi.fn<(spec: unknown) => Promise<HardenedHttpResponse>>();
const resolveHostMock = vi.fn<(hostname: string) => Promise<ResolvedAddress[]>>();

beforeEach(() => {
  requestMock.mockReset();
  resolveHostMock.mockReset();
  resolveHostMock.mockImplementation(async () => [PUBLIC_ADDRESS]);
  setUrlExtractionDependencies({ resolveHost: resolveHostMock, request: requestMock } as UrlExtractionDependencies);
});

afterEach(() => {
  setUrlExtractionDependencies(undefined);
  vi.clearAllMocks();
});

function options(overrides: Partial<{ fetchMetadata: boolean; extractArticle: boolean; maxExtractedCharacters: number }> = {}) {
  return { fetchMetadata: true, extractArticle: true, maxExtractedCharacters: 12000, ...overrides };
}

function respond(response: Partial<HardenedHttpResponse> & { status: number }) {
  requestMock.mockResolvedValue({ status: response.status, headers: response.headers ?? {}, text: response.text ?? '' });
}

describe('fetchUrlContext', () => {
  it('parses title, description, open graph fields, and canonical url', async () => {
    respond({
      status: 200,
      text: `<!doctype html><html><head>
        <title>Example Title</title>
        <meta name="description" content="Example description">
        <meta property="og:title" content="OG Title">
        <meta property="og:description" content="OG Description">
        <link rel="canonical" href="https://example.com/canonical">
      </head><body><article><p>${'A'.repeat(240)}</p></article></body></html>`,
    });

    const result = await fetchUrlContext('https://example.com', 'Inbox/example.md', options());

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
    respond({
      status: 200,
      text: '<html><head><title>Short</title></head><body><article><p>Too short.</p></article></body></html>',
    });

    const result = await fetchUrlContext('https://example.com', 'Inbox/example.md', options());

    expect(result.fetchStatus).toBe('success');
    expect(result.metadata).toMatchObject({ title: 'Short' });
    expect(result.extractionUsed).toBe(false);
    expect(result.extractedText).toBeUndefined();
  });

  it('caps extracted content by maxExtractedCharacters and does not throw on malformed html', async () => {
    respond({
      status: 200,
      text: `<html><head><title>Broken</title></head><body><article><p>${'B'.repeat(3000)}</p>`,
    });

    const result = await fetchUrlContext('https://example.com', 'Inbox/example.md', options({ maxExtractedCharacters: 1100 }));

    expect(result.fetchStatus).toBe('success');
    expect(result.extractionUsed).toBe(true);
    expect(result.extractedText?.length).toBeLessThanOrEqual(1101);
    expect(result.extractedTitle).toBe('Broken');
  });

  it('generates low confidence and warning for navigation-heavy HTML', async () => {
    respond({
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
    });

    const result = await fetchUrlContext('https://example.com', 'Inbox/example.md', options());

    expect(result.fetchStatus).toBe('success');
    if (result.extractionUsed) {
      expect(result.extractionConfidence).toBeLessThan(0.4);
      expect(result.extractionWarnings).toContain('Extracted text content is very short (< 500 chars).');
    } else {
      expect(result.extractionUsed).toBe(false);
    }
  });

  it('generates high confidence for article-like content', async () => {
    const paragraphs = Array(12).fill(`<p>This is a long sentence that forms part of a rich paragraph intended to represent genuine article content. ${'C'.repeat(100)}</p>`).join('\n');
    respond({
      status: 200,
      text: `<html><body><article id="main-content">
        <h1>Genuine Article</h1>
        ${paragraphs}
      </article></body></html>`,
    });

    const result = await fetchUrlContext('https://example.com', 'Inbox/example.md', options());

    expect(result.fetchStatus).toBe('success');
    expect(result.extractionUsed).toBe(true);
    expect(result.extractionConfidence).toBeGreaterThan(0.6);
    expect(result.extractionWarnings).not.toContain('Extracted text content is very short (< 500 chars).');
  });

  it('gives score bonus to Wikipedia content container', async () => {
    respond({
      status: 200,
      text: `<html><body>
        <div id="sidebar">Sidebar stuff</div>
        <div id="mw-content-text"><p>${'W'.repeat(1000)}</p></div>
      </body></html>`,
    });

    const result = await fetchUrlContext('https://en.wikipedia.org/wiki/Test', 'Inbox/example.md', options());

    expect(result.fetchStatus).toBe('success');
    expect(result.extractionUsed).toBe(true);
    expect(result.extractedText).toContain('W'.repeat(1000));
  });

  it('gives score bonus to GitHub content container', async () => {
    respond({
      status: 200,
      text: `<html><body>
        <div class="markdown-body"><p>${'G'.repeat(1000)}</p></div>
      </body></html>`,
    });

    const result = await fetchUrlContext('https://github.com/test/repo', 'Inbox/example.md', options());

    expect(result.fetchStatus).toBe('success');
    expect(result.extractionUsed).toBe(true);
    expect(result.extractedText).toContain('G'.repeat(1000));
  });

  it('falls back to metadata-only for PDF URLs', async () => {
    const result = await fetchUrlContext('https://example.com/document.pdf', 'Inbox/example.md', options());

    expect(result.fetchStatus).toBe('success');
    expect(result.extractionUsed).toBe(false);
    expect(result.extractionConfidence).toBe(0);
    expect(result.extractionWarnings?.[0]).toContain('PDF files cannot be fully parsed');
    expect(result.extractionMethod).toBe('PDF-fallback');
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('falls back to metadata-only when response header content-type is PDF', async () => {
    respond({ status: 200, headers: { 'content-type': 'application/pdf' }, text: '%PDF-1.4 ... binary stuff' });

    const result = await fetchUrlContext('https://example.com/document-service', 'Inbox/example.md', options());

    expect(result.fetchStatus).toBe('success');
    expect(result.extractionUsed).toBe(false);
    expect(result.extractionConfidence).toBe(0);
    expect(result.extractionWarnings?.[0]).toContain('PDF files cannot be fully parsed');
    expect(result.extractionMethod).toBe('PDF-fallback');
  });

  it('conservatively filters out obvious advertisement and iframe lines from extracted text', async () => {
    respond({
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
    });

    const result = await fetchUrlContext('https://example.com', 'Inbox/example.md', options());

    expect(result.fetchStatus).toBe('success');
    expect(result.extractionUsed).toBe(true);
    expect(result.extractedText).toContain('This is standard article text');
    expect(result.extractedText).not.toContain('広告');
    expect(result.extractedText).not.toContain('Advertisement');
    expect(result.extractedText).not.toContain('iframe');
  });
});

describe('fetchUrlContext SSRF defenses', () => {
  it('blocks a literal private target before any network call', async () => {
    const result = await fetchUrlContext('http://169.254.169.254/latest/meta-data', 'Inbox/note.md', options());

    expect(result.fetchStatus).toBe('failed');
    expect(result.extractionMethod).toBe('blocked');
    expect(resolveHostMock).not.toHaveBeenCalled();
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('blocks a hostname whose DNS answer is a private address', async () => {
    resolveHostMock.mockResolvedValue([PRIVATE_ADDRESS]);

    const result = await fetchUrlContext('https://internal.example/', 'Inbox/note.md', options());

    expect(result.fetchStatus).toBe('failed');
    expect(result.extractionMethod).toBe('blocked');
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('fails closed when DNS answers mix public and private addresses', async () => {
    resolveHostMock.mockResolvedValue([PUBLIC_ADDRESS, PRIVATE_ADDRESS]);

    const result = await fetchUrlContext('https://mixed.example/', 'Inbox/note.md', options());

    expect(result.fetchStatus).toBe('failed');
    expect(result.extractionMethod).toBe('blocked');
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('fails closed when DNS returns no addresses', async () => {
    resolveHostMock.mockResolvedValue([]);

    const result = await fetchUrlContext('https://empty.example/', 'Inbox/note.md', options());

    expect(result.fetchStatus).toBe('failed');
    expect(result.extractionMethod).toBe('blocked');
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('pins the validated socket destination so a rebinding answer cannot redirect the connect', async () => {
    const observed: unknown[] = [];
    resolveHostMock.mockResolvedValue([PUBLIC_ADDRESS]);
    requestMock.mockImplementation(async (spec: never) => {
      const hardened = spec as { lookup: (host: string, lookupOptions: { all?: boolean }, callback: (error: Error | null, address?: unknown) => void) => void };
      hardened.lookup('rebind.example', { all: false }, (_error, address) => {
        observed.push(address);
      });
      return { status: 200, headers: {}, text: '<html><head><title>ok</title></head><body><p>ok</p></body></html>' };
    });

    const result = await fetchUrlContext('https://rebind.example/', 'Inbox/note.md', options());

    expect(result.fetchStatus).toBe('success');
    expect(observed).toEqual(['93.184.216.34']);
  });

  it('the pinned lookup fails closed if it is ever handed a non-public address', () => {
    const callback = vi.fn();
    createPinnedLookup([PRIVATE_ADDRESS])('rebind.example', { all: false }, callback);

    expect(callback).toHaveBeenCalledTimes(1);
    expect((callback.mock.calls[0][0] as Error | null)?.name).toBe('UrlBlockedError');
  });

  it('returns vetted addresses for both single and multi-address lookups', () => {
    const callback = vi.fn();
    const lookup = createPinnedLookup([PUBLIC_ADDRESS]);

    lookup('example.com', { all: false }, callback);
    expect(callback).toHaveBeenLastCalledWith(null, '93.184.216.34', 4);

    callback.mockClear();
    lookup('example.com', { all: true }, callback);
    expect(callback).toHaveBeenLastCalledWith(null, [{ address: '93.184.216.34', family: 4 }]);
  });
});

describe('hardenedFetchUrl redirect handling', () => {
  it('follows a redirect to a safe public URL', async () => {
    requestMock
      .mockResolvedValueOnce({ status: 302, headers: { location: 'https://example.com/final' }, text: '' })
      .mockResolvedValueOnce({ status: 200, headers: {}, text: '<html><head><title>Final</title></head><body><p>ok</p></body></html>' });

    const response = await hardenedFetchUrl('https://example.com/start', {}, {
      resolveHost: resolveHostMock,
      request: requestMock,
    } as UrlExtractionDependencies);

    expect(response.status).toBe(200);
    expect(requestMock).toHaveBeenCalledTimes(2);
    expect(resolveHostMock).toHaveBeenCalledTimes(2);
  });

  it('blocks a redirect to a literal private address before connecting', async () => {
    requestMock.mockResolvedValueOnce({ status: 302, headers: { location: 'http://127.0.0.1/' }, text: '' });

    const result = await fetchUrlContext('https://example.com/start', 'Inbox/note.md', options());

    expect(result.fetchStatus).toBe('failed');
    expect(result.extractionMethod).toBe('blocked');
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it('blocks a redirect to a hostname that resolves to a private address', async () => {
    resolveHostMock.mockImplementation(async (hostname: string) => (hostname === 'internal.example' ? [PRIVATE_ADDRESS] : [PUBLIC_ADDRESS]));
    requestMock.mockResolvedValueOnce({ status: 302, headers: { location: 'http://internal.example/secret' }, text: '' });

    const result = await fetchUrlContext('https://public.example/start', 'Inbox/note.md', options());

    expect(result.fetchStatus).toBe('failed');
    expect(result.extractionMethod).toBe('blocked');
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it('fails closed after too many redirects', async () => {
    requestMock.mockResolvedValue({ status: 302, headers: { location: 'https://example.com/loop' }, text: '' });

    const result = await fetchUrlContext('https://example.com/loop', 'Inbox/note.md', options());

    expect(result.fetchStatus).toBe('failed');
    expect(result.extractionMethod).toBe('blocked');
    expect(requestMock).toHaveBeenCalledTimes(6);
  });
});

describe('isNonPublicIp', () => {
  it.each([
    '0.0.0.0',
    '10.0.0.1',
    '100.64.0.1',
    '127.0.0.1',
    '169.254.169.254',
    '172.16.5.4',
    '172.31.255.255',
    '192.0.0.1',
    '192.0.2.1',
    '192.88.99.1',
    '192.168.1.1',
    '198.18.0.1',
    '198.51.100.1',
    '203.0.113.1',
    '224.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    'fe80::1',
    'fc00::1',
    'fd00::1',
    'ff02::1',
    '::ffff:127.0.0.1',
    '::ffff:10.0.0.1',
    '::ffff:0:127.0.0.1',
    '::ffff:0:169.254.169.254',
    '::5efe:a9fe:a9fe',
    '2606:4700::5efe:a9fe:a9fe',
    '64:ff9b::a00:1',
    '2002:0a00:0001::',
    '2001:db8::1',
    '2001::1',
    '3fff::1',
    '100::1',
    '5f00::1',
    '64:ff9b:1::1',
    'fec0::1',
  ])('treats %s as non-public', (address) => {
    expect(isNonPublicIp(address)).toBe(true);
  });

  it.each([
    '8.8.8.8',
    '1.1.1.1',
    '93.184.216.34',
    '2606:4700:4700::1111',
    '2001:4860:4860::8888',
    '::ffff:8.8.8.8',
    '64:ff9b::808:808',
  ])('treats %s as public', (address) => {
    expect(isNonPublicIp(address)).toBe(false);
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

describe('createNodeHttpRequest (real transport data-flow)', () => {
  const nodeLoader: any = (name: string) => {
    if (name === 'node:http' || name === 'http') return http;
    if (name === 'node:zlib' || name === 'zlib') return zlib;
    return undefined;
  };

  const loopbackLookup: NodeLookup = (_hostname, _options, callback) => {
    callback(null, '127.0.0.1', 4);
  };

  function transportSpec(url: string, timeoutMs?: number): HardenedRequestSpec {
    return { url, method: 'GET', headers: {}, timeoutMs, lookup: loopbackLookup };
  }

  function startServer(handler: http.RequestListener): Promise<{ url: string; close: () => Promise<void> }> {
    return new Promise((resolve) => {
      const server = http.createServer(handler);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address() as AddressInfo;
        resolve({
          url: `http://127.0.0.1:${address.port}/`,
          close: () =>
            new Promise<void>((done) => {
              (server as http.Server & { closeAllConnections?: () => void }).closeAllConnections?.();
              server.close(() => done());
            }),
        });
      });
    });
  }

  it.each([
    ['gzip', (body: Buffer) => zlib.gzipSync(body)],
    ['deflate', (body: Buffer) => zlib.deflateSync(body)],
    ['br', (body: Buffer) => zlib.brotliCompressSync(body)],
  ])('decodes %s responses and resolves instead of hanging', async (encoding, compress) => {
    const body = `<html><head><title>Compressed</title></head><body><p>${'A'.repeat(500)}</p></body></html>`;
    const server = await startServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-encoding': encoding });
      response.end(compress(Buffer.from(body, 'utf8')));
    });

    try {
      const request = createNodeHttpRequest(nodeLoader);
      const result = await request(transportSpec(server.url));
      expect(result.status).toBe(200);
      expect(result.headers['content-encoding']).toBe(encoding);
      expect(result.text).toBe(body);
    } finally {
      await server.close();
    }
  });

  it('resolves uncompressed responses unchanged', async () => {
    const body = '<html><head><title>Plain</title></head><body><p>plain</p></body></html>';
    const server = await startServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(body);
    });

    try {
      const request = createNodeHttpRequest(nodeLoader);
      const result = await request(transportSpec(server.url));
      expect(result.status).toBe(200);
      expect(result.text).toBe(body);
    } finally {
      await server.close();
    }
  });

  it('uses the pinned lookup for the real socket, reaching a host that DNS cannot resolve', async () => {
    const body = '<html><head><title>Pinned</title></head><body><p>pinned</p></body></html>';
    const server = await startServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end(body);
    });
    const port = new URL(server.url).port;
    const seen: Array<{ hostname: string; all: boolean }> = [];
    const pinnedLookup: NodeLookup = (hostname, lookupOptions, callback) => {
      seen.push({ hostname, all: Boolean(lookupOptions?.all) });
      if (lookupOptions?.all) {
        callback(null, [{ address: '127.0.0.1', family: 4 }]);
        return;
      }
      callback(null, '127.0.0.1', 4);
    };

    try {
      const request = createNodeHttpRequest(nodeLoader);
      const result = await request({ url: `http://not-a-real-host.invalid:${port}/`, method: 'GET', headers: {}, lookup: pinnedLookup });
      expect(result.status).toBe(200);
      expect(result.text).toBe(body);
      expect(seen.length).toBeGreaterThan(0);
      expect(seen[0].hostname).toBe('not-a-real-host.invalid');
    } finally {
      await server.close();
    }
  });

  it('rejects when the decoded body exceeds the configured limit', async () => {
    const response = Readable.from([zlib.gzipSync(Buffer.alloc(200 * 1024, 65))]);

    await expect(readResponseBody(response, 'gzip', zlib, 1024)).rejects.toThrow(/maximum allowed size/);
  });

  it('aborts a stalled request through the socket timeout', async () => {
    const server = await startServer(() => {});

    try {
      const request = createNodeHttpRequest(nodeLoader);
      await expect(request(transportSpec(server.url, 150))).rejects.toThrow(/timed out/);
    } finally {
      await server.close();
    }
  });
});
