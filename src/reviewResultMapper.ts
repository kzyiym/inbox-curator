import type {
  ConceptCandidate,
  InputContentReductionInfo,
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
];
const REVIEW_PRIORITIES: readonly ReviewPriority[] = ['high', 'medium', 'low'];
const RECOMMENDED_ACTIONS: readonly RecommendedAction[] = [
  'keep_as_reference',
  'read_later',
  'archive',
  'task',
  'delete_candidate',
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

function truncateString(val: string, max: number): string {
  return val.length <= max ? val : val.slice(0, max);
}

function clampScore(value: unknown, fallback: number): number {
  let numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  if (numeric > 0 && numeric <= 1) {
    numeric = numeric * 100;
  }

  return Math.max(0, Math.min(100, Math.round(numeric)));
}

function pickEnumValue<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  if (typeof value !== 'string') {
    return fallback;
  }
  const clean = value.trim().toLowerCase();
  return allowed.includes(clean as T) ? (clean as T) : fallback;
}

function normalizeStringArray(value: unknown, maxChars = 1000): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === 'string') return item.trim();
        if (typeof item === 'number' || typeof item === 'boolean') return String(item).trim();
        return '';
      })
      .filter(Boolean)
      .map((s) => s.slice(0, maxChars));
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? [trimmed.slice(0, maxChars)] : [];
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return [String(value).trim().slice(0, maxChars)];
  }

  return [];
}

function normalizeAction(action: unknown): RecommendedAction {
  if (typeof action !== 'string') {
    return 'keep_as_reference';
  }
  const clean = action.trim().toLowerCase().replace(/[-_]/g, '');

  if (clean === 'keepasreference' || clean === 'reference') {
    return 'keep_as_reference';
  }
  if (clean === 'readlater' || clean === 'read') {
    return 'read_later';
  }
  if (clean === 'archive' || clean === 'archivenote' || clean === 'archived') {
    return 'archive';
  }
  if (clean === 'task' || clean === 'turnintotask' || clean === 'tasks') {
    return 'task';
  }
  if (clean === 'delete' || clean === 'deletecandidate') {
    return 'delete_candidate';
  }

  // Deprecated action normalization
  if (clean === 'researchmore' || clean === 'research') {
    return 'read_later';
  }
  if (clean === 'ignore' || clean === 'none') {
    return 'archive';
  }
  if (clean === 'turnintonote' || clean === 'note') {
    return 'archive';
  }

  // Unknown actions fall back to archive (conservative storage)
  return 'archive';
}

function normalizeStringMatrix(value: unknown): string[][] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((row): row is unknown[] => Array.isArray(row))
    .map((row) => row.filter((cell): cell is string => typeof cell === 'string').map((cell) => cell.trim()))
    .filter((row) => row.length > 0);
}

function normalizeConceptCandidates(value: unknown): ConceptCandidate[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null && !Array.isArray(item))
    .map((item) => ({
      title: typeof item.title === 'string' ? item.title.trim() : '',
      description: typeof item.description === 'string' ? item.description.trim() : '',
    }))
    .filter((item) => item.title !== '');
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
  inputReductionInfo?: InputContentReductionInfo;
  promptLanguage?: 'english' | 'japanese';
}

export function mapToReviewResult(raw: unknown, context: ReviewResultMappingContext): ReviewResultMappingResult {
  if (!isRecord(raw)) {
    return { ok: false, error: 'AI response must be a JSON object.' };
  }

  if (
    raw.verdict === undefined || raw.verdict === null ||
    raw.scores === undefined || raw.scores === null ||
    (raw.summary === undefined && raw.shortSummary === undefined) ||
    raw.detailedSummary === undefined || raw.detailedSummary === null
  ) {
    return { ok: false, error: 'AI response is missing critical required fields.' };
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
      noteTitle: truncateString(pickString(raw.noteTitle, source.noteTitle), 300),
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
      reliabilityLabel: pickEnumValue(verdict.reliabilityLabel, REVIEW_RELIABILITY_LABELS, 'medium'),
      recommendedAction: normalizeAction(verdict.recommendedAction),
      priority: pickEnumValue(verdict.priority, REVIEW_PRIORITIES, 'medium'),
    },
    scores: {
      readingValue: clampScore(scores.readingValue, 50),
      savingValue: clampScore(scores.savingValue, 50),
      reliability: clampScore(scores.reliability, 0),
      practicality: clampScore(scores.practicality, 50),
    },
    summary: normalizeStringArray(raw.summary !== undefined ? raw.summary : raw.shortSummary, 1000),
    detailedSummary: truncateString(pickString(raw.detailedSummary, ''), 10000),
    credibilityReview: truncateString(pickString(raw.credibilityReview, ''), 10000),
    practicalityReview: truncateString(pickString(raw.practicalityReview, ''), 10000),
    decisionReason: raw.decisionReason !== undefined ? truncateString(pickString(raw.decisionReason, ''), 1000) : undefined,
    retentionReasons: normalizeStringArray(raw.retentionReasons, 1000),
    evidenceBasis: normalizeStringArray(raw.evidenceBasis, 1000),
    structuredSummary: normalizeStructuredSummary(raw.structuredSummary),
    strengths: normalizeStringArray(raw.strengths, 1000),
    risksOrGaps: normalizeStringArray(raw.risksOrGaps, 1000),
    verificationNeeded: normalizeStringArray(raw.verificationNeeded, 1000),
    nextActions: normalizeStringArray(raw.nextActions, 1000),
    actionItems: normalizeActionItems(raw.actionItems),
    conceptCandidates: (() => { const cc = normalizeConceptCandidates(raw.conceptCandidates); return cc.length > 0 ? cc : undefined; })(),
    suggestedTags: normalizeStringArray(raw.suggestedTags, 1000),
    suggestedFolder: raw.suggestedFolder !== undefined ? truncateString(pickString(raw.suggestedFolder, ''), 300) : undefined,
    flags: {
      needsVerification: pickBoolean(flags.needsVerification, false),
      deleteCandidate: pickBoolean(flags.deleteCandidate, false),
    },
    ...(typeof context.extractionConfidence === 'number' ? { extractionConfidence: context.extractionConfidence } : {}),
    ...(Array.isArray(context.extractionWarnings) ? { extractionWarnings: context.extractionWarnings } : {}),
    ...(typeof context.extractionMethod === 'string' ? { extractionMethod: context.extractionMethod } : {}),
    ...(context.inputReductionInfo ? { inputReductionInfo: context.inputReductionInfo } : {}),
    promptLanguage: context.promptLanguage ?? 'english',
  };

  const validation = validateReviewResult(candidate);
  if (validation.ok === false) {
    return { ok: false, error: validation.error };
  }

  return validation;
}
