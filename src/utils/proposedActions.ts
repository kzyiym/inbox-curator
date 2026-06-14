import { App, TFile, TFolder, normalizePath } from 'obsidian';
import type { InboxCuratorSettings } from '../settings';
import {
  computeActionDecision,
  type ActionDecision,
  type ActionDecisionSettings,
} from '../actionDecision';
import { resolveActionDestination } from '../actionLayer';
import { normalizeReviewAction, type ReviewAction, type ReviewConfidence } from '../reviewNormalizer';
import type { ReviewReliabilityLabel } from '../types';
import { hasPromptInjectionSignals } from './promptInjection';

export interface ProposedActionItem {
  file: TFile;
  notePath: string;
  noteTitle: string;
  action: string;
  reviewAction: ReviewAction;
  confidence: ReviewConfidence;
  reliabilityLabel: ReviewReliabilityLabel;
  suggestedFolder?: string;
  decision: ActionDecision;
  destinationPath?: string;
  destinationConflict: boolean;
}

const ACTIONABLE = new Set<ReviewAction>(['archive', 'read_later', 'task', 'delete_candidate']);

function asConfidence(value: unknown): ReviewConfidence | undefined {
  return value === 'low' || value === 'medium' || value === 'high' ? value : undefined;
}

function asReliability(value: unknown): ReviewReliabilityLabel | undefined {
  return value === 'low' || value === 'medium' || value === 'high' ? value : undefined;
}

export function toActionDecisionSettings(settings: InboxCuratorSettings): ActionDecisionSettings {
  return {
    autoExecuteArchive: settings.autoExecuteArchive,
    autoExecuteReadLater: settings.autoExecuteReadLater,
    autoExecuteTask: settings.autoExecuteTask,
    allowActionArchive: settings.allowActionArchive,
    allowActionReadLater: settings.allowActionReadLater,
    allowActionTask: settings.allowActionTask,
    allowActionDeleteCandidate: settings.allowActionDeleteCandidate,
    minConfidenceArchive: settings.minConfidenceArchive,
    minConfidenceReadLater: settings.minConfidenceReadLater,
    minConfidenceTask: settings.minConfidenceTask,
  };
}

function isReviewOutputFile(path: string, reviewOutputFolder: string): boolean {
  if (path.endsWith('.ai-review.md')) return true;
  const normalizedOutput = normalizePath(reviewOutputFolder.trim() || 'AI Reviews');
  return path === normalizedOutput || path.startsWith(normalizedOutput + '/');
}

/**
 * Scans the watched folder for reviewed notes that carry a recommended action
 * and computes, without mutating anything, what auto-sort would do for each.
 * Used by the action review (dry-run / approval) panel.
 */
export async function collectProposedActions(
  app: App,
  settings: InboxCuratorSettings,
): Promise<ProposedActionItem[]> {
  const watched = normalizePath(settings.watchedFolder.trim() || 'Inbox');
  const folder = app.vault.getAbstractFileByPath(watched);
  if (!(folder instanceof TFolder)) {
    return [];
  }

  const decisionSettings = toActionDecisionSettings(settings);
  const items: ProposedActionItem[] = [];

  const files: TFile[] = [];
  const walk = (dir: TFolder): void => {
    for (const child of dir.children) {
      if (child instanceof TFolder) {
        walk(child);
      } else if (child instanceof TFile && child.extension === 'md') {
        files.push(child);
      }
    }
  };
  walk(folder);

  for (const file of files) {
    if (isReviewOutputFile(file.path, settings.reviewOutputFolder)) {
      continue;
    }
    const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
    if (!frontmatter) continue;

    const rawAction = frontmatter.ai_review_recommended_action;
    if (typeof rawAction !== 'string' || rawAction.trim() === '') continue;

    const reviewAction = normalizeReviewAction(rawAction);
    if (!ACTIONABLE.has(reviewAction)) continue;

    const reliabilityLabel: ReviewReliabilityLabel =
      asReliability(frontmatter.ai_review_reliability_label) ?? 'medium';
    const confidence: ReviewConfidence =
      asConfidence(frontmatter.ai_review_confidence) ?? reliabilityLabel;

    const suggestedFolderRaw = frontmatter.ai_review_suggested_folder;
    const suggestedFolder =
      typeof suggestedFolderRaw === 'string' && suggestedFolderRaw.trim() !== ''
        ? suggestedFolderRaw.trim()
        : undefined;

    let injection = false;
    if (reviewAction === 'task') {
      try {
        injection = hasPromptInjectionSignals(await app.vault.cachedRead(file));
      } catch {
        injection = false;
      }
    }

    const decision = computeActionDecision({
      action: rawAction.trim().toLowerCase(),
      reviewAction,
      parseStatus: 'parsed',
      confidence,
      reliabilityLabel,
      reviewMode: settings.reviewMode,
      hasPromptInjectionSignals: injection,
      settings: decisionSettings,
    });

    const dest = resolveActionDestination(app, file, reviewAction, suggestedFolder, {
      readLaterFolder: settings.readLaterFolder,
      taskFolder: settings.taskFolder,
      deleteCandidateFolder: settings.deleteCandidateFolder,
      suggestedFolderBasePath: settings.suggestedFolderBasePath,
    });

    items.push({
      file,
      notePath: file.path,
      noteTitle: file.basename,
      action: rawAction.trim().toLowerCase(),
      reviewAction,
      confidence,
      reliabilityLabel,
      suggestedFolder,
      decision,
      destinationPath: dest.destinationPath,
      destinationConflict: dest.conflict,
    });
  }

  items.sort((a, b) => a.notePath.localeCompare(b.notePath));
  return items;
}
