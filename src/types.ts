export type ReviewContentType = 'plain_note' | 'url_only' | 'fetched_url' | 'ai_answer_log';

export type ReviewInputProfile =
  | 'plain_note'
  | 'url_only'
  | 'web_article'
  | 'technical_article'
  | 'github'
  | 'documentation'
  | 'video_page'
  | 'social_post'
  | 'ai_answer_log'
  | 'unknown';

export type ReviewReliabilityLabel = 'high' | 'medium' | 'low' | 'needs_verification' | 'not_reviewed';
export type ReviewValueLabel = 'high' | 'medium' | 'low';
export type ReviewPriority = 'high' | 'medium' | 'low';
export type ReviewFetchStatus = 'not_applicable' | 'success' | 'failed';
export type RecommendedAction =
  | 'read_later'
  | 'keep_as_reference'
  | 'turn_into_note'
  | 'turn_into_task'
  | 'needs_verification'
  | 'research_more'
  | 'archive'
  | 'delete_candidate'
  | 'ignore';

export interface ReviewSourceInfo {
  noteTitle: string;
  notePath: string;
  outputPath: string;
  generatedAt: string;
  sourceHash: string;
  sourceUrl?: string;
}

export interface ReviewVerdict {
  readingValueLabel: ReviewValueLabel;
  savingValueLabel: ReviewValueLabel;
  reliabilityLabel: ReviewReliabilityLabel;
  recommendedAction: RecommendedAction;
  priority: ReviewPriority;
}

export interface ReviewScores {
  readingValue: number;
  savingValue: number;
  reliability: number;
  practicality: number;
}

export interface ReviewFlags {
  needsVerification: boolean;
  deleteCandidate: boolean;
}

export interface ReviewResult {
  source: ReviewSourceInfo;
  contentType: ReviewContentType;
  inputProfile: ReviewInputProfile;
  fetchStatus: ReviewFetchStatus;
  domainProfile: string;
  provider: string;
  model: string;
  verdict: ReviewVerdict;
  scores: ReviewScores;
  summary: string[];
  detailedSummary: string;
  credibilityReview: string;
  practicalityReview: string;
  strengths: string[];
  risksOrGaps: string[];
  verificationNeeded: string[];
  nextActions: string[];
  suggestedTags: string[];
  suggestedFolder?: string;
  flags: ReviewFlags;
}
