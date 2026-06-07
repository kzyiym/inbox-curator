import type {
  RecommendedAction,
  ReviewActionItem,
  ReviewAttachment,
  ReviewAttachmentSummary,
  ReviewContentType,
  ReviewFetchStatus,
  ReviewInputProfile,
  ReviewPriority,
  ReviewReliabilityLabel,
  ReviewResult,
  ReviewSourceInfo,
  ReviewValueLabel,
  StructuredSummary,
} from './types';
import { validateReviewResult } from './reviewResultValidator';

const REVIEW_CONTENT_TYPES: readonly ReviewContentType[] = ['plain_note', 'url_only', 'fetched_url', 'ai_answer_log'];
const REVIEW_INPUT_PROFILES: readonly ReviewInputProfile[] = [
  'plain_note',
  'url_only',
  'web_article',
  'technical_article',
  'github',
  'documentation',
  'video_page',
  'social_post',
  'ai_answer_log',
  'unknown',
];
const REVIEW_FETCH_STATUSES: readonly ReviewFetchStatus[] = ['not_applicable', 'success', 'failed'];
const REVIEW_VALUE_LABELS: readonly ReviewValueLabel[] = ['high', 'medium', 'low'];
const REVIEW_RELIABILITY_LABELS: readonly ReviewReliabilityLabel[] = [
  'high',
  'medium',
  'low',
  'needs_verification',
  'not_reviewed',
];
const REVIEW_PRIORITIES: readonly ReviewPriority[] = ['high', 'medium', 'low'];
const RECOMMENDED_ACTIONS: readonly RecommendedAction[] = [
  'read_later',
  'keep_as_reference',
  'turn_into_note',
  'turn_into_task',
  'needs_verification',
  'research_more',
  'archive',
  'delete_candidate',
  'ignore',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function pickString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback;
}

function pickOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function pickBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function clampScore(value: unknown, fallback: number): number {
  const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.max(0, Math.min(100, Math.round(numeric)));
}

function pickEnumValue<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && allowed.includes(value as T) ? (value as T) : fallback;
}

function normalizeStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean);
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }

  return [];
}

function normalizeStringMatrix(value: unknown): string[][] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((row): row is unknown[] => Array.isArray(row))
    .map((row) => row.filter((cell): cell is string => typeof cell === 'string').map((cell) => cell.trim()).filter(Boolean))
    .filter((row) => row.length > 0);
}

function normalizeActionItems(value: unknown): ReviewActionItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null && !Array.isArray(item))
    .map((item) => ({
      type: typeof item.type === 'string' && item.type.trim() !== '' ? (item.type.trim() as ReviewActionItem['type']) : 'follow_up',
      title: typeof item.title === 'string' ? item.title.trim() : '',
      ...(typeof item.detail === 'string' && item.detail.trim() !== '' ? { detail: item.detail.trim() } : {}),
      ...(typeof item.targetPath === 'string' && item.targetPath.trim() !== '' ? { targetPath: item.targetPath.trim() } : {}),
    }))
    .filter((item) => item.title !== '');
}

function normalizeStructuredSummary(value: unknown): StructuredSummary | undefined {
  const summary = asRecord(value);
  const centralClaim = pickOptionalString(summary.centralClaim);
  const keyPoints = normalizeStringArray(summary.keyPoints);
  const evidenceMentioned = normalizeStringArray(summary.evidenceMentioned);
  const comparisonTableRecord = asRecord(summary.comparisonTable);
  const headers = normalizeStringArray(comparisonTableRecord.headers);
  const rows = normalizeStringMatrix(comparisonTableRecord.rows).filter((row) => row.length === headers.length);

  const comparisonTable = headers.length > 0 && rows.length > 0 ? { headers, rows } : undefined;
  if (!centralClaim && keyPoints.length === 0 && evidenceMentioned.length === 0 && !comparisonTable) {
    return undefined;
  }

  return {
    centralClaim: centralClaim ?? '',
    keyPoints,
    ...(comparisonTable ? { comparisonTable } : {}),
    evidenceMentioned,
  };
}

export interface ReviewResultMappingError {
  ok: false;
  error: string;
}

export interface ReviewResultMappingSuccess {
  ok: true;
  result: ReviewResult;
}

export type ReviewResultMappingResult = ReviewResultMappingError | ReviewResultMappingSuccess;

export interface ReviewResultMappingContext {
  source: ReviewSourceInfo;
  contentType?: ReviewContentType;
  inputProfile?: ReviewInputProfile;
  fetchStatus?: ReviewFetchStatus;
  domainProfile?: string;
  provider?: string;
  model?: string;
  attachments?: ReviewAttachment[];
  attachmentSummary?: ReviewAttachmentSummary;
  extractionConfidence?: number;
  extractionWarnings?: string[];
  extractionMethod?: string;
}

export function mapToReviewResult(raw: unknown, context: ReviewResultMappingContext): ReviewResultMappingResult {
  if (!isRecord(raw)) {
    return { ok: false, error: 'AI response must be a JSON object.' };
  }

  const source = context.source;
  if (!source.noteTitle || !source.notePath || !source.outputPath || !source.generatedAt || !source.sourceHash) {
    return { ok: false, error: 'Review mapping context is missing required source fields.' };
  }

  const verdict = asRecord(raw.verdict);
  const scores = asRecord(raw.scores);
  const flags = asRecord(raw.flags);

  const candidate: ReviewResult = {
    source: {
      noteTitle: pickString(raw.noteTitle, source.noteTitle),
      notePath: pickString(raw.notePath, source.notePath),
      outputPath: pickString(raw.outputPath, source.outputPath),
      generatedAt: pickString(raw.generatedAt, source.generatedAt),
      sourceHash: pickString(raw.sourceHash, source.sourceHash),
      sourceUrl: pickOptionalString(raw.sourceUrl) ?? source.sourceUrl,
    },
    contentType: pickEnumValue(raw.contentType, REVIEW_CONTENT_TYPES, context.contentType ?? 'plain_note'),
    inputProfile: pickEnumValue(raw.inputProfile, REVIEW_INPUT_PROFILES, context.inputProfile ?? 'unknown'),
    fetchStatus: pickEnumValue(raw.fetchStatus, REVIEW_FETCH_STATUSES, context.fetchStatus ?? 'not_applicable'),
    domainProfile: pickString(raw.domainProfile, context.domainProfile ?? 'none'),
    provider: pickString(raw.provider, context.provider ?? 'unknown'),
    model: pickString(raw.model, context.model ?? 'unknown'),
    ...(Array.isArray(context.attachments) && context.attachments.length > 0 ? { attachments: context.attachments } : {}),
    ...(context.attachmentSummary ? { attachmentSummary: context.attachmentSummary } : {}),
    verdict: {
      readingValueLabel: pickEnumValue(verdict.readingValueLabel, REVIEW_VALUE_LABELS, 'medium'),
      savingValueLabel: pickEnumValue(verdict.savingValueLabel, REVIEW_VALUE_LABELS, 'medium'),
      reliabilityLabel: pickEnumValue(verdict.reliabilityLabel, REVIEW_RELIABILITY_LABELS, 'not_reviewed'),
      recommendedAction: pickEnumValue(verdict.recommendedAction, RECOMMENDED_ACTIONS, 'keep_as_reference'),
      priority: pickEnumValue(verdict.priority, REVIEW_PRIORITIES, 'medium'),
    },
    scores: {
      readingValue: clampScore(scores.readingValue, 50),
      savingValue: clampScore(scores.savingValue, 50),
      reliability: clampScore(scores.reliability, 0),
      practicality: clampScore(scores.practicality, 50),
    },
    summary: normalizeStringArray(raw.summary),
    detailedSummary: pickString(raw.detailedSummary, ''),
    credibilityReview: pickString(raw.credibilityReview, ''),
    practicalityReview: pickString(raw.practicalityReview, ''),
    decisionReason: pickOptionalString(raw.decisionReason),
    retentionReasons: normalizeStringArray(raw.retentionReasons),
    evidenceBasis: normalizeStringArray(raw.evidenceBasis),
    structuredSummary: normalizeStructuredSummary(raw.structuredSummary),
    strengths: normalizeStringArray(raw.strengths),
    risksOrGaps: normalizeStringArray(raw.risksOrGaps),
    verificationNeeded: normalizeStringArray(raw.verificationNeeded),
    nextActions: normalizeStringArray(raw.nextActions),
    actionItems: normalizeActionItems(raw.actionItems),
    suggestedTags: normalizeStringArray(raw.suggestedTags),
    suggestedFolder: pickOptionalString(raw.suggestedFolder),
    flags: {
      needsVerification: pickBoolean(flags.needsVerification, false),
      deleteCandidate: pickBoolean(flags.deleteCandidate, false),
    },
    ...(typeof context.extractionConfidence === 'number' ? { extractionConfidence: context.extractionConfidence } : {}),
    ...(Array.isArray(context.extractionWarnings) ? { extractionWarnings: context.extractionWarnings } : {}),
    ...(typeof context.extractionMethod === 'string' ? { extractionMethod: context.extractionMethod } : {}),
  };

  const validation = validateReviewResult(candidate);
  if (validation.ok === false) {
    return { ok: false, error: validation.error };
  }

  return validation;
}
