import { App, normalizePath, TFile } from 'obsidian';
import type { InboxCuratorProvider } from './settings';
import type {
  CollectionReviewBuildResult,
  CollectionReviewNoteInput,
  CollectionReviewPipelineOptions,
} from './types';
import { ensureFolder } from './utils/folder';
import { postProviderChat, type ProviderChatMessage } from './providerClient';
import { truncateContent } from './utils/contentFilter';

const COLLECTION_REVIEW_OUTPUT_FOLDER = 'Collection Reviews';
const COLLECTION_REVIEW_FILE_PREFIX = 'collection-review-';

export function isCollectionReviewNote(file: TFile): boolean {
  if (file.extension !== 'md') return false;
  const name = file.name;
  if (name.endsWith('.ai-review.md')) return true;
  if (name.startsWith(COLLECTION_REVIEW_FILE_PREFIX)) return true;
  return false;
}

export function isExcludedFromCollectionReview(file: TFile): boolean {
  if (file.extension !== 'md') return true;
  const name = file.name;
  if (name.endsWith('.ai-review.md')) return true;
  if (name.startsWith(COLLECTION_REVIEW_FILE_PREFIX)) return true;
  return false;
}

export async function hasCollectionReviewFrontmatter(app: App, file: TFile): Promise<boolean> {
  try {
    const cache = app.metadataCache.getFileCache(file);
    const frontmatter = cache?.frontmatter;
    if (frontmatter && frontmatter.inbox_curator_review_type === 'collection') {
      return true;
    }
    const content = await app.vault.read(file);
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (fmMatch) {
      return fmMatch[1].includes('inbox_curator_review_type:') && fmMatch[1].includes('collection');
    }
    return false;
  } catch {
    return false;
  }
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function generateTimestampFileName(): string {
  const now = new Date();
  const y = now.getFullYear();
  const mo = pad2(now.getMonth() + 1);
  const d = pad2(now.getDate());
  const h = pad2(now.getHours());
  const mi = pad2(now.getMinutes());
  return `${COLLECTION_REVIEW_FILE_PREFIX}${y}-${mo}-${d}-${h}${mi}.md`;
}

async function resolveUniqueFilePath(app: App, outputFolder: string): Promise<string> {
  await ensureFolder(app, outputFolder);
  const normalizedFolder = normalizePath(outputFolder);
  let fileName = generateTimestampFileName();
  let filePath = `${normalizedFolder}/${fileName}`;
  let counter = 2;
  while (app.vault.getAbstractFileByPath(filePath) instanceof TFile) {
    const baseName = fileName.replace(/\.md$/, '');
    fileName = `${baseName}-${counter}.md`;
    filePath = `${normalizedFolder}/${fileName}`;
    counter += 1;
  }
  return filePath;
}

async function gatherExistingReviewContent(app: App, file: TFile): Promise<string | null> {
  const parentPath = file.path.replace(/\.md$/, '');
  const reviewFileName = `${parentPath}.ai-review.md`;
  const reviewDir = file.parent?.path ?? '';
  const reviewFile = app.vault.getAbstractFileByPath(reviewFileName);
  if (reviewFile instanceof TFile) {
    try {
      const content = await app.vault.read(reviewFile);
      return content;
    } catch {
      return null;
    }
  }
  const altReviewFileName = `${reviewDir}/${file.basename}.ai-review.md`;
  const altReviewFile = app.vault.getAbstractFileByPath(altReviewFileName);
  if (altReviewFile instanceof TFile) {
    try {
      const content = await app.vault.read(altReviewFile);
      return content;
    } catch {
      return null;
    }
  }
  return null;
}

function gatherFrontmatterReviewFields(content: string): string {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return '';
  const fm = fmMatch[1];
  const lines: string[] = [];
  const reviewKeys = [
    'ai_review_reading_value',
    'ai_review_saving_value',
    'ai_review_reliability',
    'ai_review_practicality',
    'ai_review_priority',
    'ai_review_recommended_action',
    'ai_review_content_type',
    'ai_review_input_profile',
    'ai_review_status',
  ];
  for (const line of fm.split('\n')) {
    const trimmed = line.trim();
    for (const key of reviewKeys) {
      if (trimmed.startsWith(`${key}:`)) {
        lines.push(trimmed);
        break;
      }
    }
  }
  return lines.join('\n');
}

async function buildNoteInput(
  app: App,
  file: TFile,
  maxExcerptChars: number,
  useExistingReviewsFirst: boolean,
  includeExcerptWhenNeeded: boolean,
): Promise<CollectionReviewNoteInput> {
  const notePath = file.path;
  const noteTitle = file.basename;

  let hasExistingReview = false;
  let existingReviewContent = '';
  let excerpt = '';
  let frontmatterSummary = '';

  try {
    const content = await app.vault.read(file);
    const body = content.replace(/^---\n[\s\S]*?\n---\n?/, '');
    const fmSummary = gatherFrontmatterReviewFields(content);

    if (useExistingReviewsFirst) {
      const reviewContent = await gatherExistingReviewContent(app, file);
      if (reviewContent) {
        hasExistingReview = true;
        existingReviewContent = reviewContent;
      }
    }

    if (hasExistingReview) {
      if (includeExcerptWhenNeeded && body.trim()) {
        excerpt = truncateContent(body.trim(), Math.min(maxExcerptChars, 500)).content;
      }
    } else {
      frontmatterSummary = fmSummary;
      if (body.trim()) {
        excerpt = truncateContent(body.trim(), maxExcerptChars).content;
      }
    }
  } catch {
    excerpt = '';
  }

  return {
    notePath,
    noteTitle,
    hasExistingReview,
    existingReviewContent,
    frontmatterSummary,
    excerpt,
  };
}

export async function buildCollectionReviewInput(
  app: App,
  files: TFile[],
  options: CollectionReviewPipelineOptions,
): Promise<CollectionReviewBuildResult> {
  if (files.length === 0) {
    return { ok: false, error: 'No notes to review' };
  }

  if (files.length < 2) {
    return { ok: false, error: 'Need at least 2 notes for a collection review' };
  }

  const filteredFiles: TFile[] = [];
  for (const file of files) {
    if (isExcludedFromCollectionReview(file)) continue;
    if (await hasCollectionReviewFrontmatter(app, file)) continue;
    filteredFiles.push(file);
  }

  if (filteredFiles.length === 0) {
    return { ok: false, error: 'All selected notes were excluded (ai-review files, collection review notes, or non-markdown files)' };
  }

  if (filteredFiles.length < 2) {
    return { ok: false, error: 'Only 1 note remains after filtering. Need at least 2 notes for a collection review.' };
  }

  if (filteredFiles.length > options.maxNotes) {
    return { ok: false, error: `Too many notes (${filteredFiles.length}). Maximum is ${options.maxNotes}.` };
  }

  const notesInput: CollectionReviewNoteInput[] = [];
  for (const file of filteredFiles) {
    const input = await buildNoteInput(
      app,
      file,
      options.maxExcerptCharsPerNote,
      options.useExistingReviewsFirst,
      options.includeExcerptWhenNeeded,
    );
    notesInput.push(input);
  }

  const noteListParts: string[] = [];
  for (let i = 0; i < notesInput.length; i++) {
    const note = notesInput[i];
    const parts: string[] = [];
    parts.push(`## Note ${i + 1}: ${note.noteTitle}`);
    parts.push(`Path: ${note.notePath}`);

    if (note.hasExistingReview && note.existingReviewContent) {
      parts.push('');
      parts.push('=== Existing AI Review ===');
      parts.push(note.existingReviewContent.slice(0, 3000));
    } else {
      if (note.frontmatterSummary) {
        parts.push('');
        parts.push('Frontmatter review data:');
        parts.push(note.frontmatterSummary);
      }
      if (note.excerpt) {
        parts.push('');
        parts.push('Note excerpt:');
        parts.push(note.excerpt);
      }
    }
    noteListParts.push(parts.join('\n'));
  }

  const notesBlock = noteListParts.join('\n\n---\n\n');

  const prompt = buildCollectionReviewPrompt(notesBlock, notesInput, options.promptLanguage);

  return {
    ok: true,
    notesInput,
    prompt,
    outputFolder: options.outputFolder,
    sourceType: 'selected_notes',
    sourceFolder: options.outputFolder,
    sourceNotePaths: notesInput.map((n) => n.notePath),
  };
}

function buildCollectionReviewPrompt(
  notesBlock: string,
  notesInput: CollectionReviewNoteInput[],
  promptLanguage: 'english' | 'japanese',
): string {
  const isJapanese = promptLanguage === 'japanese';
  const noteCount = notesInput.length;

  if (isJapanese) {
    return [
      `あなたは複数のノートをまとめて分析するAI編集者です。`,
      ``,
      `${noteCount}件のノートを集合として分析し、以下の項目を含むMarkdownレポートを作成してください。`,
      ``,
      `# Collection Review`,
      ``,
      `## 全体の要約`,
      `このノート群全体の要約を書いてください。ユーザーが読み返したときに「このノート群は何だったか」がすぐ分かるように。`,
      ``,
      `## AI視点での総評`,
      `AI編集者として見た総評を書いてください。単なる要約ではなく、このノート群が全体として何を意味しているかを書いてください。`,
      ``,
      `## 主要テーマ`,
      `主なテーマを箇条書きで挙げてください。`,
      ``,
      `## 重要ノート`,
      `最も重要なノートを選び、それぞれなぜ重要かを書いてください。ノート名は [[ノート名]] の形式で参照してください。`,
      ``,
      `## 関連リンク候補`,
      `関連するノートのペアを挙げ、関連の種類（supports / contradicts / duplicates / extends / same_theme）と理由を書いてください。`,
      ``,
      `## 知識マップ / MOC候補`,
      `MOCタイトル、提案セクション、関連ノートを提案してください。`,
      ``,
      `## 繰り返し現れるモチーフ・パターン`,
      `創作メモ、アイデア断片、日記などのノート群では、似た内容を単純な「重複」として扱わないでください。`,
      `同じテーマへの再訪、視点の変化、時間経過による発展として整理してください。`,
      `例：「Xについて」が3回出てくる → 重複ではなく「Xへの関心の持続と変化」として記述。`,
      ``,
      `## 重複・重なり候補`,
      `明らかな重複または重なりがあるノートのペアと、その理由を書いてください。`,
      `この段階ではマージせず、提案だけを書いてください。`,
      `創作メモや断片的アイデアの類似は「繰り返し現れるモチーフ・パターン」に回してください。`,
      ``,
      `## 矛盾・緊張関係`,
      `矛盾や緊張関係がある論点を書いてください。断定しすぎず、必要に応じて「要確認」と書いてください。`,
      ``,
      `## 次のアクション`,
      `このノート群に即した、具体的で実行可能な次のアクションを提案してください。`,
      `以下のような種類を含めてください：`,
      `- 特定のノートを読む・深掘りする（ノート名を明示）`,
      `- ノート間のつながりを調べる`,
      `- 新しいノートに統合・整理する`,
      `- 追加で調査・検証すべきこと`,
      `- MOCやインデックスノートの作成`,
      ``,
      `重要な注意：`,
      `- 元ノートを変更する前提の出力はしないでください`,
      `- 自動適用ではなく提案として書いてください`,
      `- 矛盾や不確実性は断定しすぎないでください`,
      `- 研究・医療・法律・金融・社会問題などは要検証と書いてください`,
      `- 個人日記や内省系ノートでは診断的・断定的表現を避けてください`,
      `- 次のアクションは必ず出力してください`,
      ``,
      `以下が分析対象のノートです：`,
      ``,
      notesBlock,
    ].join('\n');
  }

  return [
    `You are an AI editor analyzing a collection of notes as a whole.`,
    ``,
    `Analyze the following ${noteCount} notes as a collection and produce a Markdown report with the following sections:`,
    ``,
    `# Collection Review`,
    ``,
    `## Collection Summary`,
    `Write an overall summary of this collection. Make it immediately clear "what is this collection about" when the user re-reads it later.`,
    ``,
    `## AI Perspective`,
    `Write your assessment as an AI editor. Go beyond summarizing — explain what this collection of notes means as a whole.`,
    ``,
    `## Main Themes`,
    `List the main themes as bullet points.`,
    ``,
    `## Key Notes`,
    `Select the most important notes and explain why each is important. Reference notes using [[Note Name]] format.`,
    ``,
    `## Suggested Links`,
    `Suggest related note pairs with link type (supports / contradicts / duplicates / extends / same_theme) and reason.`,
    ``,
    `## Suggested Knowledge Map / MOC`,
    `Suggest a MOC title, proposed sections, and related notes.`,
    ``,
    `## Recurring Themes / Motifs`,
    `For creative notes, idea fragments, journals, or loose thoughts: do NOT treat similar content as simple duplicates.`,
    `Instead, recognize them as revisitations of a theme, shifts in perspective, or evolution over time.`,
    `Example: "Thoughts on X" appears 3 times → describe as "sustained interest in X with evolving views" rather than duplicate.`,
    ``,
    `## Duplicate or Overlap Candidates`,
    `Identify note pairs that are clearly duplicates or substantially overlap, and explain why. Do not merge — only suggest.`,
    `For creative fragments or loose ideas that share a theme, use "Recurring Themes / Motifs" above instead.`,
    ``,
    `## Contradictions or Tensions`,
    `Identify points of contradiction or tension. Do not overstate — use "needs verification" where appropriate.`,
    ``,
    `## Suggested Next Actions`,
    `Propose concrete, actionable next steps specific to these notes — not generic advice.`,
    `Include a mix of:`,
    `- Specific notes to read or explore deeper (name them)`,
    `- Connections to investigate between specific notes`,
    `- Synthesis or consolidation opportunities`,
    `- Gaps that need additional research`,
    `- MOC or index note creation suggestions`,
    ``,
    `Important notes:`,
    `- Do not produce output that assumes source notes will be modified`,
    `- Write as suggestions, not automatic actions`,
    `- Do not overstate contradictions or uncertainties`,
    `- For research, medical, legal, financial, or social topics, note that verification is needed`,
    `- For personal diaries or reflective notes, avoid diagnostic or definitive statements`,
    `- Always include Suggested Next Actions`,
    ``,
    `Here are the notes to analyze:`,
    ``,
    notesBlock,
  ].join('\n');
}

export async function writeCollectionReviewNote(
  app: App,
  outputFolder: string,
  content: string,
  sourceNotes: string[],
  sourceType: 'selected_notes' | 'folder',
  sourceFolder: string,
): Promise<string> {
  const now = new Date().toISOString();
  const sourceNotesYaml = sourceNotes.map((p) => `  - "${p}"`).join('\n');

  const frontmatter = [
    '---',
    'inbox_curator_review_type: collection',
    'created_by: inbox-curator',
    `created_at: ${now}`,
    `source_type: ${sourceType}`,
    `source_folder: "${sourceFolder}"`,
    'source_notes:',
    sourceNotesYaml,
    '---',
    '',
  ].join('\n');

  const fullContent = frontmatter + content;
  const filePath = await resolveUniqueFilePath(app, outputFolder);

  try {
    await ensureFolder(app, outputFolder);
    await app.vault.create(filePath, fullContent);
    return filePath;
  } catch (error) {
    throw new Error(`Failed to write collection review note: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export async function runCollectionReviewPipeline(
  app: App,
  files: TFile[],
  options: CollectionReviewPipelineOptions,
): Promise<{ ok: true; outputPath: string } | { ok: false; error: string }> {
  const buildResult = await buildCollectionReviewInput(app, files, options);
  if (!buildResult.ok) {
    return { ok: false, error: buildResult.error };
  }

  const messages: ProviderChatMessage[] = [
    { role: 'user', content: buildResult.prompt },
  ];

  try {
    if (options.isUnloaded()) {
      return { ok: false, error: 'Plugin unloaded' };
    }

    const apiResult = await postProviderChat({
      provider: options.provider as InboxCuratorProvider,
      endpointUrl: options.endpointUrl,
      model: options.model,
      apiKey: options.apiKey,
      messages,
      temperature: 0.3,
      timeoutMs: options.requestTimeoutMs,
      maxOutputTokens: options.maxOutputTokens,
      openAiTokenLimitParam: options.openAiTokenLimitParam as
        | 'max_tokens'
        | 'max_completion_tokens'
        | 'none'
        | undefined,
    });

    if (!apiResult.ok) {
      return { ok: false, error: `AI request failed: ${apiResult.error}` };
    }

    const aiContent = apiResult.content;

    if (!aiContent || aiContent.trim().length === 0) {
      return { ok: false, error: 'AI returned empty response' };
    }

    const outputPath = await writeCollectionReviewNote(
      app,
      buildResult.outputFolder,
      aiContent,
      buildResult.sourceNotePaths,
      buildResult.sourceType,
      buildResult.sourceFolder,
    );

    return { ok: true, outputPath };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function getFolderMarkdownFilesForCollectionReview(
  app: App,
  folderPath: string,
  options: CollectionReviewPipelineOptions,
): Promise<TFile[]> {
  const normalizedFolder = normalizePath(folderPath);
  const allFiles = app.vault.getMarkdownFiles();
  const result: TFile[] = [];

  for (const file of allFiles) {
    if (file.path.startsWith('.inbox-curator/') || file.path.includes('/.inbox-curator/')) {
      continue;
    }
    if (!file.path.startsWith(`${normalizedFolder}/`) && file.path !== normalizedFolder) {
      continue;
    }
    if (isExcludedFromCollectionReview(file)) {
      continue;
    }
    if (await hasCollectionReviewFrontmatter(app, file)) {
      continue;
    }
    result.push(file);
    if (result.length >= options.maxNotes) {
      break;
    }
  }

  return result;
}
