import { App, TFile } from 'obsidian';
import yaml from 'js-yaml';

export interface ReviewFrontmatterFields {
  outputPath: string;
  contentType: string;
  recommendedAction: string;
  priority: string;
  needsVerification: boolean;
  sourceHash: string;
}

const FRONTMATTER_REGEX = /^---\n([\s\S]*?)\n---\n?/;

function parseDocument(content: string): { frontmatter: Record<string, unknown>; body: string } {
  const match = content.match(FRONTMATTER_REGEX);
  if (!match) {
    return { frontmatter: {}, body: content };
  }

  const rawFrontmatter = match[1];
  const parsed = yaml.load(rawFrontmatter);
  const frontmatter = parsed && typeof parsed === 'object' ? { ...(parsed as Record<string, unknown>) } : {};
  const body = content.slice(match[0].length);
  return { frontmatter, body };
}

function stringifyDocument(frontmatter: Record<string, unknown>, body: string): string {
  const frontmatterYaml = yaml.dump(frontmatter, {
    lineWidth: -1,
    noRefs: true,
    quotingType: '"',
  }).trimEnd();

  return `---\n${frontmatterYaml}\n---\n${body}`;
}

export async function upsertReviewFrontmatter(app: App, file: TFile, fields: ReviewFrontmatterFields): Promise<void> {
  const content = await app.vault.read(file);
  const { frontmatter, body } = parseDocument(content);

  frontmatter.ai_review_status = 'done';
  frontmatter.ai_review_processed_at = new Date().toISOString();
  frontmatter.ai_review_source_hash = fields.sourceHash;
  frontmatter.ai_review_output_path = fields.outputPath;
  frontmatter.ai_review_content_type = fields.contentType;
  frontmatter.ai_review_input_profile = 'plain_note';
  frontmatter.ai_review_reading_value = 50;
  frontmatter.ai_review_saving_value = 50;
  frontmatter.ai_review_reliability = 0;
  frontmatter.ai_review_practicality = 50;
  frontmatter.ai_review_priority = fields.priority;
  frontmatter.ai_review_recommended_action = fields.recommendedAction;
  frontmatter.ai_review_needs_verification = fields.needsVerification;
  frontmatter.ai_review_delete_candidate = false;
  frontmatter.ai_review_version = '0.1.0';

  const nextContent = stringifyDocument(frontmatter, body);
  await app.vault.modify(file, nextContent);
}
