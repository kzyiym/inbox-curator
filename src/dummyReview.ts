import { TFile, normalizePath } from 'obsidian';
import type { ReviewResult } from './types';

export function buildDummyReviewResult(file: TFile, outputFolder: string): ReviewResult {
  const generatedAt = new Date().toISOString();
  const outputPath = normalizePath(`${outputFolder}/${file.basename}.ai-review.md`);

  return {
    source: {
      noteTitle: file.basename,
      notePath: file.path,
      outputPath,
      generatedAt,
      sourceHash: `dummy:${file.stat.mtime}:${file.stat.size}`,
    },
    contentType: 'plain_note',
    inputProfile: 'plain_note',
    fetchStatus: 'not_applicable',
    domainProfile: 'none',
    provider: 'dummy',
    model: 'dummy',
    verdict: {
      readingValueLabel: 'medium',
      savingValueLabel: 'medium',
      reliabilityLabel: 'not_reviewed',
      recommendedAction: 'keep_as_reference',
      priority: 'medium',
    },
    scores: {
      readingValue: 50,
      savingValue: 50,
      reliability: 0,
      practicality: 50,
    },
    summary: [
      'This is a dummy review result for the current MVP.',
      'The plugin wiring is ready for a future AI-backed review pipeline.',
    ],
    detailedSummary: 'This is a dummy review note scaffold for the current MVP.',
    credibilityReview: 'No AI credibility analysis has been run yet.',
    practicalityReview: 'No AI practicality analysis has been run yet.',
    strengths: [
      'Separate review note output is working.',
      'Frontmatter updates are routed through a typed ReviewResult object.',
    ],
    risksOrGaps: [
      'No real AI provider is connected yet.',
      'No URL fetching or source validation is implemented yet.',
    ],
    verificationNeeded: [
      'Add provider settings and an actual API call path.',
    ],
    nextActions: [
      'Configure an AI provider in a future version.',
      'Re-run review after provider support is implemented.',
    ],
    suggestedTags: ['ai-review', 'inbox-curator'],
    suggestedFolder: 'AI Reviews',
    flags: {
      needsVerification: false,
      deleteCandidate: false,
    },
  };
}
