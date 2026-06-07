import { App, TFile, normalizePath } from 'obsidian';
import * as yaml from 'js-yaml';
import { getApiKey } from './secrets';
import { maskBase64 } from './providerClient';
import { upsertReviewFrontmatter } from './frontmatter';
import { mapToReviewResult } from './reviewResultMapper';
import { writeReviewNote, type ReviewNoteWriteResult } from './reviewWriter';
import { classifyProviderFailure, postProviderChat } from './providerClient';
import type {
  ReviewContentType,
  ReviewFetchStatus,
  ReviewInputProfile,
  ReviewResult,
  ReviewSourceInfo,
} from './types';
import { fetchUrlContext, type UrlMetadata } from './urlExtraction';
import { extractAttachmentContext } from './attachmentContext';
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
  extractUrlArticleText: boolean;
  maxExtractedCharacters: number;
  readImages: boolean;
  readVideos: boolean;
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
  extractedTitle?: string;
  readImages: boolean;
  readVideos: boolean;
  attachments?: import('./types').ReviewAttachment[];
  attachmentSummary?: import('./types').ReviewAttachmentSummary;
  extractionConfidence?: number;
  extractionWarnings?: string[];
  extractionMethod?: string;
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
  status?: number;
  retryable?: boolean;
  stage?: 'request' | 'response_parse' | 'mapping' | 'write' | 'unknown';
}

export type ReviewPipelineResult = ReviewPipelineFailure | ReviewPipelineSuccess;

type ReviewRawResponse = Record<string, unknown>;

class ReviewPipelineError extends Error {
  status?: number;
  retryable?: boolean;
  stage: 'request' | 'response_parse' | 'mapping' | 'write' | 'unknown';

  constructor(message: string, options: { status?: number; retryable?: boolean; stage: 'request' | 'response_parse' | 'mapping' | 'write' | 'unknown' }) {
    super(message);
    this.name = 'ReviewPipelineError';
    this.status = options.status;
    this.retryable = options.retryable;
    this.stage = options.stage;
  }
}

interface ParsedDocument {
  frontmatter: Record<string, unknown>;
  body: string;
}

interface UrlOnlyDetectionResult {
  isUrlOnly: boolean;
  firstUrl?: string;
}

interface UrlContextResult {
  fetchStatus: ReviewFetchStatus;
  metadata?: UrlMetadata;
  extractedText?: string;
  extractedTitle?: string;
  extractionUsed: boolean;
  extractionConfidence?: number;
  extractionWarnings?: string[];
  extractionMethod?: string;
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

function buildUrlOnlyPromptContent(
  sourceUrl: string,
  body: string,
  fetchStatus: ReviewFetchStatus,
  metadata?: UrlMetadata,
  extractedText?: string,
  extractedTitle?: string,
): string {
  const lines = [
    'URL-only note detected.',
    extractedText ? 'Static HTML was fetched and article-like text was extracted.' : 'The note body does not contain the full article text.',
    `Extracted URL: ${sourceUrl}`,
    `Fetch status: ${fetchStatus}`,
  ];

  if (extractedTitle) {
    lines.push(`Extracted page title: ${extractedTitle}`);
  }

  lines.push('', 'Original note body:', body.trim() || '(empty)');

  if (metadata && Object.keys(metadata).length > 0) {
    lines.push('', 'Fetched URL metadata:');
    for (const [key, value] of Object.entries(metadata)) {
      lines.push(`- ${key}: ${value}`);
    }
  } else {
    lines.push('', 'Fetched URL metadata: unavailable');
  }

  if (extractedText) {
    lines.push('', 'Extracted article text:', extractedText);
  } else {
    lines.push('', 'Extracted article text: unavailable');
  }

  return lines.join('\n');
}

export async function buildReviewModelInputPayload(
  app: App,
  file: TFile,
  noteContent: string,
  source: ReviewSourceInfo,
  options: ReviewPipelineOptions,
): Promise<ReviewModelInputPayload> {
  const { body } = parseDocument(noteContent);
  const urlOnly = detectUrlOnlyBody(body);
  const sourceUrl = source.sourceUrl ?? urlOnly.firstUrl;
  const attachmentContext = extractAttachmentContext(app, file, noteContent);

  let contentType: ReviewContentType = urlOnly.isUrlOnly ? 'url_only' : 'plain_note';
  let inputProfile: ReviewInputProfile = urlOnly.isUrlOnly ? 'url_only' : 'plain_note';
  let fetchStatus: ReviewFetchStatus = 'not_applicable';
  let urlMetadata: UrlMetadata | undefined;
  let extractedTitle: string | undefined;
  let promptContent = noteContent;
  let previewSource = noteContent;

  let urlContext: UrlContextResult | undefined;

  if (urlOnly.isUrlOnly && sourceUrl) {
    const defaultUrlContext: UrlContextResult = {
      fetchStatus: 'not_applicable',
      extractionUsed: false,
    };

    if (options.fetchUrlMetadata || options.extractUrlArticleText) {
      const fetchedContext = await fetchUrlContext(sourceUrl, file.path, {
        fetchMetadata: options.fetchUrlMetadata,
        extractArticle: options.extractUrlArticleText,
        maxExtractedCharacters: options.maxExtractedCharacters,
      });
      urlContext = {
        fetchStatus: fetchedContext.fetchStatus,
        metadata: fetchedContext.metadata,
        extractedText: fetchedContext.extractedText,
        extractedTitle: fetchedContext.extractedTitle,
        extractionUsed: fetchedContext.extractionUsed,
        extractionConfidence: fetchedContext.extractionConfidence,
        extractionWarnings: fetchedContext.extractionWarnings,
        extractionMethod: fetchedContext.extractionMethod,
      };
    } else {
      urlContext = defaultUrlContext;
    }

    fetchStatus = urlContext.fetchStatus;
    urlMetadata = urlContext.metadata;
    extractedTitle = urlContext.extractedTitle;

    if (urlContext.extractionUsed && urlContext.extractedText) {
      contentType = 'fetched_url';
      inputProfile = 'web_article';
    }

    promptContent = buildUrlOnlyPromptContent(
      sourceUrl,
      body,
      fetchStatus,
      urlMetadata,
      urlContext.extractedText,
      extractedTitle,
    );
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
    readImages: options.readImages,
    readVideos: options.readVideos,
    ...(urlMetadata ? { urlMetadata } : {}),
    ...(extractedTitle ? { extractedTitle } : {}),
    ...(attachmentContext.attachments.length > 0 ? { attachments: attachmentContext.attachments } : {}),
    ...(attachmentContext.attachmentSummary ? { attachmentSummary: attachmentContext.attachmentSummary } : {}),
    ...(urlContext && typeof urlContext.extractionConfidence === 'number' ? { extractionConfidence: urlContext.extractionConfidence } : {}),
    ...(urlContext && Array.isArray(urlContext.extractionWarnings) ? { extractionWarnings: urlContext.extractionWarnings } : {}),
    ...(urlContext && typeof urlContext.extractionMethod === 'string' ? { extractionMethod: urlContext.extractionMethod } : {}),
  };
}

function buildAttachmentPromptSection(modelInput: ReviewModelInputPayload, options: ReviewPipelineOptions): string[] {
  const attachments = modelInput.attachments ?? [];
  const summary = modelInput.attachmentSummary;
  if (!summary || attachments.length === 0) {
    return [];
  }

  const lines = [
    'Attachment context:',
    `- total: ${summary.totalCount}`,
    `- images: ${summary.imageCount}`,
    `- videos: ${summary.videoCount}`,
    `- audio: ${summary.audioCount}`,
    `- pdfs: ${summary.pdfCount}`,
    `- documents: ${summary.documentCount}`,
    `- archives: ${summary.archiveCount}`,
    `- other: ${summary.otherCount}`,
    `- unresolved: ${summary.unresolvedCount}`,
    `- image reading enabled setting: ${options.readImages ? 'true' : 'false'}`,
    `- video reading enabled setting: ${options.readVideos ? 'true' : 'false'}`,
    '',
    'Treat attachments conservatively:',
    '- You were not given binary image/video/audio/PDF contents.',
    '- Do not claim to have seen or listened to attachment contents unless the note text itself describes them.',
    '- You may mention that attachments likely contain relevant context and propose verification or follow-up actions.',
    '',
    'Detected attachments:',
  ];

  for (const attachment of attachments.slice(0, 12)) {
    lines.push(
      `- ${attachment.displayName} | kind=${attachment.kind} | embedded=${attachment.embedded ? 'yes' : 'no'} | exists=${attachment.exists ? 'yes' : 'no'} | path=${attachment.path}`,
    );
  }

  if (attachments.length > 12) {
    lines.push(`- ... ${attachments.length - 12} more attachments omitted`);
  }

  return lines;
}

function buildMappingContext(source: ReviewSourceInfo, modelInput: ReviewModelInputPayload): {
  source: ReviewSourceInfo;
  contentType: ReviewContentType;
  inputProfile: ReviewInputProfile;
  fetchStatus: ReviewFetchStatus;
  domainProfile: string;
  provider: string;
  model: string;
  attachments?: import('./types').ReviewAttachment[];
  attachmentSummary?: import('./types').ReviewAttachmentSummary;
  extractionConfidence?: number;
  extractionWarnings?: string[];
  extractionMethod?: string;
} {
  return {
    source,
    contentType: modelInput.contentType,
    inputProfile: modelInput.inputProfile,
    fetchStatus: modelInput.fetchStatus,
    domainProfile: 'none',
    provider: modelInput.provider,
    model: modelInput.model,
    ...(modelInput.attachments ? { attachments: modelInput.attachments } : {}),
    ...(modelInput.attachmentSummary ? { attachmentSummary: modelInput.attachmentSummary } : {}),
    ...(typeof modelInput.extractionConfidence === 'number' ? { extractionConfidence: modelInput.extractionConfidence } : {}),
    ...(Array.isArray(modelInput.extractionWarnings) ? { extractionWarnings: modelInput.extractionWarnings } : {}),
    ...(typeof modelInput.extractionMethod === 'string' ? { extractionMethod: modelInput.extractionMethod } : {}),
  };
}

function buildReviewPrompt(modelInput: ReviewModelInputPayload): { system: string; user: string } {
  const shouldUseJapanese = looksJapanese(`${modelInput.noteTitle}\n${modelInput.noteContent}`);
  const responseLanguage = shouldUseJapanese ? '日本語' : 'the same language as the note';
  const sourceUrlLine = modelInput.sourceUrl ? `Source URL: ${modelInput.sourceUrl}` : 'Source URL: none';
  const attachmentGuidance = buildAttachmentPromptSection(modelInput, {
    outputFolder: '',
    provider: modelInput.provider,
    endpointUrl: modelInput.endpointUrl,
    model: modelInput.model,
    fetchUrlMetadata: false,
    extractUrlArticleText: false,
    maxExtractedCharacters: 0,
    readImages: modelInput.readImages,
    readVideos: modelInput.readVideos,
  });
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
      'actionItems is optional. Use it for concrete follow-up actions, especially when attachments likely need manual review.',
      'If attachments are present but their contents were not actually provided, explicitly avoid pretending they were analyzed.',
      'structuredSummary must organize the article for later reuse, not as a long narrative summary.',
      'structuredSummary.centralClaim must capture the main claim in one clear sentence.',
      'structuredSummary.keyPoints must list the reusable sub-points or claims from the note.',
      'structuredSummary.comparisonTable should be included only when the note actually contains a comparison structure worth preserving.',
      'structuredSummary.evidenceMentioned must only describe evidence, studies, or sources actually mentioned in the note. Do not invent support. If a formal citation is unclear, say so explicitly.',
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
      '  "structuredSummary": {',
      '    "centralClaim": string,',
      '    "keyPoints": [string],',
      '    "comparisonTable": {',
      '      "headers": [string],',
      '      "rows": [[string]]',
      '    },',
      '    "evidenceMentioned": [string]',
      '  },',
      '  "detailedSummary": string,',
      '  "credibilityReview": string,',
      '  "practicalityReview": string,',
      '  "retentionReasons": [string],',
      '  "evidenceBasis": [string],',
      '  "strengths": [string],',
      '  "risksOrGaps": [string],',
      '  "verificationNeeded": [string],',
      '  "nextActions": [string],',
      '  "actionItems": [{ "type": "note|task|verify|extract|review_attachment|follow_up", "title": string, "detail": string, "targetPath": string }],',
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
      ...(attachmentGuidance.length > 0 ? ['', ...attachmentGuidance] : []),
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

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

function getMimeType(extension: string): string {
  const ext = extension.toLowerCase().replace(/^\./, '');
  if (ext === 'png') return 'image/png';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  return 'application/octet-stream';
}

export async function loadAndConvertImages(
  app: App,
  attachments: import('./types').ReviewAttachment[],
): Promise<{ url: string }[]> {
  const images = attachments.filter(
    (a) =>
      a.kind === 'image' &&
      a.exists &&
      ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(a.extension.toLowerCase().replace(/^\./, '')),
  );

  const MAX_IMAGES = 3;
  const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
  const loaded: { url: string }[] = [];

  for (const img of images) {
    if (loaded.length >= MAX_IMAGES) {
      break;
    }

    const file = app.vault.getAbstractFileByPath(img.path);
    if (!(file instanceof TFile)) {
      continue;
    }

    if (file.stat.size > MAX_SIZE_BYTES) {
      continue;
    }

    try {
      const buffer = await app.vault.readBinary(file);
      const base64 = arrayBufferToBase64(buffer);
      const mime = getMimeType(img.extension);
      loaded.push({
        url: `data:${mime};base64,${base64}`,
      });
    } catch (err) {
      console.warn('Failed to load image attachment binary', { path: img.path, error: err });
    }
  }

  return loaded;
}

async function getReviewRawResponse(app: App, modelInput: ReviewModelInputPayload): Promise<ReviewRawResponse> {
  const apiKey = await getApiKey(app, modelInput.provider);
  if (!apiKey) {
    throw new ReviewPipelineError('API key is not saved in SecretStorage.', {
      retryable: false,
      stage: 'request',
    });
  }

  const prompt = buildReviewPrompt(modelInput);

  let userContent: import('./providerClient').ProviderChatMessageContent = prompt.user;
  if (modelInput.readImages && Array.isArray(modelInput.attachments)) {
    const images = await loadAndConvertImages(app, modelInput.attachments);
    if (images.length > 0) {
      userContent = [
        { type: 'text', text: prompt.user },
        ...images.map((img) => ({
          type: 'image_url' as const,
          image_url: { url: img.url },
        })),
      ];
    }
  }

  const promptMessages: import('./providerClient').ProviderChatMessage[] = [
    { role: 'system', content: prompt.system },
    { role: 'user', content: userContent },
  ];

  const response = await postProviderChat({
    provider: modelInput.provider,
    endpointUrl: modelInput.endpointUrl,
    model: modelInput.model,
    apiKey,
    messages: promptMessages,
    temperature: 0,
  });

  if (response.ok === false) {
    const retryHint = classifyProviderFailure(modelInput.provider, response);
    console.warn('Inbox Curator review request failed', maskBase64({
      provider: modelInput.provider,
      endpointUrl: modelInput.endpointUrl,
      model: modelInput.model,
      status: response.status,
      error: response.error,
      retryable: retryHint.retryable,
      responseSnippet: buildSafeSnippet(response.responseBody),
    }));
    throw new ReviewPipelineError(
      response.status ? `AI review request failed (${response.status}).` : `AI review request failed: ${response.error}`,
      {
        status: response.status,
        retryable: retryHint.retryable,
        stage: 'request',
      },
    );
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
    throw new ReviewPipelineError('AI review response was not valid JSON.', {
      retryable: false,
      stage: 'response_parse',
      status: response.status,
    });
  }

  return parsed;
}

export async function runReviewPipeline(app: App, file: TFile, options: ReviewPipelineOptions): Promise<ReviewPipelineResult> {
  const outputFolder = options.outputFolder.trim() || 'AI Reviews';
  const noteContent = await app.vault.read(file);
  const source = buildReviewSourceInfo(file, outputFolder, noteContent);
  const modelInput = await buildReviewModelInputPayload(app, file, noteContent, source, options);

  try {
    const rawReview = await getReviewRawResponse(app, modelInput);
    const mapping = mapToReviewResult(rawReview, buildMappingContext(source, modelInput));

    if (mapping.ok === false) {
      return { ok: false, error: mapping.error, retryable: false, stage: 'mapping' };
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
    if (error instanceof ReviewPipelineError) {
      return {
        ok: false,
        error: error.message,
        status: error.status,
        retryable: error.retryable,
        stage: error.stage,
      };
    }

    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown review pipeline error.',
      retryable: false,
      stage: 'unknown',
    };
  }
}
