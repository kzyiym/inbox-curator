import { App, TFile, normalizePath } from 'obsidian';
import type { InputContentReductionInfo, ReviewResult, StructuredSummaryComparisonTable, ReviewActionItem, RecommendedAction, ReviewPriority } from './types';
import { ensureFolder } from './utils/folder';

export interface ReviewNoteWriteResult {
  outputPath: string;
  created: boolean;
}

type PromptLanguage = 'japanese' | 'english' | 'auto' | 'note-language';
type ResolvedLanguage = 'english' | 'japanese';

const HEADINGS: Record<string, Record<ResolvedLanguage, string>> = {
  overview: { english: '## Overview', japanese: '## 概要' },
  keyTakeaways: { english: '## Key Takeaways', japanese: '## 重要なポイント' },
  whyItMatters: { english: '## Why It Matters', japanese: '## このノートの価値' },
  caveats: { english: '## Caveats', japanese: '## 注意点' },
  suggestedUse: { english: '## Suggested Use', japanese: '## 活用方法' },
  conceptCandidates: { english: '## Concept Candidates', japanese: '## コンセプト候補' },
  reviewDetails: { english: '## Review Details', japanese: '## レビュー詳細' },
  curationDecision: { english: '### Curation Decision', japanese: '### キュレーション判断' },
  evidenceNotes: { english: '### Evidence Notes', japanese: '### 根拠ノート' },
  followUpActions: { english: '### Follow-up Actions', japanese: '### フォローアップ' },
  required: { english: '#### Required', japanese: '#### 必須' },
  optional: { english: '#### Optional', japanese: '#### 任意' },
  attachments: { english: '### Attachments', japanese: '### 添付ファイル' },
  inputProcessing: { english: '### Input Processing', japanese: '### 入力処理' },
  organization: { english: '### Organization', japanese: '### 整理情報' },
  technicalMetadata: { english: '### Technical Metadata', japanese: '### 技術メタデータ' },
  autoExecuteResult: { english: '## Auto-execute Result', japanese: '## 自動実行結果' },
};

function h(lang: ResolvedLanguage, key: string): string {
  return HEADINGS[key]?.[lang] ?? `## ${key}`;
}

function toTitleCase(value: string): string {
  return value
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function getRecommendedActionPhrase(action: string): string {
  const act = action.toLowerCase();
  switch (act) {
    case 'read_later':
      return 'Read Later (Keep in inbox to read when time permits)';
    case 'keep_as_reference':
      return 'Keep as Reference (Store in knowledge base for future lookups)';
    case 'task':
      return 'Convert to Task (Extract tasks and track them)';
    case 'archive':
      return 'Archive (Move to archive folder as it is processed)';
    case 'delete_candidate':
      return 'Move to Trash Candidate (Isolate in trash folder for review)';
    default:
      return toTitleCase(action);
  }
}

function stripLeadingSectionLabel(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return trimmed;

  const labels = [
    'caveats:',
    'caveat:',
    'suggested use:',
    'use:',
    'why it matters:',
    'overview:',
    'key takeaways:',
  ];

  const lower = trimmed.toLowerCase();
  for (const label of labels) {
    if (lower.startsWith(label)) {
      return trimmed.slice(label.length).trim();
    }
  }

  return trimmed;
}

function formatVerdictLabel(action: RecommendedAction, priority: ReviewPriority, language: PromptLanguage): string {
  const act = action.toLowerCase();
  const pri = priority.toLowerCase();

  if (language === 'japanese') {
    const actionMap: Record<string, string> = {
      'read_later': '後で読む',
      'keep_as_reference': '参照用に保存',
      'task': 'タスク化',
      'archive': 'アーカイブ',
      'delete_candidate': '削除候補として確認',
    };
    const actionLabel = actionMap[act] ?? toTitleCase(action);
    const priorityLabel = pri === 'high' ? 'High priority' : pri === 'medium' ? 'Medium priority' : 'Low priority';
    return `${actionLabel} / ${priorityLabel}`;
  }

  const actionMapEn: Record<string, string> = {
    'read_later': 'Read later',
    'keep_as_reference': 'Keep as reference',
    'task': 'Convert to task',
    'archive': 'Archive',
    'delete_candidate': 'Review as delete candidate',
  };
  const actionLabel = actionMapEn[act] ?? toTitleCase(action);
  const priorityLabel = pri.charAt(0).toUpperCase() + pri.slice(1) + ' priority';
  return `${actionLabel} / ${priorityLabel}`;
}

function formatActionItemForMarkdown(item: ReviewActionItem, language: PromptLanguage): string {
  const type = item.type.toLowerCase();
  let prefix = '';
  if (language === 'japanese') {
    if (type === 'verify') prefix = '検証:';
    else if (type === 'review_attachment') prefix = '確認:';
    else if (type === 'task') prefix = '作業:';
    else if (type === 'note') prefix = 'ノート作成:';
    else if (type === 'extract') prefix = '抽出:';
    else prefix = '確認:';
  } else {
    if (type === 'verify') prefix = 'Verify:';
    else if (type === 'review_attachment') prefix = 'Review:';
    else if (type === 'task') prefix = 'Task:';
    else if (type === 'note') prefix = 'Create note:';
    else if (type === 'extract') prefix = 'Extract:';
    else prefix = 'Follow up:';
  }

  let msg = `${prefix} ${item.title}`;
  if (item.detail) {
    msg += ` — ${item.detail}`;
  }
  return msg;
}

function shouldShowRequiredActions(result: ReviewResult): boolean {
  if (result.flags.needsVerification) {
    return true;
  }

  const action = result.verdict.recommendedAction;
  if (action === 'delete_candidate' || action === 'archive') {
    return true;
  }

  if (result.attachments && result.attachments.length > 0) {
    const hasImagesOrPdfs = result.attachments.some(a => a.kind === 'image' || a.kind === 'pdf');
    if (hasImagesOrPdfs) {
      return true;
    }
  }

  return false;
}

function bulletLines(items: string[]): string {
  if (items.length === 0) {
    return '- None';
  }

  return items.map((item) => `- ${item}`).join('\n');
}

function splitSentences(text: string): string[] {
  const normalized = compactWhitespace(text);
  if (!normalized) return [];

  const sentences: string[] = [];
  let remaining = normalized;

  while (remaining.length > 0) {
    const match = remaining.match(/^[^。！？.!?]+[。！？.!?]?(?:\s|$)/);
    if (match) {
      const sentence = match[0].trim();
      sentences.push(sentence);
      remaining = remaining.slice(match[0].length).trim();
    } else {
      sentences.push(remaining.trim());
      break;
    }
  }

  return sentences.filter(Boolean);
}

function limitItemsToMaxSentences(items: string[], maxSentencesPerItem: number, maxItems: number): string[] {
  const result: string[] = [];
  for (const item of items) {
    if (result.length >= maxItems) break;
    const sentences = splitSentences(item);
    const combined = sentences.slice(0, maxSentencesPerItem).join(' ');
    if (combined) {
      result.push(combined);
    }
  }
  return result.slice(0, maxItems);
}

const EVIDENCE_BASIS_DISPLAY: Record<string, string> = {
  first_party_presentation: 'First-party Presentation',
  official_documentation: 'Official Documentation',
  company_announcement: 'Company Announcement',
  news_article: 'News Article',
  personal_blog: 'Personal Blog',
  community_article: 'Community Article',
  secondary_source: 'Secondary Source',
  mixed_sources: 'Mixed Sources',
  unknown: 'Unknown',
};

function mapEvidenceBasisToDisplay(value: string): string {
  const lower = value.trim().toLowerCase().replace(/[-_]/g, '_');
  if (EVIDENCE_BASIS_DISPLAY[lower]) {
    return EVIDENCE_BASIS_DISPLAY[lower];
  }
  return toTitleCase(value);
}

function buildTimeSensitiveRecheckItem(language: PromptLanguage): string | null {
  if (language === 'japanese') {
    return '時点依存の情報です。導入・契約・実装前に公式情報で再確認してください。';
  }
  return 'This is time-sensitive information. Recheck the official source before making a decision.';
}

function isTimeSensitiveEvidenceBasis(evidenceBasis: string[]): boolean {
  const sensitiveKeys = new Set([
    'news_article', 'personal_blog', 'community_article',
    'secondary_source', 'uncited_secondary_source',
  ]);
  return evidenceBasis.some((e) => sensitiveKeys.has(e.trim().toLowerCase().replace(/[-_]/g, '_')));
}

function buildCaveatItems(result: ReviewResult, language: PromptLanguage): string[] {
  const items: string[] = [];

  if (result.credibilityReview && result.credibilityReview.trim()) {
    const sentences = splitSentences(stripLeadingSectionLabel(result.credibilityReview.trim()));
    items.push(...sentences);
  }

  if (result.risksOrGaps && result.risksOrGaps.length > 0) {
    for (const gap of result.risksOrGaps) {
      const cleaned = stripLeadingSectionLabel(gap).trim();
      if (cleaned) items.push(cleaned);
    }
  }

  const showTimeSensitive =
    result.flags.needsVerification ||
    (Array.isArray(result.evidenceBasis) && isTimeSensitiveEvidenceBasis(result.evidenceBasis));

  if (showTimeSensitive) {
    const recheck = buildTimeSensitiveRecheckItem(language);
    if (recheck) {
      items.unshift(recheck);
    }
  }

  return limitItemsToMaxSentences(items, 2, 3);
}

function formatSuggestedUseItems(result: ReviewResult, language: PromptLanguage): string {
  const text = result.practicalityReview?.trim();
  if (!text) return '- None';

  const lines = text
    .split('\n')
    .map((l) => stripLeadingSectionLabel(l.trim()))
    .filter(Boolean);

  if (lines.length === 0) return '- None';

  return bulletLines(lines);
}

function buildConceptCandidatesSection(result: ReviewResult, lang: ResolvedLanguage): string {
  const candidates = result.conceptCandidates;
  if (!candidates || candidates.length === 0) return '';

  const lines = candidates.map(
    (cc) => `- [[${sanitizeAiContent(cc.title)}]] — ${sanitizeAiContent(cc.description)}`,
  );

  return `${h(lang, 'conceptCandidates')}\n\n${lines.join('\n')}\n\n`;
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

  const match = normalized.match(/^.+?[。！？.!?](?:\s|$|(?=[^。！？.!?]))/);
  if (match) {
    return match[0].trim();
  }

  return normalized;
}

function buildDecisionReason(result: ReviewResult): string {
  const explicitDecisionReason = typeof result.decisionReason === 'string' ? compactWhitespace(result.decisionReason) : '';
  if (explicitDecisionReason) {
    return explicitDecisionReason;
  }

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
  if (Array.isArray(result.retentionReasons) && result.retentionReasons.length > 0) {
    return result.retentionReasons;
  }

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
  const items: string[] = [];

  if (Array.isArray(result.evidenceBasis) && result.evidenceBasis.length > 0) {
    items.push(...result.evidenceBasis);
  } else {
    items.push('Not explicitly classified yet');
    const credibilityLead = firstSentence(result.credibilityReview);
    if (credibilityLead) {
      items.push(`Credibility notes: ${credibilityLead}`);
    }
  }

  if (typeof result.extractionConfidence === 'number') {
    const confidencePct = Math.round(result.extractionConfidence * 100);
    const methodStr = result.extractionMethod ? ` via ${result.extractionMethod}` : '';
    items.push(`Source content extraction confidence: ${confidencePct}%${methodStr}`);
  }

  if (Array.isArray(result.extractionWarnings) && result.extractionWarnings.length > 0) {
    for (const warning of result.extractionWarnings) {
      items.push(`Extraction warning: ${warning}`);
    }
  }

  return items;
}

function buildInputProcessingSection(info: InputContentReductionInfo | undefined, lang: ResolvedLanguage): string {
  if (!info || !info.wasTruncated) return '';

  const heading = h(lang, 'inputProcessing');

  if (lang === 'japanese') {
    return [
      '',
      heading,
      '',
      '- AIレビューのコンテキスト上限に収めるため、一部の内容を省略しました。',
      `- 元の文字数: ${info.originalCharCount.toLocaleString()}`,
      `- 送信文字数: ${info.finalCharCount.toLocaleString()}`,
      info.wasFiltered ? `- 除去したノイズ文字数: ${info.removedCharCount.toLocaleString()}` : '',
      '',
    ].filter(Boolean).join('\n');
  }

  return [
    '',
    heading,
    '',
    '- Some content was omitted to fit the AI review context budget.',
    `- Original characters: ${info.originalCharCount.toLocaleString()}`,
    `- Final characters sent: ${info.finalCharCount.toLocaleString()}`,
    info.wasFiltered ? `- Removed noise characters: ${info.removedCharCount.toLocaleString()}` : '',
    '',
  ].filter(Boolean).join('\n');
}

function buildOrganizationItems(result: ReviewResult): string[] {
  return [
    `Suggested Tags: ${result.suggestedTags.length > 0 ? result.suggestedTags.join(', ') : 'None'}`,
    `Suggested Folder: ${result.suggestedFolder ?? 'None'}`,
  ];
}

function formatBytes(bytes?: number): string {
  if (bytes === undefined) return 'unknown';
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  }
  return `${(bytes / 1024).toFixed(0)}KB`;
}

function buildAttachmentSection(result: ReviewResult, lang: ResolvedLanguage): string {
  const summary = result.attachmentSummary;
  const attachments = result.attachments ?? [];
  if (!summary || attachments.length === 0) {
    return '';
  }

  const items = [
    `Total: ${summary.totalCount}`,
    `Images: ${summary.imageCount}`,
    `Videos: ${summary.videoCount}`,
    `Audio: ${summary.audioCount}`,
    `PDFs: ${summary.pdfCount}`,
    `Documents: ${summary.documentCount}`,
    `Archives: ${summary.archiveCount}`,
    `Other: ${summary.otherCount}`,
    `Unresolved: ${summary.unresolvedCount}`,
    ...attachments.slice(0, 12).map((attachment) => {
      let baseStr = `${attachment.displayName} (${attachment.kind}, ${attachment.embedded ? 'embedded' : 'linked'}, ${attachment.exists ? 'resolved' : 'unresolved'})`;
      if (attachment.kind === 'image') {
        if (attachment.wasOptimized) {
          const origSize = formatBytes(attachment.originalBytes);
          const optSize = formatBytes(attachment.optimizedBytes);
          const origDim = `${attachment.originalWidth}x${attachment.originalHeight}`;
          const optDim = `${attachment.optimizedWidth}x${attachment.optimizedHeight}`;
          baseStr += ` | Image optimized for AI review: ${origSize} -> ${optSize}, ${origDim} -> ${optDim}`;
        } else if (attachment.skipReason) {
          baseStr += ` | Image skipped: ${attachment.skipReason}`;
        }
      }
      return baseStr;
    }),
  ];

  if (attachments.length > 12) {
    items.push(`... ${attachments.length - 12} more attachments omitted`);
  }

  return `${h(lang, 'attachments')}\n\n${bulletLines(items)}\n\n`;
}

function joinAsParagraphs(items: string[]): string {
  return items
    .map((item) => item.trim())
    .filter(Boolean)
    .join('\n\n');
}

function buildEvidenceNotes(result: ReviewResult): string {
  const items: string[] = [];
  if (Array.isArray(result.evidenceBasis) && result.evidenceBasis.length > 0) {
    items.push(`Basis: ${result.evidenceBasis.map(mapEvidenceBasisToDisplay).join(', ')}`);
  }
  if (result.structuredSummary?.evidenceMentioned && result.structuredSummary.evidenceMentioned.length > 0) {
    items.push(...result.structuredSummary.evidenceMentioned);
  }
  return bulletLines(items);
}

function buildFollowUpActions(result: ReviewResult, language: PromptLanguage): { required: string[]; optional: string[] } {
  const required: string[] = [];
  const optional: string[] = [];

  const showRequired = shouldShowRequiredActions(result);

  if (showRequired && Array.isArray(result.verificationNeeded)) {
    for (const item of result.verificationNeeded) {
      const cleaned = stripLeadingSectionLabel(item);
      if (cleaned) required.push(cleaned);
    }
  }

  if (Array.isArray(result.nextActions)) {
    for (const item of result.nextActions) {
      const cleaned = stripLeadingSectionLabel(item);
      if (cleaned) optional.push(cleaned);
    }
  }

  if (Array.isArray(result.actionItems)) {
    for (const item of result.actionItems) {
      const formattedItem = formatActionItemForMarkdown(item, language);

      if (showRequired && (item.type === 'verify' || item.type === 'review_attachment')) {
        required.push(formattedItem);
      } else {
        optional.push(formattedItem);
      }
    }
  }

  const uniqueRequired = Array.from(new Set(required.map((s) => s.trim()).filter(Boolean))).slice(0, 3);
  const requiredLower = new Set(uniqueRequired.map((s) => s.toLowerCase()));

  const uniqueOptional = Array.from(new Set(optional.map((s) => s.trim()).filter(Boolean)))
    .filter((opt) => !requiredLower.has(opt.toLowerCase()))
    .slice(0, 3);

  return {
    required: uniqueRequired,
    optional: uniqueOptional,
  };
}

function escapeTableCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, ' ').trim();
}

function buildComparisonTable(table: StructuredSummaryComparisonTable | undefined): string {
  if (!table || table.headers.length === 0 || table.rows.length === 0) {
    return '';
  }

  const headerLine = `| ${table.headers.map(escapeTableCell).join(' | ')} |`;
  const separatorLine = `| ${table.headers.map(() => '---').join(' | ')} |`;
  const rowLines = table.rows.map((row) => `| ${row.map(escapeTableCell).join(' | ')} |`);
  return [headerLine, separatorLine, ...rowLines].join('\n');
}

export function buildReviewContent(result: ReviewResult): string {
  const lang = result.promptLanguage;
  const decisionReason = sanitizeAiContent(buildDecisionReason(result));
  const overview = sanitizeAiContent(stripLeadingSectionLabel(
    result.detailedSummary?.trim() ||
    result.structuredSummary?.centralClaim?.trim() ||
    result.summary?.join(' ') ||
    'None',
  ));

  let takeaways = (result.structuredSummary?.keyPoints ?? []).map(sanitizeAiContent);
  if (takeaways.length === 0) {
    takeaways = (result.summary ?? []).map(sanitizeAiContent);
  }

  const comparisonTable = buildComparisonTable(result.structuredSummary?.comparisonTable);
  const comparisonTableSection = comparisonTable ? `\n${comparisonTable}\n` : '';

  const whyItMatters = sanitizeAiContent(joinAsParagraphs(buildRetentionValueItems(result).map(stripLeadingSectionLabel)) || 'None');

  const caveatsSection = bulletLines(buildCaveatItems(result, lang).map(sanitizeAiContent));

  const suggestedUse = sanitizeAiContent(formatSuggestedUseItems(result, lang));

  const conceptCandidatesSection = buildConceptCandidatesSection(result, lang);

  const evidenceNotes = sanitizeAiContent(buildEvidenceNotes(result));

  const followUp = buildFollowUpActions(result, lang);
  const requiredLines = bulletLines(followUp.required.map(sanitizeAiContent));
  const optionalLines = bulletLines(followUp.optional.map(sanitizeAiContent));

  const tags = result.suggestedTags && result.suggestedTags.length > 0 ? result.suggestedTags.map(sanitizeAiContent).join(', ') : 'None';
  const folder = result.suggestedFolder ? sanitizeAiContent(result.suggestedFolder) : 'None';

  const attachmentSection = buildAttachmentSection(result, lang);

  let extractionYaml = '';
  if (typeof result.extractionConfidence === 'number') {
    extractionYaml += `extraction_confidence: ${result.extractionConfidence}\n`;
  }
  if (result.extractionMethod) {
    extractionYaml += `extraction_method: "${yamlQuote(result.extractionMethod)}"\n`;
  }
  if (Array.isArray(result.extractionWarnings) && result.extractionWarnings.length > 0) {
    extractionYaml += `extraction_warnings:\n${yamlQuoteArray(result.extractionWarnings)}\n`;
  }

  let technicalMetadataStr = `- **Provider**: ${result.provider}
- **Model**: ${result.model}
- **Generated At**: ${result.source.generatedAt}
- **Source Hash**: ${result.source.sourceHash}`;

  if (typeof result.extractionConfidence === 'number') {
    const confidencePct = Math.round(result.extractionConfidence * 100);
    const methodStr = result.extractionMethod ? ` via ${result.extractionMethod}` : '';
    technicalMetadataStr += `\n- **Extraction Confidence**: ${confidencePct}%${methodStr}`;
  }

  if (Array.isArray(result.extractionWarnings) && result.extractionWarnings.length > 0) {
    for (const warning of result.extractionWarnings) {
      technicalMetadataStr += `\n- **Extraction Warning**: ${warning}`;
    }
  }

  const inputProcessingStr = buildInputProcessingSection(result.inputReductionInfo, lang);

  return `---\nsource: "[[${yamlQuote(result.source.noteTitle)}]]"\nsource_path: "${yamlQuote(result.source.notePath)}"\ncontent_type: "${yamlQuote(result.contentType)}"\ninput_profile: "${yamlQuote(result.inputProfile)}"\nfetch_status: "${yamlQuote(result.fetchStatus)}"\ndomain_profile: "${yamlQuote(result.domainProfile)}"\ngenerated_at: "${yamlQuote(result.source.generatedAt)}"\nprovider: "${yamlQuote(result.provider)}"\nmodel: "${yamlQuote(result.model)}"\nsource_hash: "${yamlQuote(result.source.sourceHash)}"\nrecommended_action: "${yamlQuote(result.verdict.recommendedAction)}"\npriority: "${yamlQuote(result.verdict.priority)}"\nneeds_verification: ${String(result.flags.needsVerification)}\n${extractionYaml}---\n\n# AI Review: ${result.source.noteTitle}\n\nSource: [[${result.source.noteTitle}]]\n\n**Verdict**: ${formatVerdictLabel(result.verdict.recommendedAction, result.verdict.priority, lang)}\n\n${h(lang, 'overview')}\n\n${overview}\n\n${h(lang, 'keyTakeaways')}\n\n${bulletLines(takeaways)}\n${comparisonTableSection}\n${h(lang, 'whyItMatters')}\n\n${whyItMatters}\n\n${h(lang, 'caveats')}\n\n${caveatsSection}\n\n${h(lang, 'suggestedUse')}\n\n${suggestedUse}\n\n${conceptCandidatesSection}---\n\n${h(lang, 'reviewDetails')}\n\n${h(lang, 'curationDecision')}\n\n- **Recommended Action**: ${toTitleCase(result.verdict.recommendedAction)}\n- **Priority**: ${toTitleCase(result.verdict.priority)}\n- **Reading Value**: ${toTitleCase(result.verdict.readingValueLabel)}\n- **Saving Value**: ${toTitleCase(result.verdict.savingValueLabel)}\n- **Reliability**: ${toTitleCase(result.verdict.reliabilityLabel)}\n- **Needs Verification**: ${result.flags.needsVerification ? 'Yes' : 'No'}\n- **Reason**: ${decisionReason}\n\n${h(lang, 'evidenceNotes')}\n\n${evidenceNotes}\n\n${h(lang, 'followUpActions')}\n\n${h(lang, 'required')}\n\n${requiredLines}\n\n${h(lang, 'optional')}\n\n${optionalLines}\n\n${attachmentSection}${h(lang, 'organization')}\n\n- **Suggested Tags**: ${tags}\n- **Suggested Folder**: ${folder}\n${inputProcessingStr}${h(lang, 'technicalMetadata')}\n\n${technicalMetadataStr}\n`;
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

function yamlQuote(value: string): string {
  const json = JSON.stringify(String(value ?? ""));
  return json.slice(1, -1);
}

function yamlQuoteArray(items: string[]): string {
  return items.map((i) => `  - ${JSON.stringify(String(i ?? ""))}`).join('\n');
}

export function sanitizeAiContent(text: string): string {
  return text
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/javascript\s*:/gi, 'javascript&#58;')
    .replace(/data\s*:/gi, 'data&#58;')
    .replace(/vbscript\s*:/gi, 'vbscript&#58;')
    .replace(/!\[([^\]]*)\]\(([^)]*)\)/g, '&#33;[$1]($2)')
    .replace(/!\[\[([^\]]+)\]\]/g, '&#33;[[$1]]');
}

function escapeMarkdown(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\n/g, ' ')
    .replace(/\r/g, '')
    .trim();
}

export interface AutoExecuteResultLog {
  recommendedAction: string;
  executed: boolean;
  status: 'success' | 'skipped' | 'failed';
  sourcePath: string;
  destinationPath?: string;
  error?: string;
}

export async function appendAutoExecuteResult(
  app: App,
  reviewNotePath: string,
  params: AutoExecuteResultLog,
  lang: ResolvedLanguage = 'english',
): Promise<void> {
  const file = app.vault.getAbstractFileByPath(reviewNotePath);
  if (!(file instanceof TFile)) {
    return;
  }

  let content = await app.vault.read(file);

  const heading = h(lang, 'autoExecuteResult');

  // Remove existing Auto-execute Result section if it exists
  const sectionHeader = `\n\n${heading}\n`;
  const sectionIndex = content.indexOf(sectionHeader);
  if (sectionIndex !== -1) {
    content = content.slice(0, sectionIndex);
  }

  const lines = [
    `\n${heading}`,
    ``,
    `- Recommended action: ${escapeMarkdown(params.recommendedAction)}`,
    `- Executed: ${params.executed ? 'yes' : 'no'}`,
    `- Source: ${escapeMarkdown(params.sourcePath)}`,
  ];

  if (params.destinationPath) {
    lines.push(`- Destination: ${escapeMarkdown(params.destinationPath)}`);
  }

  lines.push(`- Status: ${params.status}`);

  if (params.error) {
    lines.push(`- Reason: ${escapeMarkdown(params.error)}`);
  }

  lines.push(`- Executed at: ${new Date().toISOString()}`);

  await app.vault.modify(file, content + lines.join('\n') + '\n');
}
