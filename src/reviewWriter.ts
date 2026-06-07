import { App, TFile, normalizePath } from 'obsidian';
import type { ReviewResult } from './types';

export interface ReviewNoteWriteResult {
  outputPath: string;
  created: boolean;
}

async function ensureFolder(app: App, folderPath: string): Promise<void> {
  const normalized = normalizePath(folderPath);
  if (!normalized || normalized === '.') {
    return;
  }

  const parts = normalized.split('/');
  let current = '';

  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    const existing = app.vault.getAbstractFileByPath(current);
    if (!existing) {
      await app.vault.createFolder(current);
    }
  }
}

function toTitleCase(value: string): string {
  return value
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function bulletLines(items: string[]): string {
  if (items.length === 0) {
    return '- None';
  }

  return items.map((item) => `- ${item}`).join('\n');
}

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function firstNonEmpty(items: string[]): string | undefined {
  return items.map((item) => compactWhitespace(item)).find(Boolean);
}

function firstSentence(text: string): string {
  const normalized = compactWhitespace(text);
  if (!normalized) {
    return '';
  }

  const match = normalized.match(/^.+?[。！？.!?](?:\s|$)/);
  if (match) {
    return match[0].trim();
  }

  return normalized;
}

function buildDecisionReason(result: ReviewResult): string {
  const summaryLead = firstNonEmpty(result.summary);
  if (summaryLead) {
    return summaryLead;
  }

  const credibilityLead = firstSentence(result.credibilityReview);
  if (credibilityLead) {
    return credibilityLead;
  }

  const detailLead = firstSentence(result.detailedSummary);
  if (detailLead) {
    return detailLead;
  }

  return `Recommended action is ${toTitleCase(result.verdict.recommendedAction)} with ${toTitleCase(result.verdict.priority)} priority.`;
}

function buildQuickSummaryItems(result: ReviewResult): string[] {
  if (result.summary.length > 0) {
    return result.summary;
  }

  const detailLead = firstSentence(result.detailedSummary);
  return detailLead ? [detailLead] : [];
}

function buildRetentionValueItems(result: ReviewResult): string[] {
  if (result.strengths.length > 0) {
    return result.strengths;
  }

  const fallback: string[] = [];
  if (result.verdict.savingValueLabel !== 'low') {
    fallback.push(`Saving value is currently assessed as ${toTitleCase(result.verdict.savingValueLabel)}.`);
  }
  if (result.verdict.readingValueLabel !== 'low') {
    fallback.push(`Reading value is currently assessed as ${toTitleCase(result.verdict.readingValueLabel)}.`);
  }

  return fallback;
}

function buildEvidenceBasisItems(result: ReviewResult): string[] {
  const items = ['Not explicitly classified yet'];
  const credibilityLead = firstSentence(result.credibilityReview);
  if (credibilityLead) {
    items.push(`Credibility notes: ${credibilityLead}`);
  }
  return items;
}

function buildOrganizationItems(result: ReviewResult): string[] {
  return [
    `Suggested Tags: ${result.suggestedTags.length > 0 ? result.suggestedTags.join(', ') : 'None'}`,
    `Suggested Folder: ${result.suggestedFolder ?? 'None'}`,
  ];
}

function buildReviewContent(result: ReviewResult): string {
  const decisionReason = buildDecisionReason(result);
  const quickSummaryItems = buildQuickSummaryItems(result);
  const retentionValueItems = buildRetentionValueItems(result);
  const evidenceBasisItems = buildEvidenceBasisItems(result);
  const organizationItems = buildOrganizationItems(result);

  return `---\nsource: "[[${result.source.noteTitle}]]"\nsource_path: "${result.source.notePath}"\ncontent_type: "${result.contentType}"\ninput_profile: "${result.inputProfile}"\nfetch_status: "${result.fetchStatus}"\ndomain_profile: "${result.domainProfile}"\ngenerated_at: "${result.source.generatedAt}"\nprovider: "${result.provider}"\nmodel: "${result.model}"\nsource_hash: "${result.source.sourceHash}"\nrecommended_action: "${result.verdict.recommendedAction}"\npriority: "${result.verdict.priority}"\nneeds_verification: ${String(result.flags.needsVerification)}\n---\n\n# AI Review: ${result.source.noteTitle}\n\nSource: [[${result.source.noteTitle}]]\n\n## Decision\n\n- Recommended Action: ${toTitleCase(result.verdict.recommendedAction)}\n- Priority: ${toTitleCase(result.verdict.priority)}\n- Needs Verification: ${result.flags.needsVerification ? 'Yes' : 'No'}\n- Reading Value: ${toTitleCase(result.verdict.readingValueLabel)}\n- Saving Value: ${toTitleCase(result.verdict.savingValueLabel)}\n- Reliability: ${toTitleCase(result.verdict.reliabilityLabel)}\n\n## Why this decision\n\n${decisionReason}\n\n## Quick Summary\n\n${bulletLines(quickSummaryItems)}\n\n## Retention Value\n\n${bulletLines(retentionValueItems)}\n\n## Evidence Basis\n\n${bulletLines(evidenceBasisItems)}\n\n## Risks / Gaps\n\n${bulletLines(result.risksOrGaps)}\n\n## Verification Needed\n\n${bulletLines(result.verificationNeeded)}\n\n## Next Actions\n\n${bulletLines(result.nextActions)}\n\n## Organization\n\n${bulletLines(organizationItems)}\n`;
}

export async function writeReviewNote(app: App, sourceFile: TFile, result: ReviewResult): Promise<ReviewNoteWriteResult> {
  const outputFolder = normalizePath(result.source.outputPath.split('/').slice(0, -1).join('/'));
  await ensureFolder(app, outputFolder);

  const outputPath = normalizePath(result.source.outputPath);
  const content = buildReviewContent(result);
  const existing = app.vault.getAbstractFileByPath(outputPath);

  if (existing instanceof TFile) {
    await app.vault.modify(existing, content);
    return { outputPath, created: false };
  }

  await app.vault.create(outputPath, content);
  return { outputPath, created: true };
}
