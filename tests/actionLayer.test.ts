import { describe, expect, it, vi } from 'vitest';
import { TFile } from 'obsidian';
import { executeProposedAction } from '../src/actionLayer';

function createMockFile(path: string, content: string): TFile {
  const file = new TFile();
  file.path = path;
  const parts = path.split('/');
  file.name = parts[parts.length - 1];
  file.basename = file.name.replace(/\.md$/, '');
  (file as any).content = content;
  return file;
}

function createMockApp(files: Map<string, TFile>, vaultOverrides = {}) {
  const renamedFiles: { file: TFile; dest: string }[] = [];
  const trashedFiles: { file: TFile; system: boolean }[] = [];
  const createdFolders: string[] = [];

  const app = {
    vault: {
      read: async (file: TFile) => (file as any).content,
      getAbstractFileByPath: (path: string) => files.get(path) || null,
      createFolder: async (path: string) => {
        createdFolders.push(path);
      },
      trash: async (file: TFile, system: boolean) => {
        trashedFiles.push({ file, system });
      },
      ...vaultOverrides,
    },
    fileManager: {
      renameFile: async (file: TFile, dest: string) => {
        renamedFiles.push({ file, dest });
        files.delete(file.path);
        file.path = dest;
        files.set(dest, file);
      },
    },
  };

  return {
    app: app as any,
    renamedFiles,
    trashedFiles,
    createdFolders,
  };
}

describe('executeProposedAction', () => {
  it('moves note to suggested folder on archive action', async () => {
    const file = createMockFile(
      'Inbox/my-note.md',
      `---
ai_review_recommended_action: archive
ai_review_suggested_folder: References/Archive
---
Hello World`,
    );

    const files = new Map<string, TFile>();
    files.set('Inbox/my-note.md', file);

    const mock = createMockApp(files);
    const result = await executeProposedAction(mock.app, file, { outputFolder: 'AI Reviews' });

    expect(result.success).toBe(true);
    expect(result.actionTaken).toBe('archive');
    expect(mock.renamedFiles).toHaveLength(1);
    expect(mock.renamedFiles[0].dest).toBe('References/Archive/my-note.md');
    expect(mock.createdFolders).toContain('References/Archive');
  });

  it('fails safely if suggested folder is missing for archive', async () => {
    const file = createMockFile(
      'Inbox/my-note.md',
      `---
ai_review_recommended_action: archive
---
Hello World`,
    );

    const files = new Map<string, TFile>();
    files.set('Inbox/my-note.md', file);

    const mock = createMockApp(files);
    const result = await executeProposedAction(mock.app, file, { outputFolder: 'AI Reviews' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Suggested folder is missing');
    expect(mock.renamedFiles).toHaveLength(0);
  });

  it('fails safely when target file already exists in destination (collision)', async () => {
    const file = createMockFile(
      'Inbox/my-note.md',
      `---
ai_review_recommended_action: archive
ai_review_suggested_folder: References/Archive
---
Hello World`,
    );

    const existingFile = createMockFile('References/Archive/my-note.md', 'existing content');

    const files = new Map<string, TFile>();
    files.set('Inbox/my-note.md', file);
    files.set('References/Archive/my-note.md', existingFile);

    const mock = createMockApp(files);
    const result = await executeProposedAction(mock.app, file, { outputFolder: 'AI Reviews' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Destination file already exists');
    expect(mock.renamedFiles).toHaveLength(0);
  });

  it('refuses to perform actions on review notes', async () => {
    const file = createMockFile(
      'AI Reviews/my-note.ai-review.md',
      `---
ai_review_recommended_action: archive
ai_review_suggested_folder: References/Archive
---
Hello World`,
    );

    const files = new Map<string, TFile>();
    files.set('AI Reviews/my-note.ai-review.md', file);

    const mock = createMockApp(files);
    const result = await executeProposedAction(mock.app, file, { outputFolder: 'AI Reviews' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Cannot perform action on a review note');
    expect(mock.renamedFiles).toHaveLength(0);
  });

  it('moves note to trash on delete_candidate action with skipConfirmation', async () => {
    const file = createMockFile(
      'Inbox/my-note.md',
      `---
ai_review_recommended_action: delete_candidate
---
Trash content`,
    );

    const files = new Map<string, TFile>();
    files.set('Inbox/my-note.md', file);

    const mock = createMockApp(files);
    const result = await executeProposedAction(mock.app, file, {
      outputFolder: 'AI Reviews',
      skipConfirmation: true,
    });

    expect(result.success).toBe(true);
    expect(result.actionTaken).toBe('delete_candidate');
    expect(mock.trashedFiles).toHaveLength(1);
    expect(mock.trashedFiles[0].system).toBe(true);
  });

  it('ignores unknown or unsupported actions', async () => {
    const file = createMockFile(
      'Inbox/my-note.md',
      `---
ai_review_recommended_action: manual_review
---
Needs check`,
    );

    const files = new Map<string, TFile>();
    files.set('Inbox/my-note.md', file);

    const mock = createMockApp(files);
    const result = await executeProposedAction(mock.app, file, { outputFolder: 'AI Reviews' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('is not supported or requires no automated steps');
    expect(mock.renamedFiles).toHaveLength(0);
    expect(mock.trashedFiles).toHaveLength(0);
  });
});
