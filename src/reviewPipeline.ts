import { App, TFile, normalizePath, requestUrl } from 'obsidian';
import * as yaml from 'js-yaml';
import { getApiKey } from './secrets';
import { upsertReviewFrontmatter } from './frontmatter';
import { mapToReviewResult } from './reviewResultMapper';
import { writeReviewNote, type ReviewNoteWriteResult } from './reviewWriter';
import { postOpenAiCompatibleChat } from './openAiCompatible';
import type {
  ReviewContentType,
  ReviewFetchStatus,
  ReviewInputProfile,
  ReviewResult,
  ReviewSourceInfo,
} from './types';
import type { InboxCuratorProvider } from './settings';

const FRONTMATTER_REGEX = /^---\n([\s\S]*?)\n---\n?/;
const SOURCE_URL_KEYS = ['source_url', 'sourceUrl', 'url'] as const;
const URL_REGEX = /https?:\/\/[^\s<>()\]]+/gi;

export interface ReviewPipelineOptions {
  outputFolder: string;
  provider: InboxCuratorProvider;
  endpointUrl: string;
  model: string;
  fetchUrlMetadata: boolean;
}

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

export interface ReviewModelInputPayload {
  noteTitle: string;
  notePath: string;
  sourceUrl?: string;
  contentType: ReviewContentType;
  inputProfile: ReviewInputProfile;
  provider: InboxCuratorProvider;
  endpointUrl: string;
  model: string;
  noteContent: string;
  noteCharacterCount: number;
  notePreview: string;
  fetchStatus: ReviewFetchStatus;
  urlMetadata?: UrlMetadata;
}

export interface ReviewPipelineSuccess {
  ok: true;
  reviewResult: ReviewResult;
  writeResult: ReviewNoteWriteResult;
  modelInput: ReviewModelInputPayload;
}

export interface ReviewPipelineFailure {
  ok: false;
  error: string;
}

export type ReviewPipelineResult = ReviewPipelineFailure | ReviewPipelineSuccess;

type ReviewRawResponse = Record<string, unknown>;

interface ParsedDocument {
  frontmatter: Record<string, unknown>;
  body: string;
}

interface UrlOnlyDetectionResult {
  isUrlOnly: boolean;
  firstUrl?: string;
}

interface UrlMetadataFetchResult {
  fetchStatus: ReviewFetchStatus;
  metadata?: UrlMetadata;
}

function parseDocument(content: string): ParsedDocument {
  const match = content.match(FRONTMATTER_REGEX);
  if (!match) {
    return { frontmatter: {}, body: content };
  }

  const parsed = yaml.load(match[1]);
  const frontmatter = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? { ...(parsed as Record<string, unknown>) } : {};
  const body = content.slice(match[0].length);
  return { frontmatter, body };
}

function extractSourceUrl(frontmatter: Record<string, unknown>): string | undefined {
  for (const key of SOURCE_URL_KEYS) {
    const value = frontmatter[key];
    if (typeof value === 'string' && value.trim() !== '') {
      return value.trim();
    }
  }

  return undefined;
}

function stripHeadingOnlyLines(body: string): string {
  return body
    .split(/\r?\n/)
    .filter((line) => !/^\s*#{1,6}\s+.*$/.test(line))
    .join('\n');
}

function detectUrlOnlyBody(body: string): UrlOnlyDetectionResult {
  const withoutHeadings = stripHeadingOnlyLines(body).trim();
  const urls = withoutHeadings.match(URL_REGEX) ?? [];
  if (urls.length === 0) {
    return { isUrlOnly: false };
  }

  const remaining = withoutHeadings.replace(URL_REGEX, '').replace(/\s+/g, '');
  if (remaining !== '') {
    return { isUrlOnly: false };
  }

  return {
    isUrlOnly: true,
    firstUrl: urls[0],
  };
}

function buildOutputPath(file: TFile, outputFolder: string): string {
  return normalizePath(`${outputFolder}/${file.basename}.ai-review.md`);
}

function hashString(value: string): string {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(16).padStart(8, '0');
}

function buildHashSourceContent(noteContent: string): string {
  const match = noteContent.match(FRONTMATTER_REGEX);
  if (!match) {
    return noteContent;
  }

  const parsed = yaml.load(match[1]);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return noteContent;
  }

  const frontmatter = { ...(parsed as Record<string, unknown>) };
  for (const key of Object.keys(frontmatter)) {
    if (key.startsWith('ai_review_')) {
      delete frontmatter[key];
    }
  }

  const cleanedFrontmatter = yaml.dump(frontmatter, {
    lineWidth: -1,
    noRefs: true,
    quotingType: '"',
  }).trimEnd();
  const body = noteContent.slice(match[0].length);

  return cleanedFrontmatter ? `---\n${cleanedFrontmatter}\n---\n${body}` : body;
}

function buildSourceHash(file: TFile, noteContent: string): string {
  return hashString(
    JSON.stringify({
      notePath: file.path,
      mtime: file.stat.mtime,
      size: file.stat.size,
      noteContent: buildHashSourceContent(noteContent),
    }),
  );
}

export function buildReviewSourceInfo(file: TFile, outputFolder: string, noteContent: string): ReviewSourceInfo {
  const { frontmatter, body } = parseDocument(noteContent);
  const extractedUrl = detectUrlOnlyBody(body).firstUrl;
  const sourceUrl = extractSourceUrl(frontmatter) ?? extractedUrl;

  return {
    noteTitle: file.basename,
    notePath: file.path,
    outputPath: buildOutputPath(file, outputFolder),
    generatedAt: new Date().toISOString(),
    sourceHash: buildSourceHash(file, noteContent),
    ...(sourceUrl ? { sourceUrl } : {}),
  };
}

function buildNotePreview(noteContent: string, maxLength = 280): string {
  const normalized = noteContent.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength)}…`;
}

function looksJapanese(text: string): boolean {
  const matches = text.match(/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/g);
  return Boolean(matches && matches.length >= 8);
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

function extractTitleTag(html: string): string | undefined {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match?.[1] ? decodeHtmlEntities(match[1].replace(/\s+/g, ' ')) : undefined;
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

async function fetchUrlMetadata(url: string, notePath: string): Promise<UrlMetadataFetchResult> {
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
      console.warn('Inbox Curator URL metadata fetch failed', {
        notePath,
        status: response.status,
        error: `HTTP ${response.status}`,
        responseSnippet: buildSafeSnippet(response.text),
      });
      return { fetchStatus: 'failed' };
    }

    const metadata = buildUrlMetadata(response.text);
    return {
      fetchStatus: 'success',
      ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
    };
  } catch (error) {
    console.warn('Inbox Curator URL metadata fetch crashed', {
      notePath,
      error: error instanceof Error ? buildSafeSnippet(error.message) : 'Unknown error',
    });
    return { fetchStatus: 'failed' };
  }
}

function buildUrlOnlyPromptContent(sourceUrl: string, body: string, fetchStatus: ReviewFetchStatus, metadata?: UrlMetadata): string {
  const lines = [
    'URL-only note detected.',
    'The note body does not contain the full article text.',
    `Extracted URL: ${sourceUrl}`,
    `Metadata fetch status: ${fetchStatus}`,
    '',
    'Original note body:',
    body.trim() || '(empty)',
  ];

  if (metadata && Object.keys(metadata).length > 0) {
    lines.push('', 'Fetched URL metadata:');
    for (const [key, value] of Object.entries(metadata)) {
      lines.push(`- ${key}: ${value}`);
    }
  } else {
    lines.push('', 'Fetched URL metadata: unavailable');
  }

  return lines.join('\n');
}

export async function buildReviewModelInputPayload(
  file: TFile,
  noteContent: string,
  source: ReviewSourceInfo,
  options: ReviewPipelineOptions,
): Promise<ReviewModelInputPayload> {
  const { body } = parseDocument(noteContent);
  const urlOnly = detectUrlOnlyBody(body);
  const contentType: ReviewContentType = urlOnly.isUrlOnly ? 'url_only' : 'plain_note';
  const inputProfile: ReviewInputProfile = urlOnly.isUrlOnly ? 'url_only' : 'plain_note';
  const sourceUrl = source.sourceUrl ?? urlOnly.firstUrl;

  let fetchStatus: ReviewFetchStatus = 'not_applicable';
  let urlMetadata: UrlMetadata | undefined;
  let promptContent = noteContent;
  let previewSource = noteContent;

  if (urlOnly.isUrlOnly && sourceUrl) {
    if (options.fetchUrlMetadata) {
      const metadataResult = await fetchUrlMetadata(sourceUrl, file.path);
      fetchStatus = metadataResult.fetchStatus;
      urlMetadata = metadataResult.metadata;
    }

    promptContent = buildUrlOnlyPromptContent(sourceUrl, body, fetchStatus, urlMetadata);
    previewSource = promptContent;
  }

  return {
    noteTitle: file.basename,
    notePath: file.path,
    ...(sourceUrl ? { sourceUrl } : {}),
    contentType,
    inputProfile,
    provider: options.provider,
    endpointUrl: options.endpointUrl.trim() || 'https://api.openai.com/v1',
    model: options.model.trim() || 'gpt-4o-mini',
    noteContent: promptContent,
    noteCharacterCount: promptContent.length,
    notePreview: buildNotePreview(previewSource),
    fetchStatus,
    ...(urlMetadata ? { urlMetadata } : {}),
  };
}

function buildMappingContext(source: ReviewSourceInfo, modelInput: ReviewModelInputPayload): {
  source: ReviewSourceInfo;
  contentType: ReviewContentType;
  inputProfile: ReviewInputProfile;
  fetchStatus: ReviewFetchStatus;
  domainProfile: string;
  provider: string;
  model: string;
} {
  return {
    source,
    contentType: modelInput.contentType,
    inputProfile: modelInput.inputProfile,
    fetchStatus: modelInput.fetchStatus,
    domainProfile: 'none',
    provider: modelInput.provider,
    model: modelInput.model,
  };
}

function buildReviewPrompt(modelInput: ReviewModelInputPayload): { system: string; user: string } {
  const shouldUseJapanese = looksJapanese(`${modelInput.noteTitle}\n${modelInput.noteContent}`);
  const responseLanguage = shouldUseJapanese ? '日本語' : 'the same language as the note';
  const sourceUrlLine = modelInput.sourceUrl ? `Source URL: ${modelInput.sourceUrl}` : 'Source URL: none';
  const urlOnlyGuidance =
    modelInput.contentType === 'url_only'
      ? [
          'This is a URL-only note.',
          'Do not assume the full article body was read or extracted.',
          'If metadata is sparse or missing, keep the judgment provisional and reliability conservative.',
        ]
      : [];

  return {
    system: [
      'You review a single Obsidian note and must return exactly one JSON object.',
      'Do not use markdown fences or commentary.',
      `Write all natural-language fields in ${responseLanguage}.`,
      'Assess reading value, saving value, reliability, practicality, risks or missing context, and next actions.',
      'decisionReason must explain why the recommended handling is appropriate in 1-3 sentences. It is not a summary.',
      'summary is a quickSummary field in practice: return at most 3 concise bullet-style items.',
      'retentionReasons must describe why the note is worth keeping, not just generic strengths. Return at most 4 items.',
      'nextActions must be concrete and limited to at most 4 items.',
      'evidenceBasis must classify the reliability basis using one or more of: official_documentation, primary_source, first_hand_experience, cited_secondary_source, uncited_secondary_source, ai_generated, social_claim, unclear.',
      'deleteCandidate must be a suggestion only, not an instruction.',
      'suggestedFolder must be a category-style suggestion, not the note title or a folder that simply repeats the note name.',
      'Do not overfit suggestedFolder to an assumed vault structure. Prefer broad category suggestions such as References/Companies, Clippings/Web Production, or Research/Competitors.',
      ...urlOnlyGuidance,
      'Return only JSON with this schema:',
      '{',
      '  "verdict": {',
      '    "readingValueLabel": "high|medium|low",',
      '    "savingValueLabel": "high|medium|low",',
      '    "reliabilityLabel": "high|medium|low|needs_verification|not_reviewed",',
      '    "recommendedAction": "read_later|keep_as_reference|turn_into_note|turn_into_task|needs_verification|research_more|archive|delete_candidate|ignore",',
      '    "priority": "high|medium|low"',
      '  },',
      '  "scores": {',
      '    "readingValue": 0-100 integer,',
      '    "savingValue": 0-100 integer,',
      '    "reliability": 0-100 integer,',
      '    "practicality": 0-100 integer',
      '  },',
      '  "decisionReason": string,',
      '  "summary": [string],',
      '  "detailedSummary": string,',
      '  "credibilityReview": string,',
      '  "practicalityReview": string,',
      '  "retentionReasons": [string],',
      '  "evidenceBasis": [string],',
      '  "strengths": [string],',
      '  "risksOrGaps": [string],',
      '  "verificationNeeded": [string],',
      '  "nextActions": [string],',
      '  "suggestedTags": [string],',
      '  "suggestedFolder": string,',
      '  "flags": {',
      '    "needsVerification": boolean,',
      '    "deleteCandidate": boolean',
      '  }',
      '}',
    ].join('\n'),
    user: [
      `Note title: ${modelInput.noteTitle}`,
      `Note path: ${modelInput.notePath}`,
      sourceUrlLine,
      `Content type: ${modelInput.contentType}`,
      `Input profile: ${modelInput.inputProfile}`,
      `Fetch status: ${modelInput.fetchStatus}`,
      'Evaluate the following note content and return JSON only.',
      '',
      modelInput.noteContent,
    ].join('\n'),
  };
}

function tryParseJsonObject(text: string): ReviewRawResponse | null {
  const trimmed = text.trim();
  const candidates = [trimmed];

  if (trimmed.startsWith('```')) {
    const withoutFences = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    candidates.push(withoutFences);
  }

  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as ReviewRawResponse;
      }
    } catch {
      // Continue to the next candidate.
    }
  }

  return null;
}

async function getReviewRawResponse(app: App, modelInput: ReviewModelInputPayload): Promise<ReviewRawResponse> {
  const apiKey = await getApiKey(app);
  if (!apiKey) {
    throw new Error('API key is not saved in SecretStorage.');
  }

  if (modelInput.provider !== 'openai-compatible') {
    throw new Error(`Unsupported provider: ${modelInput.provider}`);
  }

  const prompt = buildReviewPrompt(modelInput);
  const response = await postOpenAiCompatibleChat({
    endpointUrl: modelInput.endpointUrl,
    model: modelInput.model,
    apiKey,
    messages: [
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user },
    ],
    temperature: 0,
  });

  if (response.ok === false) {
    console.warn('Inbox Curator review request failed', {
      provider: modelInput.provider,
      endpointUrl: modelInput.endpointUrl,
      model: modelInput.model,
      status: response.status,
      error: response.error,
      responseSnippet: buildSafeSnippet(response.responseBody),
    });
    throw new Error(response.status ? `AI review request failed (${response.status}).` : `AI review request failed: ${response.error}`);
  }

  const parsed = tryParseJsonObject(response.content);
  if (!parsed) {
    console.warn('Inbox Curator review response JSON parse failed', {
      provider: modelInput.provider,
      endpointUrl: modelInput.endpointUrl,
      model: modelInput.model,
      status: response.status,
      contentLength: response.content.length,
    });
    throw new Error('AI review response was not valid JSON.');
  }

  return parsed;
}

export async function runReviewPipeline(app: App, file: TFile, options: ReviewPipelineOptions): Promise<ReviewPipelineResult> {
  const outputFolder = options.outputFolder.trim() || 'AI Reviews';
  const noteContent = await app.vault.read(file);
  const source = buildReviewSourceInfo(file, outputFolder, noteContent);
  const modelInput = await buildReviewModelInputPayload(file, noteContent, source, options);

  try {
    const rawReview = await getReviewRawResponse(app, modelInput);
    const mapping = mapToReviewResult(rawReview, buildMappingContext(source, modelInput));

    if (mapping.ok === false) {
      return { ok: false, error: mapping.error };
    }

    const writeResult = await writeReviewNote(app, file, mapping.result);
    await upsertReviewFrontmatter(app, file, mapping.result);

    return {
      ok: true,
      reviewResult: mapping.result,
      writeResult,
      modelInput,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown review pipeline error.',
    };
  }
}
