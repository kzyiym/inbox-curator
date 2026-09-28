import { isAdOrIframeLine } from './utils/contentFilter';

export interface UrlMetadata {
  title?: string;
  description?: string;
  ogTitle?: string;
  ogDescription?: string;
  ogSiteName?: string;
  ogType?: string;
  ogUrl?: string;
  twitterTitle?: string;
  twitterDescription?: string;
  canonicalUrl?: string;
}

export interface UrlExtractionOptions {
  fetchMetadata: boolean;
  extractArticle: boolean;
  maxExtractedCharacters: number;
  timeoutMs?: number;
}

export interface UrlExtractionResult {
  fetchStatus: 'success' | 'failed';
  metadata?: UrlMetadata;
  extractedText?: string;
  extractedTitle?: string;
  extractionUsed: boolean;
  extractionConfidence?: number;
  extractionWarnings?: string[];
  extractionMethod?: string;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&nbsp;/gi, ' ')
    .trim();
}

function parseAttributes(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of Array.from(tag.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g))) {
    const [, key, doubleQuoted, singleQuoted, unquoted] = match;
    const rawValue = doubleQuoted ?? singleQuoted ?? unquoted ?? '';
    attributes[key.toLowerCase()] = decodeHtmlEntities(rawValue);
  }

  return attributes;
}

function extractTitleTag(html: string): string | undefined {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match?.[1] ? decodeHtmlEntities(match[1].replace(/\s+/g, ' ')) : undefined;
}

function extractMetaContent(html: string, attributeName: 'name' | 'property', attributeValue: string): string | undefined {
  for (const match of Array.from(html.matchAll(/<meta\b[^>]*>/gi))) {
    const tag = match[0];
    const attributes = parseAttributes(tag);
    if (attributes[attributeName] === attributeValue) {
      return attributes.content;
    }
  }

  return undefined;
}

function extractCanonicalUrl(html: string): string | undefined {
  for (const match of Array.from(html.matchAll(/<link\b[^>]*>/gi))) {
    const tag = match[0];
    const attributes = parseAttributes(tag);
    if (attributes.rel?.toLowerCase() === 'canonical') {
      return attributes.href;
    }
  }

  return undefined;
}

function buildUrlMetadata(html: string): UrlMetadata {
  const metadata: UrlMetadata = {
    title: extractTitleTag(html),
    description: extractMetaContent(html, 'name', 'description'),
    ogTitle: extractMetaContent(html, 'property', 'og:title'),
    ogDescription: extractMetaContent(html, 'property', 'og:description'),
    ogSiteName: extractMetaContent(html, 'property', 'og:site_name'),
    ogType: extractMetaContent(html, 'property', 'og:type'),
    ogUrl: extractMetaContent(html, 'property', 'og:url'),
    twitterTitle: extractMetaContent(html, 'name', 'twitter:title'),
    twitterDescription: extractMetaContent(html, 'name', 'twitter:description'),
    canonicalUrl: extractCanonicalUrl(html),
  };

  return Object.fromEntries(Object.entries(metadata).filter(([, value]) => typeof value === 'string' && value.trim() !== '')) as UrlMetadata;
}

function removeNonContentElements(root: ParentNode): void {
  const selectors = ['script', 'style', 'noscript', 'svg', 'canvas', 'iframe', 'nav', 'footer', 'header', 'aside', 'form'];
  for (const selector of selectors) {
    for (const node of Array.from(root.querySelectorAll(selector))) {
      node.remove();
    }
  }
}

function scoreCandidate(element: Element, url?: string): number {
  const tagName = element.tagName.toLowerCase();
  const tagScoreMap: Record<string, number> = {
    article: 120,
    main: 100,
    section: 30,
    div: 10,
    body: 0,
  };

  const className = (element.getAttribute('class') ?? '').toLowerCase();
  const id = (element.getAttribute('id') ?? '').toLowerCase();
  const hintText = `${className} ${id}`;

  let score = tagScoreMap[tagName] ?? 0;
  if (/(article|content|post|entry|story|markdown|documentation|doc|readme)/.test(hintText)) {
    score += 80;
  }
  if (/(comment|sidebar|footer|header|menu|nav|share|promo|related|breadcrumb|ads?)/.test(hintText)) {
    score -= 60;
  }

  const textLength = element.textContent?.replace(/\s+/g, ' ').trim().length ?? 0;
  score += Math.min(textLength, 8000) / 20;

  const paragraphCount = element.querySelectorAll('p').length;
  score += paragraphCount * 12;

  // Link Density Penalty (Readability-style)
  const linkTextLength = Array.from(element.querySelectorAll('a')).reduce(
    (acc, link) => acc + (link.textContent?.trim().length ?? 0),
    0
  );
  if (textLength > 0) {
    const linkDensity = linkTextLength / textLength;
    if (linkDensity > 0.4) {
      score -= 150; // Heavy penalty for link-heavy blocks
    } else {
      score -= linkDensity * 100;
    }
  }

  // Domain-specific rules
  if (url) {
    const lowerUrl = url.toLowerCase();
    if (lowerUrl.includes('wikipedia.org') && (id === 'mw-content-text' || className.includes('mw-parser-output'))) {
      score += 300;
    } else if (lowerUrl.includes('github.com') && (className.includes('markdown-body') || id === 'readme')) {
      score += 300;
    }
  }

  return score;
}

function normalizeExtractedText(text: string, maxCharacters: number): string | undefined {
  const lines = text.split('\n');
  const filteredLines = lines.filter((line) => !isAdOrIframeLine(line));
  const filteredText = filteredLines.join('\n');

  const normalized = filteredText
    .replace(/\u00a0/g, ' ')
    .replace(/\s+\n/g, '\n')
    .replace(/\n\s+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();

  if (!normalized) {
    return undefined;
  }

  if (normalized.length <= maxCharacters) {
    return normalized;
  }

  return `${normalized.slice(0, maxCharacters).trimEnd()}…`;
}

function extractReadableText(html: string, maxCharacters: number, url?: string): {
  extractedText?: string;
  extractedTitle?: string;
  confidence: number;
  warnings: string[];
  method: string;
} {
  const parser = new DOMParser();
  const parsedDoc = parser.parseFromString(html, 'text/html');
  const title = parsedDoc.title?.trim() || undefined;

  removeNonContentElements(parsedDoc);

  const candidates = Array.from(parsedDoc.querySelectorAll('article, main, section, div, body'));
  let bestCandidate: Element | null = null;
  let bestScore = -Infinity;

  for (const candidate of candidates) {
    const score = scoreCandidate(candidate, url);
    if (score > bestScore) {
      bestScore = score;
      bestCandidate = candidate;
    }
  }

  const rawText = bestCandidate?.textContent ?? parsedDoc.body?.textContent ?? '';
  const extractedText = normalizeExtractedText(rawText, maxCharacters);

  // Quality check metrics
  let containerLinkDensity = 0;
  let paragraphCount = 0;
  if (bestCandidate) {
    const containerTextLength = bestCandidate.textContent?.replace(/\s+/g, ' ').trim().length ?? 0;
    const containerLinkTextLength = Array.from(bestCandidate.querySelectorAll('a')).reduce(
      (acc, link) => acc + (link.textContent?.trim().length ?? 0),
      0
    );
    if (containerTextLength > 0) {
      containerLinkDensity = containerLinkTextLength / containerTextLength;
    }
    paragraphCount = bestCandidate.querySelectorAll('p').length;
  }

  const warnings: string[] = [];
  let confidence = 0;

  if (!extractedText || extractedText.length < 200) {
    return {
      extractedTitle: title,
      confidence: 0,
      warnings: ['Extracted text content is too short or empty.'],
      method: 'Readability-style',
    };
  }

  // Calculate confidence: 0.0 to 1.0
  const lengthFactor = Math.min(1.0, extractedText.length / 3000);
  const linkDensityFactor = Math.max(0.0, 1.0 - containerLinkDensity);
  const paragraphFactor = Math.min(1.0, paragraphCount / 8);
  confidence = lengthFactor * 0.4 + linkDensityFactor * 0.4 + paragraphFactor * 0.2;
  confidence = Math.min(1.0, Math.max(0.0, confidence));

  // Add warnings based on thresholds
  if (extractedText.length < 500) {
    warnings.push('Extracted text content is very short (< 500 chars).');
  }
  if (containerLinkDensity > 0.25) {
    warnings.push('Extracted content has a relatively high link density, which may indicate it is a navigation page.');
  }

  return {
    extractedText,
    extractedTitle: title,
    confidence,
    warnings,
    method: 'Readability-style',
  };
}

const BLOCKED_HOST_PATTERNS = [
  /^localhost$/i,
  /\.localhost$/i,
  /\.local$/i,
  /^metadata(?:\.google\.internal)?$/i,
  /^127\.\d+\.\d+\.\d+$/,
  /^0\.0\.0\.0$/,
  /^::1$/,
  /^::$/,
  /^f[cd][0-9a-f:]+$/i,
  /^fe[89ab][0-9a-f:]+$/i,
  /^::ffff:(?:127|10|169\.254|172\.(?:1[6-9]|2\d|3[01])|192\.168)\./i,
  /^169\.254\.\d+\.\d+$/,
  /^10\.\d+\.\d+\.\d+$/,
  /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/,
  /^192\.168\.\d+\.\d+$/,
  /^100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d+\.\d+$/,
  /^192\.0\.0\.\d+$/,
  /^192\.0\.2\.\d+$/,
  /^198\.1[89]\.\d+\.\d+$/,
  /^198\.51\.100\.\d+$/,
  /^203\.0\.113\.\d+$/,
  /^(?:22[4-9]|23\d|24\d|25[0-5])\.\d+\.\d+\.\d+$/,
];

export function isValidFetchUrl(raw: string): boolean {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    if (parsed.username || parsed.password) return false;
    const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    for (const pattern of BLOCKED_HOST_PATTERNS) {
      if (pattern.test(hostname)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export interface ResolvedAddress {
  address: string;
  family: number;
}

export type NodeLookupCallback = (error: Error | null, address?: string | Array<{ address: string; family: number }>, family?: number) => void;
export type NodeLookup = (hostname: string, options: { all?: boolean } | undefined, callback: NodeLookupCallback) => void;

export interface HardenedRequestSpec {
  url: string;
  method: 'GET';
  headers: Record<string, string>;
  timeoutMs?: number;
  lookup: NodeLookup;
}

export interface HardenedHttpResponse {
  status: number;
  headers: Record<string, string>;
  text: string;
}

export interface UrlExtractionDependencies {
  resolveHost(hostname: string): Promise<ResolvedAddress[]>;
  request(spec: HardenedRequestSpec): Promise<HardenedHttpResponse>;
}

export class UrlBlockedError extends Error {
  reason: string;

  constructor(reason: string) {
    super(`Blocked URL fetch: ${reason}`);
    this.name = 'UrlBlockedError';
    this.reason = reason;
  }
}

const MAX_REDIRECTS = 5;
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
const MAX_COMPRESSED_BYTES = 10 * 1024 * 1024;

export interface ResponseLimits {
  maxDecodedBytes: number;
  maxCompressedBytes: number;
}

const DEFAULT_RESPONSE_LIMITS: ResponseLimits = {
  maxDecodedBytes: MAX_RESPONSE_BYTES,
  maxCompressedBytes: MAX_COMPRESSED_BYTES,
};

const NON_PUBLIC_IPV4_RANGES: Array<[string, number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

function ipv4ToInt(value: string): number | undefined {
  const parts = value.split('.');
  if (parts.length !== 4) return undefined;
  let result = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return undefined;
    const octet = Number(part);
    if (octet > 255) return undefined;
    result = result * 256 + octet;
  }
  return result >>> 0;
}

function ipv4InRange(value: number, base: number, prefix: number): boolean {
  if (prefix === 0) return true;
  const mask = prefix === 32 ? 0xffffffff : (0xffffffff << (32 - prefix)) >>> 0;
  return ((value & mask) >>> 0) === ((base & mask) >>> 0);
}

function isNonPublicIpv4(value: number): boolean {
  for (const [base, prefix] of NON_PUBLIC_IPV4_RANGES) {
    const baseInt = ipv4ToInt(base);
    if (baseInt !== undefined && ipv4InRange(value, baseInt, prefix)) return true;
  }
  return false;
}

function parseIpv6(value: string): Uint8Array | undefined {
  let normalized = value;
  const zoneIndex = normalized.indexOf('%');
  if (zoneIndex !== -1) normalized = normalized.slice(0, zoneIndex);

  if (normalized.includes('.')) {
    const lastColon = normalized.lastIndexOf(':');
    const embedded = ipv4ToInt(normalized.slice(lastColon + 1));
    if (embedded === undefined) return undefined;
    const high = ((embedded >>> 16) & 0xffff).toString(16);
    const low = (embedded & 0xffff).toString(16);
    normalized = `${normalized.slice(0, lastColon + 1)}${high}:${low}`;
  }

  const doubleColon = normalized.indexOf('::');
  let head: string[];
  let tail: string[];
  if (doubleColon !== -1) {
    if (normalized.indexOf('::', doubleColon + 1) !== -1) return undefined;
    head = normalized.slice(0, doubleColon).split(':').filter((part) => part !== '');
    tail = normalized.slice(doubleColon + 2).split(':').filter((part) => part !== '');
  } else {
    head = normalized.split(':');
    tail = [];
  }

  const missing = 8 - head.length - tail.length;
  if (doubleColon === -1 && missing !== 0) return undefined;
  if (missing < 0) return undefined;

  const groups = [...head, ...new Array<string>(missing).fill('0'), ...tail];
  if (groups.length !== 8) return undefined;

  const bytes = new Uint8Array(16);
  for (let index = 0; index < 8; index += 1) {
    const group = groups[index];
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return undefined;
    const parsed = parseInt(group, 16);
    bytes[index * 2] = (parsed >>> 8) & 0xff;
    bytes[index * 2 + 1] = parsed & 0xff;
  }
  return bytes;
}

function ipv6Matches(bytes: Uint8Array, prefix: string, bits: number): boolean {
  const prefixBytes = parseIpv6(prefix);
  if (!prefixBytes) return false;
  const fullBytes = Math.floor(bits / 8);
  for (let index = 0; index < fullBytes; index += 1) {
    if (bytes[index] !== prefixBytes[index]) return false;
  }
  const remainder = bits % 8;
  if (remainder > 0) {
    const mask = (0xff << (8 - remainder)) & 0xff;
    if ((bytes[fullBytes] & mask) !== (prefixBytes[fullBytes] & mask)) return false;
  }
  return true;
}

function ipv4FromBytes(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

function isAllZero(bytes: Uint8Array, length: number): boolean {
  for (let index = 0; index < length; index += 1) {
    if (bytes[index] !== 0) return false;
  }
  return true;
}

function isNonPublicIpv6(bytes: Uint8Array): boolean {
  if (isAllZero(bytes, 10) && bytes[10] === 0xff && bytes[11] === 0xff) {
    return isNonPublicIpv4(ipv4FromBytes(bytes, 12));
  }
  if (isAllZero(bytes, 8) && bytes[8] === 0xff && bytes[9] === 0xff) {
    return isNonPublicIpv4(ipv4FromBytes(bytes, 12));
  }
  if ((bytes[8] === 0x00 || bytes[8] === 0x02) && bytes[9] === 0x00 && bytes[10] === 0x5e && bytes[11] === 0xfe) {
    return isNonPublicIpv4(ipv4FromBytes(bytes, 12));
  }
  if (isAllZero(bytes, 12)) {
    return isNonPublicIpv4(ipv4FromBytes(bytes, 12));
  }
  if (ipv6Matches(bytes, '64:ff9b::', 96)) {
    return isNonPublicIpv4(ipv4FromBytes(bytes, 12));
  }
  if (bytes[0] === 0x20 && bytes[1] === 0x02) {
    return isNonPublicIpv4(ipv4FromBytes(bytes, 2));
  }
  if (!ipv6Matches(bytes, '2000::', 3)) {
    return true;
  }

  const blockedPrefixes: Array<[string, number]> = [
    ['2001::', 32],
    ['2001:2::', 48],
    ['2001:10::', 28],
    ['2001:20::', 28],
    ['2001:db8::', 32],
    ['3fff::', 20],
  ];
  for (const [prefix, bits] of blockedPrefixes) {
    if (ipv6Matches(bytes, prefix, bits)) return true;
  }
  return false;
}

export function isNonPublicIp(address: string): boolean {
  const normalized = address.trim().replace(/^\[|\]$/g, '');
  const ipv4 = ipv4ToInt(normalized);
  if (ipv4 !== undefined) return isNonPublicIpv4(ipv4);
  const ipv6 = parseIpv6(normalized);
  if (!ipv6) return true;
  return isNonPublicIpv6(ipv6);
}

export function createPinnedLookup(addresses: ResolvedAddress[]): NodeLookup {
  const primary = addresses[0];
  const hasNonPublicAddress = addresses.some((entry) => !entry.address || isNonPublicIp(entry.address));
  return (_hostname, options, callback) => {
    if (!primary || hasNonPublicAddress) {
      callback(new UrlBlockedError(primary ? 'non-public-address' : 'dns-resolution-empty'));
      return;
    }
    if (options?.all) {
      callback(null, addresses.map((entry) => ({ address: entry.address, family: entry.family })));
      return;
    }
    callback(null, primary.address, primary.family);
  };
}

function buildFetchHeaders(): Record<string, string> {
  return {
    'User-Agent': 'Inbox Curator',
    Accept: 'text/html,application/xhtml+xml,application/pdf',
  };
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function loadNodeModule<T>(name: string): T | undefined {
  try {
    const nodeRequire = typeof require === 'function' ? (require as (id: string) => unknown) : undefined;
    if (!nodeRequire) return undefined;
    return nodeRequire(name) as T;
  } catch {
    return undefined;
  }
}

function isDecodableEncoding(zlib: any, encoding: string): boolean {
  if (!zlib || !encoding) return false;
  if (encoding === 'gzip' || encoding === 'x-gzip' || encoding === 'deflate') return true;
  return encoding === 'br' && typeof zlib.createBrotliDecompress === 'function';
}

function createEncodingStream(zlib: any, encoding: string): any | undefined {
  if (!isDecodableEncoding(zlib, encoding)) return undefined;
  if (encoding === 'br') return zlib.createBrotliDecompress();
  return zlib.createUnzip();
}

export function readResponseBody(
  response: any,
  encoding: string,
  zlib: any,
  maxDecodedBytes: number = MAX_RESPONSE_BYTES,
  maxCompressedBytes: number = MAX_COMPRESSED_BYTES,
): Promise<string> {
  const sink = createEncodingStream(zlib, encoding);
  const source = sink ?? response;

  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let decodedBytes = 0;
    let compressedBytes = 0;
    let settled = false;

    const cleanup = () => {
      source.removeListener?.('data', onDecodedData);
      source.removeListener?.('end', onEnd);
      source.removeListener?.('error', fail);
      source.removeListener?.('close', onClose);
      response.removeListener?.('data', onCompressedData);
      response.removeListener?.('error', onResponseError);
    };

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      response.destroy?.();
      sink?.destroy?.();
      reject(error);
    };

    const onCompressedData = (chunk: Buffer | string) => {
      if (settled) return;
      compressedBytes += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk);
      if (compressedBytes > maxCompressedBytes) {
        fail(new Error('URL response exceeded the maximum compressed size.'));
      }
    };

    const onDecodedData = (chunk: Buffer | string) => {
      if (settled) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      decodedBytes += buffer.length;
      if (decodedBytes > maxDecodedBytes) {
        fail(new Error('URL response exceeded the maximum allowed size.'));
        return;
      }
      chunks.push(buffer);
    };

    const onEnd = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(Buffer.concat(chunks).toString('utf8'));
    };

    const onClose = () => {
      if (settled) return;
      fail(new Error('URL response stream closed before completion.'));
    };

    const onResponseError = (error: Error) => {
      sink?.destroy?.(error);
    };

    response.on('error', onResponseError);
    if (sink) response.on('data', onCompressedData);
    source.on('data', onDecodedData);
    source.on('end', onEnd);
    source.on('error', fail);
    source.on('close', onClose);
    if (sink) response.pipe(sink);
  });
}

export type NodeModuleLoader = <T>(name: string) => T | undefined;

function parseContentLength(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function createNodeHttpRequest(
  load: NodeModuleLoader,
  limits: ResponseLimits = DEFAULT_RESPONSE_LIMITS,
): (spec: HardenedRequestSpec) => Promise<HardenedHttpResponse> {
  return (spec: HardenedRequestSpec): Promise<HardenedHttpResponse> => {
    const http = load<any>('node:http') ?? load<any>('http');
    const https = load<any>('node:https') ?? load<any>('https');
    const zlib = load<any>('node:zlib') ?? load<any>('zlib');
    const parsed = new URL(spec.url);
    const isHttps = parsed.protocol === 'https:';
    const hostname = parsed.hostname.replace(/^\[|\]$/g, '');
    const transport = isHttps ? https : http;
    if (!transport || typeof transport.request !== 'function') {
      return Promise.reject(new UrlBlockedError('transport-unavailable'));
    }

    return new Promise<HardenedHttpResponse>((resolve, reject) => {
      const request = transport.request(
        {
          protocol: parsed.protocol,
          hostname,
          port: parsed.port || (isHttps ? 443 : 80),
          path: `${parsed.pathname}${parsed.search}`,
          method: spec.method,
          headers: spec.headers,
          lookup: spec.lookup,
          agent: false,
          ...(spec.timeoutMs ? { timeout: spec.timeoutMs } : {}),
        },
        (response: any) => {
          const status = Number(response.statusCode ?? 0);
          const rawHeaders = (response.headers ?? {}) as Record<string, string | string[] | undefined>;
          const headers: Record<string, string> = {};
          for (const [key, value] of Object.entries(rawHeaders)) {
            if (value === undefined) continue;
            headers[key.toLowerCase()] = Array.isArray(value) ? value.join(', ') : String(value);
          }

          const encoding = headers['content-encoding'] ?? '';
          const compressed = isDecodableEncoding(zlib, encoding);
          const declaredLength = parseContentLength(headers['content-length']);
          const declaredLimit = compressed ? limits.maxCompressedBytes : limits.maxDecodedBytes;
          if (declaredLength !== undefined && declaredLength > declaredLimit) {
            response.destroy?.();
            request.destroy?.();
            reject(new Error('URL response exceeded the maximum allowed size.'));
            return;
          }

          readResponseBody(response, encoding, zlib, limits.maxDecodedBytes, limits.maxCompressedBytes)
            .then((text) => resolve({ status, headers, text }))
            .catch((error: Error) => {
              response.destroy?.();
              request.destroy?.();
              reject(error);
            });
        },
      );

      request.on('timeout', () => request.destroy?.(new Error('URL request timed out.')));
      request.on('error', (error: Error) => reject(error));
      request.end();
    });
  };
}

const defaultHttpRequest = createNodeHttpRequest(loadNodeModule);

function createDefaultDependencies(): UrlExtractionDependencies {
  return {
    async resolveHost(hostname: string): Promise<ResolvedAddress[]> {
      const dns = loadNodeModule<any>('node:dns') ?? loadNodeModule<any>('dns');
      if (!dns?.promises?.lookup) throw new UrlBlockedError('dns-unavailable');
      const results = await dns.promises.lookup(hostname, { all: true, verbatim: true }) as Array<{ address: string; family: number }>;
      return Array.isArray(results) ? results.map((entry) => ({ address: entry.address, family: entry.family })) : [];
    },
    request: defaultHttpRequest,
  };
}

let urlExtractionDependencies: UrlExtractionDependencies | undefined;

export function setUrlExtractionDependencies(dependencies: UrlExtractionDependencies | undefined): void {
  urlExtractionDependencies = dependencies;
}

function getDependencies(): UrlExtractionDependencies {
  if (!urlExtractionDependencies) {
    urlExtractionDependencies = createDefaultDependencies();
  }
  return urlExtractionDependencies;
}

export async function hardenedFetchUrl(
  url: string,
  options: Pick<UrlExtractionOptions, 'timeoutMs'>,
  dependencies: UrlExtractionDependencies,
): Promise<HardenedHttpResponse> {
  let currentUrl = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    if (!isValidFetchUrl(currentUrl)) throw new UrlBlockedError('url-not-allowed');

    const hostname = new URL(currentUrl).hostname.toLowerCase().replace(/^\[|\]$/g, '');
    const addresses = await dependencies.resolveHost(hostname);
    if (!addresses || addresses.length === 0) throw new UrlBlockedError('dns-resolution-empty');
    for (const entry of addresses) {
      if (!entry.address || isNonPublicIp(entry.address)) throw new UrlBlockedError('non-public-address');
    }

    const response = await dependencies.request({
      url: currentUrl,
      method: 'GET',
      headers: buildFetchHeaders(),
      timeoutMs: options.timeoutMs,
      lookup: createPinnedLookup(addresses),
    });

    const location = response.headers.location;
    if (isRedirectStatus(response.status) && location) {
      let nextUrl: string;
      try {
        nextUrl = new URL(location, currentUrl).toString();
      } catch {
        throw new UrlBlockedError('redirect-not-allowed');
      }
      if (!isValidFetchUrl(nextUrl)) throw new UrlBlockedError('redirect-not-allowed');
      currentUrl = nextUrl;
      continue;
    }

    return response;
  }

  throw new UrlBlockedError('too-many-redirects');
}

export async function fetchUrlContext(url: string, notePath: string, options: UrlExtractionOptions): Promise<UrlExtractionResult> {
  if (!isValidFetchUrl(url)) {
    return {
      fetchStatus: 'failed',
      extractionUsed: false,
      extractionConfidence: 0,
      extractionWarnings: ['URL scheme or target is not allowed for security reasons.'],
      extractionMethod: 'blocked',
    };
  }

  const isPdfUrl = url.toLowerCase().split('?')[0].endsWith('.pdf');
  if (isPdfUrl) {
    return {
      fetchStatus: 'success',
      extractionUsed: false,
      extractionConfidence: 0,
      extractionWarnings: ['PDF files cannot be fully parsed in this environment. Only metadata was extracted.'],
      extractionMethod: 'PDF-fallback',
    };
  }

  try {
    let response: HardenedHttpResponse;
    try {
      response = await hardenedFetchUrl(url, { timeoutMs: options.timeoutMs }, getDependencies());
    } catch (error) {
      if (error instanceof UrlBlockedError) {
        console.warn('Inbox Curator URL fetch blocked', {
          notePath,
          reason: error.reason,
        });
        return {
          fetchStatus: 'failed',
          extractionUsed: false,
          extractionConfidence: 0,
          extractionWarnings: ['URL target was blocked by the security policy.'],
          extractionMethod: 'blocked',
        };
      }
      throw error;
    }

    if (response.status < 200 || response.status >= 300) {
      console.warn('Inbox Curator URL fetch failed', {
        notePath,
        status: response.status,
        error: `HTTP ${response.status}`,
      });
      return { fetchStatus: 'failed', extractionUsed: false };
    }

    const contentType = (response.headers['content-type'] ?? '').toLowerCase();
    if (contentType.includes('application/pdf')) {
      return {
        fetchStatus: 'success',
        extractionUsed: false,
        extractionConfidence: 0,
        extractionWarnings: ['PDF files cannot be fully parsed in this environment. Only metadata was extracted.'],
        extractionMethod: 'PDF-fallback',
      };
    }

    const metadata = options.fetchMetadata ? buildUrlMetadata(response.text) : undefined;
    const extraction = options.extractArticle
      ? extractReadableText(response.text, Math.max(1000, Math.round(options.maxExtractedCharacters)), url)
      : { confidence: 0, warnings: [] as string[], method: 'None' };

    const extractionWarnings = extraction.warnings ? [...extraction.warnings] : [];
    if (!options.extractArticle) {
      extractionWarnings.push('Article extraction was disabled by settings.');
    }

    return {
      fetchStatus: 'success',
      ...(metadata && Object.keys(metadata).length > 0 ? { metadata } : {}),
      ...(extraction.extractedText ? { extractedText: extraction.extractedText } : {}),
      ...(extraction.extractedTitle ? { extractedTitle: extraction.extractedTitle } : {}),
      extractionUsed: Boolean(extraction.extractedText),
      extractionConfidence: extraction.confidence,
      extractionWarnings,
      extractionMethod: extraction.method,
    };
  } catch (error) {
    console.warn('Inbox Curator URL fetch crashed', {
      notePath,
      error: error instanceof Error ? error.name : 'Unknown error',
    });
    return { fetchStatus: 'failed', extractionUsed: false };
  }
}
