import { App, TFile, normalizePath } from 'obsidian';
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

export interface ReviewPipelineOptions {
  outputFolder: string;
  provider: InboxCuratorProvider;
  endpointUrl: string;
  model: string;
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

function parseFrontmatter(content: string): Record<string, unknown> {
  const match = content.match(FRONTMATTER_REGEX);
  if (!match) {
    return {};
  }

  const parsed = yaml.load(match[1]);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? { ...(parsed as Record<string, unknown>) } : {};
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

function buildSourceHash(file: TFile, noteContent: string): string {
  return hashString(
    JSON.stringify({
      notePath: file.path,
      mtime: file.stat.mtime,
      size: file.stat.size,
      noteContent,
    }),
  );
}

function buildReviewSourceInfo(file: TFile, outputFolder: string, noteContent: string): ReviewSourceInfo {
  const frontmatter = parseFrontmatter(noteContent);
  const sourceUrl = extractSourceUrl(frontmatter);

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

export function buildReviewModelInputPayload(
  file: TFile,
  noteContent: string,
  source: ReviewSourceInfo,
  options: ReviewPipelineOptions,
): ReviewModelInputPayload {
  return {
    noteTitle: file.basename,
    notePath: file.path,
    ...(source.sourceUrl ? { sourceUrl: source.sourceUrl } : {}),
    contentType: 'plain_note',
    inputProfile: 'plain_note',
    provider: options.provider,
    endpointUrl: options.endpointUrl.trim() || 'https://api.openai.com/v1',
    model: options.model.trim() || 'gpt-4o-mini',
    noteContent,
    noteCharacterCount: noteContent.length,
    notePreview: buildNotePreview(noteContent),
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
    fetchStatus: 'not_applicable',
    domainProfile: 'none',
    provider: modelInput.provider,
    model: modelInput.model,
  };
}

function buildReviewPrompt(modelInput: ReviewModelInputPayload): { system: string; user: string } {
  const shouldUseJapanese = looksJapanese(`${modelInput.noteTitle}\n${modelInput.noteContent}`);
  const responseLanguage = shouldUseJapanese ? '日本語' : 'the same language as the note';
  const sourceUrlLine = modelInput.sourceUrl ? `Source URL: ${modelInput.sourceUrl}` : 'Source URL: none';

  return {
    system: [
      'You review a single Obsidian note and must return exactly one JSON object.',
      'Do not use markdown fences or commentary.',
      `Write all natural-language fields in ${responseLanguage}.`,
      'Assess reading value, saving value, reliability, practicality, risks or missing context, and next actions.',
      'deleteCandidate must be a suggestion only, not an instruction.',
      'suggestedFolder must be a suggestion only.',
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
      '  "summary": [string],',
      '  "detailedSummary": string,',
      '  "credibilityReview": string,',
      '  "practicalityReview": string,',
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
      responseBody: response.responseBody,
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
  const modelInput = buildReviewModelInputPayload(file, noteContent, source, options);

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
