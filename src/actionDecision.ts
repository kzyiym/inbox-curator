import type { ReviewMode, ReviewReliabilityLabel } from './types';
import {
  canAutoExecuteReviewAction,
  confidenceMeetsThreshold,
  type AutoSortSkipReason,
  type ReviewAction,
  type ReviewConfidence,
  type ReviewParseStatus,
} from './reviewNormalizer';

export interface ActionDecisionSettings {
  autoExecuteArchive: boolean;
  autoExecuteReadLater: boolean;
  autoExecuteTask: boolean;
  allowActionArchive: boolean;
  allowActionReadLater: boolean;
  allowActionTask: boolean;
  allowActionDeleteCandidate: boolean;
  minConfidenceArchive: ReviewConfidence;
  minConfidenceReadLater: ReviewConfidence;
  minConfidenceTask: ReviewConfidence;
}

export interface ActionDecisionInput {
  action: string;
  reviewAction: ReviewAction;
  parseStatus: ReviewParseStatus;
  confidence: ReviewConfidence;
  reliabilityLabel: ReviewReliabilityLabel;
  reviewMode: ReviewMode;
  hasPromptInjectionSignals: boolean;
  settings: ActionDecisionSettings;
}

export interface ActionDecision {
  wouldAutoExecute: boolean;
  allowedByAllowlist: boolean;
  skipReason?: string;
  skipCode?: AutoSortSkipReason;
}

export function isActionAllowed(
  reviewAction: ReviewAction,
  settings: ActionDecisionSettings,
): boolean {
  switch (reviewAction) {
    case 'archive':
      return settings.allowActionArchive;
    case 'read_later':
      return settings.allowActionReadLater;
    case 'task':
      return settings.allowActionTask;
    case 'delete_candidate':
      return settings.allowActionDeleteCandidate;
    default:
      return true;
  }
}

/**
 * Single source of truth for whether a reviewed note's recommended action
 * should auto-execute. Shared by the live pipeline (main.ts) and the manual
 * action review panel so both surfaces agree on the verdict and skip reason.
 */
export function computeActionDecision(input: ActionDecisionInput): ActionDecision {
  const { reviewAction, parseStatus, confidence, reliabilityLabel, reviewMode, settings } = input;
  const allowedByAllowlist = isActionAllowed(reviewAction, settings);

  if (reviewMode === 'safe') {
    return {
      wouldAutoExecute: false,
      allowedByAllowlist,
      skipReason: 'review-only mode disables auto-sort',
      skipCode: 'safe_mode',
    };
  }

  let wouldAutoExecute = canAutoExecuteReviewAction(
    reviewAction,
    parseStatus,
    confidence,
    reviewMode,
    settings,
  );

  let skipReason: string | undefined;
  let skipCode: AutoSortSkipReason | undefined;

  if (!wouldAutoExecute) {
    const minTask = settings.minConfidenceTask;
    if (parseStatus !== 'parsed') {
      skipReason = `parseStatus is ${parseStatus}`;
      skipCode = 'parse_status';
    } else if (!allowedByAllowlist) {
      skipReason = `action ${input.action} is not allowed by the action allowlist`;
      skipCode = 'allowlist_blocked';
    } else if (reviewAction === 'task' && !confidenceMeetsThreshold(confidence, minTask)) {
      skipReason = `task requires ${minTask} confidence (got ${confidence})`;
      skipCode = 'task_requires_high';
    } else if (
      (reviewAction === 'archive' && !confidenceMeetsThreshold(confidence, settings.minConfidenceArchive)) ||
      (reviewAction === 'read_later' && !confidenceMeetsThreshold(confidence, settings.minConfidenceReadLater))
    ) {
      skipReason = `confidence below threshold (${confidence})`;
      skipCode = 'confidence_low';
    } else if (input.action === 'delete_candidate' || reviewAction === 'delete_candidate') {
      skipReason = 'delete_candidate is never auto-executed';
      skipCode = 'delete_candidate';
    } else {
      skipReason = 'setting disabled or action none';
      skipCode = 'setting_disabled';
    }
  }

  if (wouldAutoExecute && reliabilityLabel !== 'high') {
    const allowsMediumReliability = reviewAction === 'archive' || reviewAction === 'read_later';
    if (!allowsMediumReliability || reliabilityLabel !== 'medium') {
      wouldAutoExecute = false;
      skipReason = `reliabilityLabel is ${reliabilityLabel} for action ${input.action}`;
      skipCode = 'reliability_low';
    }
  }

  if (wouldAutoExecute && input.hasPromptInjectionSignals && reviewAction === 'task') {
    wouldAutoExecute = false;
    skipReason = 'prompt injection signals detected for task';
    skipCode = 'prompt_injection';
  }

  return { wouldAutoExecute, allowedByAllowlist, skipReason, skipCode };
}
