import { App, TFile } from 'obsidian';
import { parseYamlRecord, stringifyYamlRecord } from './utils/yaml';
import type { ReviewResult } from './types';
import type { ReviewConfidence } from './reviewNormalizer';

const FRONTMATTER_REGEX = /^---\n([\s\S]*?)\n---\n?/;

function parseDocument(content: string): { frontmatter: Record<string, unknown>; body: string } {
  const match = content.match(FRONTMATTER_REGEX);
  if (!match) {
    return { frontmatter: {}, body: content };
  }

  const rawFrontmatter = match[1];
  const frontmatter = parseYamlRecord(rawFrontmatter);
  const body = content.slice(match[0].length);
  return { frontmatter, body };
}

function stringifyDocument(frontmatter: Record<string, unknown>, body: string): string {
  const frontmatterYaml = stringifyYamlRecord(frontmatter);

  return `---\n${frontmatterYaml}\n---\n${body}`;
}

export function readAiReviewSourceHash(content: string): string | undefined {
  const { frontmatter } = parseDocument(content);
  const value = frontmatter.ai_review_source_hash;
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

export async function upsertReviewFrontmatter(
  app: App,
  file: TFile,
  result: ReviewResult,
  confidence?: ReviewConfidence,
  matchesExpectedSource?: (content: string) => boolean,
): Promise<boolean> {
  const updateContent = (content: string): string | null => {
    if (matchesExpectedSource && !matchesExpectedSource(content)) {
      return null;
    }

    const { frontmatter, body } = parseDocument(content);

    frontmatter.ai_review_status = 'done';
    frontmatter.ai_review_processed_at = result.source.generatedAt;
    frontmatter.ai_review_source_hash = result.source.sourceHash;
    frontmatter.ai_review_output_path = result.source.outputPath;
    frontmatter.ai_review_content_type = result.contentType;
    frontmatter.ai_review_input_profile = result.inputProfile;
    frontmatter.ai_review_reading_value = result.scores.readingValue;
    frontmatter.ai_review_saving_value = result.scores.savingValue;
    frontmatter.ai_review_reliability = result.scores.reliability;
    frontmatter.ai_review_practicality = result.scores.practicality;
    frontmatter.ai_review_priority = result.verdict.priority;
    frontmatter.ai_review_recommended_action = result.verdict.recommendedAction;
    frontmatter.ai_review_reliability_label = result.verdict.reliabilityLabel;
    if (confidence) {
      frontmatter.ai_review_confidence = confidence;
    } else {
      delete frontmatter.ai_review_confidence;
    }
    frontmatter.ai_review_needs_verification = result.flags.needsVerification;
    frontmatter.ai_review_delete_candidate = result.flags.deleteCandidate;
    frontmatter.ai_review_version = '1.0.0';
    if (result.attachmentSummary) {
      frontmatter.ai_review_attachment_count = result.attachmentSummary.totalCount;
      frontmatter.ai_review_unresolved_attachment_count = result.attachmentSummary.unresolvedCount;
    } else {
      delete frontmatter.ai_review_attachment_count;
      delete frontmatter.ai_review_unresolved_attachment_count;
    }
    if (result.source.sourceUrl) {
      frontmatter.ai_review_source_url = result.source.sourceUrl;
    } else {
      delete frontmatter.ai_review_source_url;
    }
    if (typeof result.extractionConfidence === 'number') {
      frontmatter.ai_review_extraction_confidence = result.extractionConfidence;
    } else {
      delete frontmatter.ai_review_extraction_confidence;
    }
    if (Array.isArray(result.extractionWarnings) && result.extractionWarnings.length > 0) {
      frontmatter.ai_review_extraction_warnings = result.extractionWarnings;
    } else {
      delete frontmatter.ai_review_extraction_warnings;
    }

    return stringifyDocument(frontmatter, body);
  };

  const vaultWithProcess = app.vault as typeof app.vault & {
    process?: (target: TFile, callback: (content: string) => string) => Promise<string>;
  };

  if (typeof vaultWithProcess.process === 'function') {
    let applied = false;
    await vaultWithProcess.process(file, (content) => {
      const nextContent = updateContent(content);
      if (nextContent === null) {
        return content;
      }
      applied = true;
      return nextContent;
    });
    return applied;
  }

  const content = await app.vault.read(file);
  const nextContent = updateContent(content);
  if (nextContent === null) {
    return false;
  }
  await app.vault.modify(file, nextContent);
  return true;
}
