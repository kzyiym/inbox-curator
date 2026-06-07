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

function buildReviewContent(result: ReviewResult): string {
  return `---\nsource: "[[${result.source.noteTitle}]]"\nsource_path: "${result.source.notePath}"\ncontent_type: "${result.contentType}"\ninput_profile: "${result.inputProfile}"\nfetch_status: "${result.fetchStatus}"\ndomain_profile: "${result.domainProfile}"\ngenerated_at: "${result.source.generatedAt}"\nprovider: "${result.provider}"\nmodel: "${result.model}"\nsource_hash: "${result.source.sourceHash}"\nrecommended_action: "${result.verdict.recommendedAction}"\npriority: "${result.verdict.priority}"\nneeds_verification: ${String(result.flags.needsVerification)}\n---\n\n# AI Review: ${result.source.noteTitle}\n\nSource: [[${result.source.noteTitle}]]\n\n## Verdict\n\n- Reading Value: ${toTitleCase(result.verdict.readingValueLabel)}\n- Saving Value: ${toTitleCase(result.verdict.savingValueLabel)}\n- Reliability: ${toTitleCase(result.verdict.reliabilityLabel)}\n- Practicality: ${result.scores.practicality}\n- Recommended Action: ${result.verdict.recommendedAction}\n- Priority: ${result.verdict.priority}\n\n## Summary\n\n${bulletLines(result.summary)}\n\n## Detailed Summary\n\n${result.detailedSummary}\n\n## Credibility Review\n\n${result.credibilityReview}\n\n## Practicality Review\n\n${result.practicalityReview}\n\n## Evaluation Scores\n\n- Reading Value: ${result.scores.readingValue}\n- Saving Value: ${result.scores.savingValue}\n- Reliability: ${result.scores.reliability}\n- Practicality: ${result.scores.practicality}\n\n## Strengths\n\n${bulletLines(result.strengths)}\n\n## Risks / Gaps\n\n${bulletLines(result.risksOrGaps)}\n\n## Verification Needed\n\n${bulletLines(result.verificationNeeded)}\n\n## Suggested Tags\n\n${bulletLines(result.suggestedTags)}\n\n## Suggested Folder\n\n- ${result.suggestedFolder ?? 'None'}\n\n## Next Actions\n\n${bulletLines(result.nextActions)}\n`;
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
