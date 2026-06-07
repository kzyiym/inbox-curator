import type {
  RecommendedAction,
  ReviewContentType,
  ReviewFetchStatus,
  ReviewInputProfile,
  ReviewPriority,
  ReviewReliabilityLabel,
  ReviewResult,
  ReviewValueLabel,
} from './types';

const REVIEW_CONTENT_TYPES = ['plain_note', 'url_only', 'fetched_url', 'ai_answer_log'] as const;
const REVIEW_INPUT_PROFILES = [
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
] as const;
const REVIEW_FETCH_STATUSES = ['not_applicable', 'success', 'failed'] as const;
const REVIEW_VALUE_LABELS = ['high', 'medium', 'low'] as const;
const REVIEW_RELIABILITY_LABELS = ['high', 'medium', 'low', 'needs_verification', 'not_reviewed'] as const;
const REVIEW_PRIORITIES = ['high', 'medium', 'low'] as const;
const RECOMMENDED_ACTIONS = [
  'read_later',
  'keep_as_reference',
  'turn_into_note',
  'turn_into_task',
  'needs_verification',
  'research_more',
  'archive',
  'delete_candidate',
  'ignore',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function includesEnum<T extends string>(allowed: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}

export interface ReviewResultValidationFailure {
  ok: false;
  error: string;
}

export interface ReviewResultValidationSuccess {
  ok: true;
  result: ReviewResult;
}

export type ReviewResultValidationResult = ReviewResultValidationFailure | ReviewResultValidationSuccess;

export function isReviewResult(value: unknown): value is ReviewResult {
  return validateReviewResult(value).ok;
}

export function validateReviewResult(value: unknown): ReviewResultValidationResult {
  if (!isRecord(value)) {
    return { ok: false, error: 'ReviewResult must be an object.' };
  }

  if (!isRecord(value.source)) {
    return { ok: false, error: 'ReviewResult.source must be an object.' };
  }

  if (typeof value.source.noteTitle !== 'string' || value.source.noteTitle.trim() === '') {
    return { ok: false, error: 'ReviewResult.source.noteTitle must be a non-empty string.' };
  }

  if (typeof value.source.notePath !== 'string' || value.source.notePath.trim() === '') {
    return { ok: false, error: 'ReviewResult.source.notePath must be a non-empty string.' };
  }

  if (typeof value.source.outputPath !== 'string' || value.source.outputPath.trim() === '') {
    return { ok: false, error: 'ReviewResult.source.outputPath must be a non-empty string.' };
  }

  if (typeof value.source.generatedAt !== 'string' || value.source.generatedAt.trim() === '') {
    return { ok: false, error: 'ReviewResult.source.generatedAt must be a non-empty string.' };
  }

  if (typeof value.source.sourceHash !== 'string' || value.source.sourceHash.trim() === '') {
    return { ok: false, error: 'ReviewResult.source.sourceHash must be a non-empty string.' };
  }

  if (value.source.sourceUrl !== undefined && typeof value.source.sourceUrl !== 'string') {
    return { ok: false, error: 'ReviewResult.source.sourceUrl must be a string when present.' };
  }

  if (!includesEnum(REVIEW_CONTENT_TYPES, value.contentType)) {
    return { ok: false, error: 'ReviewResult.contentType is invalid.' };
  }

  if (!includesEnum(REVIEW_INPUT_PROFILES, value.inputProfile)) {
    return { ok: false, error: 'ReviewResult.inputProfile is invalid.' };
  }

  if (!includesEnum(REVIEW_FETCH_STATUSES, value.fetchStatus)) {
    return { ok: false, error: 'ReviewResult.fetchStatus is invalid.' };
  }

  if (typeof value.domainProfile !== 'string') {
    return { ok: false, error: 'ReviewResult.domainProfile must be a string.' };
  }

  if (typeof value.provider !== 'string') {
    return { ok: false, error: 'ReviewResult.provider must be a string.' };
  }

  if (typeof value.model !== 'string') {
    return { ok: false, error: 'ReviewResult.model must be a string.' };
  }

  if (!isRecord(value.verdict)) {
    return { ok: false, error: 'ReviewResult.verdict must be an object.' };
  }

  if (!includesEnum(REVIEW_VALUE_LABELS, value.verdict.readingValueLabel)) {
    return { ok: false, error: 'ReviewResult.verdict.readingValueLabel is invalid.' };
  }

  if (!includesEnum(REVIEW_VALUE_LABELS, value.verdict.savingValueLabel)) {
    return { ok: false, error: 'ReviewResult.verdict.savingValueLabel is invalid.' };
  }

  if (!includesEnum(REVIEW_RELIABILITY_LABELS, value.verdict.reliabilityLabel)) {
    return { ok: false, error: 'ReviewResult.verdict.reliabilityLabel is invalid.' };
  }

  if (!includesEnum(RECOMMENDED_ACTIONS, value.verdict.recommendedAction)) {
    return { ok: false, error: 'ReviewResult.verdict.recommendedAction is invalid.' };
  }

  if (!includesEnum(REVIEW_PRIORITIES, value.verdict.priority)) {
    return { ok: false, error: 'ReviewResult.verdict.priority is invalid.' };
  }

  if (!isRecord(value.scores)) {
    return { ok: false, error: 'ReviewResult.scores must be an object.' };
  }

  if (!isFiniteNumber(value.scores.readingValue)) {
    return { ok: false, error: 'ReviewResult.scores.readingValue must be a finite number.' };
  }

  if (!isFiniteNumber(value.scores.savingValue)) {
    return { ok: false, error: 'ReviewResult.scores.savingValue must be a finite number.' };
  }

  if (!isFiniteNumber(value.scores.reliability)) {
    return { ok: false, error: 'ReviewResult.scores.reliability must be a finite number.' };
  }

  if (!isFiniteNumber(value.scores.practicality)) {
    return { ok: false, error: 'ReviewResult.scores.practicality must be a finite number.' };
  }

  if (!isRecord(value.flags)) {
    return { ok: false, error: 'ReviewResult.flags must be an object.' };
  }

  if (typeof value.flags.needsVerification !== 'boolean') {
    return { ok: false, error: 'ReviewResult.flags.needsVerification must be a boolean.' };
  }

  if (typeof value.flags.deleteCandidate !== 'boolean') {
    return { ok: false, error: 'ReviewResult.flags.deleteCandidate must be a boolean.' };
  }

  if (!isStringArray(value.summary)) {
    return { ok: false, error: 'ReviewResult.summary must be a string array.' };
  }

  if (typeof value.detailedSummary !== 'string') {
    return { ok: false, error: 'ReviewResult.detailedSummary must be a string.' };
  }

  if (typeof value.credibilityReview !== 'string') {
    return { ok: false, error: 'ReviewResult.credibilityReview must be a string.' };
  }

  if (typeof value.practicalityReview !== 'string') {
    return { ok: false, error: 'ReviewResult.practicalityReview must be a string.' };
  }

  if (value.decisionReason !== undefined && typeof value.decisionReason !== 'string') {
    return { ok: false, error: 'ReviewResult.decisionReason must be a string when present.' };
  }

  if (value.retentionReasons !== undefined && !isStringArray(value.retentionReasons)) {
    return { ok: false, error: 'ReviewResult.retentionReasons must be a string array when present.' };
  }

  if (value.evidenceBasis !== undefined && !isStringArray(value.evidenceBasis)) {
    return { ok: false, error: 'ReviewResult.evidenceBasis must be a string array when present.' };
  }

  if (value.structuredSummary !== undefined) {
    if (!isRecord(value.structuredSummary)) {
      return { ok: false, error: 'ReviewResult.structuredSummary must be an object when present.' };
    }

    if (typeof value.structuredSummary.centralClaim !== 'string') {
      return { ok: false, error: 'ReviewResult.structuredSummary.centralClaim must be a string.' };
    }

    if (!isStringArray(value.structuredSummary.keyPoints)) {
      return { ok: false, error: 'ReviewResult.structuredSummary.keyPoints must be a string array.' };
    }

    if (!isStringArray(value.structuredSummary.evidenceMentioned)) {
      return { ok: false, error: 'ReviewResult.structuredSummary.evidenceMentioned must be a string array.' };
    }

    if (value.structuredSummary.comparisonTable !== undefined) {
      if (!isRecord(value.structuredSummary.comparisonTable)) {
        return { ok: false, error: 'ReviewResult.structuredSummary.comparisonTable must be an object when present.' };
      }

      if (!isStringArray(value.structuredSummary.comparisonTable.headers)) {
        return { ok: false, error: 'ReviewResult.structuredSummary.comparisonTable.headers must be a string array.' };
      }

      if (!Array.isArray(value.structuredSummary.comparisonTable.rows)) {
        return { ok: false, error: 'ReviewResult.structuredSummary.comparisonTable.rows must be a string matrix.' };
      }

      for (const row of value.structuredSummary.comparisonTable.rows) {
        if (!isStringArray(row)) {
          return { ok: false, error: 'ReviewResult.structuredSummary.comparisonTable.rows must be a string matrix.' };
        }
      }
    }
  }

  if (!isStringArray(value.strengths)) {
    return { ok: false, error: 'ReviewResult.strengths must be a string array.' };
  }

  if (!isStringArray(value.risksOrGaps)) {
    return { ok: false, error: 'ReviewResult.risksOrGaps must be a string array.' };
  }

  if (!isStringArray(value.verificationNeeded)) {
    return { ok: false, error: 'ReviewResult.verificationNeeded must be a string array.' };
  }

  if (!isStringArray(value.nextActions)) {
    return { ok: false, error: 'ReviewResult.nextActions must be a string array.' };
  }

  if (!isStringArray(value.suggestedTags)) {
    return { ok: false, error: 'ReviewResult.suggestedTags must be a string array.' };
  }

  if (value.suggestedFolder !== undefined && typeof value.suggestedFolder !== 'string') {
    return { ok: false, error: 'ReviewResult.suggestedFolder must be a string when present.' };
  }

  return { ok: true, result: value as unknown as ReviewResult };
}
