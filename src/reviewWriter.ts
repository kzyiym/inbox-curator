import { App, TFile, normalizePath } from 'obsidian';

export interface ReviewNoteResult {
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

function buildReviewContent(sourceFile: TFile): string {
  const generatedAt = new Date().toISOString();
  return `---\nsource: "[[${sourceFile.basename}]]"\nsource_path: "${sourceFile.path}"\ncontent_type: "plain_note"\ninput_profile: "plain_note"\nfetch_status: "not_applicable"\ndomain_profile: "none"\ngenerated_at: "${generatedAt}"\nprovider: "dummy"\nmodel: "dummy"\nrecommended_action: "keep_as_reference"\npriority: "medium"\nneeds_verification: false\n---\n\n# AI Review: ${sourceFile.basename}\n\nSource: [[${sourceFile.basename}]]\n\n## Verdict\n\n- Reading Value: Medium\n- Saving Value: Medium\n- Reliability: Not reviewed\n- Practicality: Medium\n- Recommended Action: keep_as_reference\n- Priority: medium\n\n## Detailed Summary\n\nThis is a dummy review note scaffold for the current MVP.\n\n## Credibility Review\n\nNo AI credibility analysis has been run yet.\n\n## Practicality Review\n\nNo AI practicality analysis has been run yet.\n\n## Next Actions\n\n- Configure an AI provider in a future version.\n- Re-run review after provider support is implemented.\n`;
}

export async function ensureReviewNoteForFile(app: App, sourceFile: TFile, outputFolder: string): Promise<ReviewNoteResult> {
  await ensureFolder(app, outputFolder);

  const outputPath = normalizePath(`${outputFolder}/${sourceFile.basename}.ai-review.md`);
  const content = buildReviewContent(sourceFile);
  const existing = app.vault.getAbstractFileByPath(outputPath);

  if (existing instanceof TFile) {
    await app.vault.modify(existing, content);
    return { outputPath, created: false };
  }

  await app.vault.create(outputPath, content);
  return { outputPath, created: true };
}
