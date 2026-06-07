import type { ReviewModelInputPayload } from './reviewPipeline';

export interface DummyReviewRawResponse {
  contentType: 'plain_note';
  inputProfile: 'plain_note';
  fetchStatus: 'not_applicable';
  domainProfile: 'none';
  provider: string;
  model: string;
  verdict: {
    readingValueLabel: 'medium';
    savingValueLabel: 'medium';
    reliabilityLabel: 'not_reviewed';
    recommendedAction: 'keep_as_reference';
    priority: 'medium';
  };
  scores: {
    readingValue: number;
    savingValue: number;
    reliability: number;
    practicality: number;
  };
  summary: string[];
  detailedSummary: string;
  credibilityReview: string;
  practicalityReview: string;
  decisionReason: string;
  retentionReasons: string[];
  evidenceBasis: string[];
  strengths: string[];
  risksOrGaps: string[];
  verificationNeeded: string[];
  nextActions: string[];
  suggestedTags: string[];
  suggestedFolder: string;
  flags: {
    needsVerification: false;
    deleteCandidate: false;
  };
}

export function buildDummyReviewRawResponse(input: ReviewModelInputPayload): DummyReviewRawResponse {
  const sourceHint = input.sourceUrl ? `Source URL detected: ${input.sourceUrl}` : 'No source URL detected in frontmatter.';

  return {
    contentType: 'plain_note',
    inputProfile: 'plain_note',
    fetchStatus: 'not_applicable',
    domainProfile: 'none',
    provider: input.provider,
    model: input.model,
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
      'The review pipeline now reads note content and normalizes a raw review object through the mapper.',
    ],
    detailedSummary: `Dummy review generated for ${input.noteTitle}. Preview basis: ${input.notePreview || 'No preview available.'}`,
    credibilityReview: 'No AI credibility analysis has been run yet.',
    practicalityReview: `Prepared an AI input payload for ${input.provider} at ${input.endpointUrl} with ${input.noteCharacterCount} characters without logging the full note body.`,
    decisionReason: 'This note is being kept as a reference because the current pipeline can already normalize and write a reusable review artifact, but the judgment still needs real AI backing.',
    retentionReasons: [
      'The note already passes through the shared review pipeline and can be revisited later.',
      'The normalized review output can still support iterative improvement of the review experience.',
    ],
    evidenceBasis: ['ai_generated', 'unclear'],
    strengths: [
      'Review note writing is routed through the shared review pipeline.',
      'Frontmatter updates are still based on the normalized ReviewResult object.',
    ],
    risksOrGaps: [
      'No real AI provider is connected yet.',
      sourceHint,
    ],
    verificationNeeded: ['Add a real provider call that consumes the prepared model input payload.'],
    nextActions: [
      'Introduce a provider-specific client behind the review pipeline.',
      'Replace the dummy raw response builder with a real AI response path.',
    ],
    suggestedTags: ['ai-review', 'inbox-curator'],
    suggestedFolder: 'AI Reviews',
    flags: {
      needsVerification: false,
      deleteCandidate: false,
    },
  };
}
