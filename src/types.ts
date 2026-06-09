export type ReviewMode = 'standard' | 'simple' | 'safe';

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

export type ReviewReliabilityLabel = 'high' | 'medium' | 'low';
export type ReviewValueLabel = 'high' | 'medium' | 'low';
export type ReviewPriority = 'high' | 'medium' | 'low';
export type ReviewFetchStatus = 'not_applicable' | 'success' | 'failed';
// TODO: Consider adding "temporary_reference" for pricing/news/spec-change articles.
export type RecommendedAction =
  | 'keep_as_reference'
  | 'read_later'
  | 'archive'
  | 'task'
  | 'delete_candidate';

export interface ConceptCandidate {
  title: string;
  description: string;
}

export interface InputContentReductionInfo {
  wasFiltered: boolean;
  removedLineCount: number;
  removedCharCount: number;
  wasTruncated: boolean;
  originalCharCount: number;
  finalCharCount: number;
}

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
  wasOptimized?: boolean;
  originalBytes?: number;
  optimizedBytes?: number;
  originalWidth?: number;
  originalHeight?: number;
  optimizedWidth?: number;
  optimizedHeight?: number;
  skipReason?: string;
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

export interface CollectionReviewNoteInput {
  notePath: string;
  noteTitle: string;
  hasExistingReview: boolean;
  existingReviewContent: string;
  frontmatterSummary: string;
  excerpt: string;
}

export type CollectionReviewBuildResult = {
  ok: true;
  notesInput: CollectionReviewNoteInput[];
  prompt: string;
  outputFolder: string;
  sourceType: 'selected_notes' | 'folder';
  sourceFolder: string;
  sourceNotePaths: string[];
} | {
  ok: false;
  error: string;
}

export interface CollectionReviewPipelineOptions {
  outputFolder: string;
  provider: string;
  endpointUrl: string;
  model: string;
  apiKey: string;
  maxNotes: number;
  maxExcerptCharsPerNote: number;
  useExistingReviewsFirst: boolean;
  includeExcerptWhenNeeded: boolean;
  promptLanguage: 'english' | 'japanese';
  requestTimeoutMs: number;
  maxOutputTokens: number;
  openAiTokenLimitParam?: 'max_tokens' | 'max_completion_tokens' | 'none';
  isUnloaded: () => boolean;
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
  conceptCandidates?: ConceptCandidate[];
  suggestedTags: string[];
  suggestedFolder?: string;
  flags: ReviewFlags;
  extractionConfidence?: number;
  extractionWarnings?: string[];
  extractionMethod?: string;
  inputReductionInfo?: InputContentReductionInfo;
  promptLanguage: 'english' | 'japanese';
}
