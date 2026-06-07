import { App, TFile, normalizePath } from 'obsidian';
import * as yaml from 'js-yaml';
import { buildDummyReviewRawResponse } from './dummyReview';
import { upsertReviewFrontmatter } from './frontmatter';
import { mapToReviewResult } from './reviewResultMapper';
import { writeReviewNote, type ReviewNoteWriteResult } from './reviewWriter';
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

function buildDummyMappingContext(source: ReviewSourceInfo, modelInput: ReviewModelInputPayload): {
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

export async function runReviewPipeline(app: App, file: TFile, options: ReviewPipelineOptions): Promise<ReviewPipelineResult> {
  const outputFolder = options.outputFolder.trim() || 'AI Reviews';
  const noteContent = await app.vault.read(file);
  const source = buildReviewSourceInfo(file, outputFolder, noteContent);
  const modelInput = buildReviewModelInputPayload(file, noteContent, source, options);
  const rawReview = buildDummyReviewRawResponse(modelInput);
  const mapping = mapToReviewResult(rawReview, buildDummyMappingContext(source, modelInput));

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
}
