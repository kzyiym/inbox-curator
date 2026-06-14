import { requestUrl } from 'obsidian';
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
    const response = await requestUrl({
      url,
      method: 'GET',
      throw: false,
      headers: {
        'User-Agent': 'Inbox Curator',
        Accept: 'text/html,application/xhtml+xml,application/pdf',
      },
      timeout: options.timeoutMs,
    });

    if (response.status < 200 || response.status >= 300) {
      console.warn('Inbox Curator URL fetch failed', {
        notePath,
        status: response.status,
        error: `HTTP ${response.status}`,
      });
      return { fetchStatus: 'failed', extractionUsed: false };
    }

    const contentType = (response.headers?.['content-type'] ?? '').toLowerCase();
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
