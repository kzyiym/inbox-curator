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

export type ReviewAttachmentKind = 'image' | 'video' | 'audio' | 'pdf' | 'document' | 'archive' | 'other';
export type ReviewActionItemType = 'note' | 'task' | 'verify' | 'extract' | 'review_attachment' | 'follow_up';

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

export interface StructuredSummaryComparisonTable {
  headers: string[];
  rows: string[][];
}

export interface StructuredSummary {
  centralClaim: string;
  keyPoints: string[];
  comparisonTable?: StructuredSummaryComparisonTable;
  evidenceMentioned: string[];
}

export interface ReviewAttachment {
  path: string;
  displayName: string;
  extension: string;
  kind: ReviewAttachmentKind;
  embedded: boolean;
  exists: boolean;
}

export interface ReviewAttachmentSummary {
  totalCount: number;
  imageCount: number;
  videoCount: number;
  audioCount: number;
  pdfCount: number;
  documentCount: number;
  archiveCount: number;
  otherCount: number;
  unresolvedCount: number;
}

export interface ReviewActionItem {
  type: ReviewActionItemType;
  title: string;
  detail?: string;
  targetPath?: string;
}

export interface ReviewResult {
  source: ReviewSourceInfo;
  contentType: ReviewContentType;
  inputProfile: ReviewInputProfile;
  fetchStatus: ReviewFetchStatus;
  domainProfile: string;
  provider: string;
  model: string;
  attachments?: ReviewAttachment[];
  attachmentSummary?: ReviewAttachmentSummary;
  verdict: ReviewVerdict;
  scores: ReviewScores;
  summary: string[];
  detailedSummary: string;
  credibilityReview: string;
  practicalityReview: string;
  decisionReason?: string;
  retentionReasons?: string[];
  evidenceBasis?: string[];
  structuredSummary?: StructuredSummary;
  strengths: string[];
  risksOrGaps: string[];
  verificationNeeded: string[];
  nextActions: string[];
  actionItems?: ReviewActionItem[];
  suggestedTags: string[];
  suggestedFolder?: string;
  flags: ReviewFlags;
  extractionConfidence?: number;
  extractionWarnings?: string[];
  extractionMethod?: string;
}
