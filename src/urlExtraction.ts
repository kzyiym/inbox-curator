import { requestUrl } from 'obsidian';

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
}

export interface UrlExtractionResult {
  fetchStatus: 'success' | 'failed';
  metadata?: UrlMetadata;
  extractedText?: string;
  extractedTitle?: string;
  extractionUsed: boolean;
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

function buildSafeSnippet(value: string | undefined, maxLength = 160): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return undefined;
  }

  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength)}…`;
}

function removeNonContentElements(root: ParentNode): void {
  const selectors = ['script', 'style', 'noscript', 'svg', 'canvas', 'iframe', 'nav', 'footer', 'header', 'aside', 'form'];
  for (const selector of selectors) {
    for (const node of Array.from(root.querySelectorAll(selector))) {
      node.remove();
    }
  }
}

function scoreCandidate(element: Element): number {
  const tagScoreMap: Record<string, number> = {
    article: 120,
    main: 100,
    section: 30,
    div: 10,
  };

  const className = (element.getAttribute('class') ?? '').toLowerCase();
  const id = (element.getAttribute('id') ?? '').toLowerCase();
  const hintText = `${className} ${id}`;

  let score = tagScoreMap[element.tagName.toLowerCase()] ?? 0;
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

  return score;
}

function normalizeExtractedText(text: string, maxCharacters: number): string | undefined {
  const normalized = text
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

function extractReadableText(html: string, maxCharacters: number): { extractedText?: string; extractedTitle?: string } {
  const parser = new DOMParser();
  const document = parser.parseFromString(html, 'text/html');
  const title = document.title?.trim() || undefined;

  removeNonContentElements(document);

  const candidates = Array.from(document.querySelectorAll('article, main, section, div, body'));
  let bestCandidate: Element | null = null;
  let bestScore = -Infinity;

  for (const candidate of candidates) {
    const score = scoreCandidate(candidate);
    if (score > bestScore) {
      bestScore = score;
      bestCandidate = candidate;
    }
  }

  const rawText = bestCandidate?.textContent ?? document.body?.textContent ?? '';
  const extractedText = normalizeExtractedText(rawText, maxCharacters);
  if (!extractedText || extractedText.length < 200) {
    return { extractedTitle: title };
  }

  return {
    extractedText,
    extractedTitle: title,
  };
}

export async function fetchUrlContext(url: string, notePath: string, options: UrlExtractionOptions): Promise<UrlExtractionResult> {
  try {
    const response = await requestUrl({
      url,
      method: 'GET',
      throw: false,
      headers: {
        'User-Agent': 'Inbox Curator',
        Accept: 'text/html,application/xhtml+xml',
      },
    });

    if (response.status < 200 || response.status >= 300) {
      console.warn('Inbox Curator URL fetch failed', {
        notePath,
        status: response.status,
        error: `HTTP ${response.status}`,
        responseSnippet: buildSafeSnippet(response.text),
      });
      return { fetchStatus: 'failed', extractionUsed: false };
    }

    const metadata = options.fetchMetadata ? buildUrlMetadata(response.text) : undefined;
    const extraction = options.extractArticle ? extractReadableText(response.text, Math.max(1000, Math.round(options.maxExtractedCharacters))) : {};

    return {
      fetchStatus: 'success',
      ...(metadata && Object.keys(metadata).length > 0 ? { metadata } : {}),
      ...(extraction.extractedText ? { extractedText: extraction.extractedText } : {}),
      ...(extraction.extractedTitle ? { extractedTitle: extraction.extractedTitle } : {}),
      extractionUsed: Boolean(extraction.extractedText),
    };
  } catch (error) {
    console.warn('Inbox Curator URL fetch crashed', {
      notePath,
      error: error instanceof Error ? buildSafeSnippet(error.message) : 'Unknown error',
    });
    return { fetchStatus: 'failed', extractionUsed: false };
  }
}
