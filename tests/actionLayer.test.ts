import { describe, expect, it, vi } from 'vitest';
import { TFolder, TFile } from 'obsidian';
import { collectDeleteCandidateTargets, executeProposedAction, isFolderPathWithinBase } from '../src/actionLayer';

let mockConfirmModalBehavior: 'confirm' | 'cancel' = 'confirm';
vi.mock('../src/actionConfirmationModal', () => {
  return {
    ActionConfirmationModal: class {
      app: any;
      message: string;
      onConfirm: () => void;
      onClose: () => void = () => {};
      constructor(app: any, message: string, onConfirm: () => void) {
        this.app = app;
        this.message = message;
        this.onConfirm = onConfirm;
      }
      open() {
        if (mockConfirmModalBehavior === 'confirm') {
          Promise.resolve().then(() => this.onConfirm());
        } else if (mockConfirmModalBehavior === 'cancel') {
          Promise.resolve().then(() => this.onClose());
        }
      }
    }
  };
});

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
      adapter: {
        exists: async () => false,
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
  it('succeeds as no-op when AI-suggested folder does not exist (#6)', async () => {
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
    // Do NOT add the folder — it doesn't exist

    const mock = createMockApp(files);
    const result = await executeProposedAction(mock.app, file, { outputFolder: 'AI Reviews' });

    expect(result.success).toBe(false);
    expect(result.status).toBe('skipped');
    expect(result.actionTaken).toBe('none');
    expect(result.action).toBe('archive');
    expect(mock.renamedFiles).toHaveLength(0);
  });

  it('proceeds with archive when AI-suggested folder already exists (#6)', async () => {
    const file = createMockFile(
      'Inbox/my-note.md',
      `---
ai_review_recommended_action: archive
ai_review_suggested_folder: References/Archive
---
Hello World`,
    );

    const folder = new TFolder();
    folder.path = 'References/Archive';

    const files = new Map<string, TFile>();
    files.set('Inbox/my-note.md', file);
    (files as any).set('References/Archive', folder);

    const mock = createMockApp(files);
    const result = await executeProposedAction(mock.app, file, { outputFolder: 'AI Reviews' });

    expect(result.success).toBe(true);
    expect(result.actionTaken).toBe('archive');
    expect(mock.renamedFiles).toHaveLength(1);
    expect(mock.renamedFiles[0].dest).toBe('References/Archive/my-note.md');
    // ensureFolder is still called but no-op since folder already exists
  });

  it('still creates folder for readLaterFolder even when it does not exist (#6 notch gate)', async () => {
    const file = createMockFile(
      'Inbox/my-note.md',
      `---
ai_review_recommended_action: read_later
---
Read`,
    );

    const files = new Map<string, TFile>();
    files.set('Inbox/my-note.md', file);

    const mock = createMockApp(files);
    const result = await executeProposedAction(mock.app, file, {
      outputFolder: 'AI Reviews',
      readLaterFolder: 'Read Later',
    });

    expect(result.success).toBe(true);
    expect(result.actionTaken).toBe('read_later');
    expect(mock.createdFolders).toContain('Read Later');
  });

  it('still creates folder for taskFolder even when it does not exist (#6 notch gate)', async () => {
    const file = createMockFile(
      'Inbox/my-note.md',
      `---
ai_review_recommended_action: task
---
Task`,
    );

    const files = new Map<string, TFile>();
    files.set('Inbox/my-note.md', file);

    const mock = createMockApp(files);
    const result = await executeProposedAction(mock.app, file, {
      outputFolder: 'AI Reviews',
      taskFolder: 'Tasks',
    });

    expect(result.success).toBe(true);
    expect(result.actionTaken).toBe('task');
    expect(mock.createdFolders).toContain('Tasks');
  });

  it('still creates folder for deleteCandidateFolder even when it does not exist (#6 notch gate)', async () => {
    const file = createMockFile(
      'Inbox/my-note.md',
      `---
ai_review_recommended_action: delete_candidate
---
Trash`,
    );

    const files = new Map<string, TFile>();
    files.set('Inbox/my-note.md', file);

    const mock = createMockApp(files);
    const result = await executeProposedAction(mock.app, file, {
      outputFolder: 'AI Reviews',
      skipConfirmation: true,
      deleteCandidateFolder: 'Delete Candidates',
    });

    expect(result.success).toBe(true);
    expect(result.actionTaken).toBe('delete_candidate');
    expect(mock.createdFolders).toContain('Delete Candidates');
  });

  it('moves note to suggested folder on archive action', async () => {
    const file = createMockFile(
      'Inbox/my-note.md',
      `---
ai_review_recommended_action: archive
ai_review_suggested_folder: References/Archive
---
Hello World`,
    );

    const folder = new TFolder();
    folder.path = 'References/Archive';

    const files = new Map<string, TFile>();
    files.set('Inbox/my-note.md', file);
    (files as any).set('References/Archive', folder);

    const mock = createMockApp(files);
    const result = await executeProposedAction(mock.app, file, { outputFolder: 'AI Reviews' });

    expect(result.success).toBe(true);
    expect(result.actionTaken).toBe('archive');
    expect(mock.renamedFiles).toHaveLength(1);
    expect(mock.renamedFiles[0].dest).toBe('References/Archive/my-note.md');
  });

  it('moves note to suggested folder under base path on archive action', async () => {
    const file = createMockFile(
      'Inbox/my-note.md',
      `---
ai_review_recommended_action: archive
ai_review_suggested_folder: References/Archive
---
Hello World`,
    );

    const folder = new TFolder();
    folder.path = 'ArchiveBase/References/Archive';

    const files = new Map<string, TFile>();
    files.set('Inbox/my-note.md', file);
    (files as any).set('ArchiveBase/References/Archive', folder);

    const mock = createMockApp(files);
    const result = await executeProposedAction(mock.app, file, {
      outputFolder: 'AI Reviews',
      suggestedFolderBasePath: 'ArchiveBase',
    });

    expect(result.success).toBe(true);
    expect(result.actionTaken).toBe('archive');
    expect(mock.renamedFiles).toHaveLength(1);
    expect(mock.renamedFiles[0].dest).toBe('ArchiveBase/References/Archive/my-note.md');
  });

  it('falls back to suggestedFolderBasePath on unsafe suggested folder path', async () => {
    const file = createMockFile(
      'Inbox/my-note.md',
      `---
ai_review_recommended_action: archive
ai_review_suggested_folder: ../Unsafe
---
Hello World`,
    );

    const files = new Map<string, TFile>();
    files.set('Inbox/my-note.md', file);

    const mock = createMockApp(files);
    const result = await executeProposedAction(mock.app, file, {
      outputFolder: 'AI Reviews',
      suggestedFolderBasePath: 'ArchiveBase',
    });

    expect(result.success).toBe(true);
    expect(result.actionTaken).toBe('archive');
    expect(mock.renamedFiles).toHaveLength(1);
    expect(mock.renamedFiles[0].dest).toBe('ArchiveBase/my-note.md');
  });

  it('succeeds as no-op if suggested folder missing and no base path configured', async () => {
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
    expect(result.status).toBe('skipped');
    expect(result.actionTaken).toBe('none');
    expect(result.action).toBe('archive');
    expect(mock.renamedFiles).toHaveLength(0);
  });

  it('uses suggestedFolderBasePath when suggested folder is missing', async () => {
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
    const result = await executeProposedAction(mock.app, file, {
      outputFolder: 'AI Reviews',
      suggestedFolderBasePath: 'ArchiveBase',
    });

    expect(result.success).toBe(true);
    expect(result.actionTaken).toBe('archive');
    expect(mock.renamedFiles).toHaveLength(1);
    expect(mock.renamedFiles[0].dest).toBe('ArchiveBase/my-note.md');
    expect(mock.createdFolders).toContain('ArchiveBase');
  });

  it('succeeds as no-op when target file already exists in destination (collision)', async () => {
    const file = createMockFile(
      'Inbox/my-note.md',
      `---
ai_review_recommended_action: archive
ai_review_suggested_folder: References/Archive
---
Hello World`,
    );

    const existingFile = createMockFile('References/Archive/my-note.md', 'existing content');

    const folder = new TFolder();
    folder.path = 'References/Archive';

    const files = new Map<string, TFile>();
    files.set('Inbox/my-note.md', file);
    files.set('References/Archive/my-note.md', existingFile);
    (files as any).set('References/Archive', folder);

    const mock = createMockApp(files);
    const result = await executeProposedAction(mock.app, file, { outputFolder: 'AI Reviews' });

    expect(result.success).toBe(false);
    expect(result.status).toBe('skipped');
    expect(result.actionTaken).toBe('none');
    expect(result.action).toBe('archive');
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

  it('moves note to configured folder on delete_candidate action with skipConfirmation', async () => {
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
      deleteCandidateFolder: 'Delete Candidates',
    });

    expect(result.success).toBe(true);
    expect(result.actionTaken).toBe('delete_candidate');
    expect(mock.renamedFiles).toHaveLength(1);
    expect(mock.renamedFiles[0].dest).toBe('Delete Candidates/my-note.md');
    expect(mock.createdFolders).toContain('Delete Candidates');
    expect(mock.trashedFiles).toHaveLength(0); // Ensure trash/delete API is NOT called
  });

  it('fails safely for delete_candidate action if deleteCandidateFolder is not provided with skipConfirmation', async () => {
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

    expect(result.success).toBe(false);
    expect(result.error).toBe('Delete candidate folder is not configured.');
    expect(mock.renamedFiles).toHaveLength(0);
    expect(mock.trashedFiles).toHaveLength(0);
  });

  it('fails safely when delete_candidate destination file already exists (collision)', async () => {
    const file = createMockFile(
      'Inbox/my-note.md',
      `---
ai_review_recommended_action: delete_candidate
---
Trash content`,
    );

    const existingFile = createMockFile('Delete Candidates/my-note.md', 'existing content');

    const files = new Map<string, TFile>();
    files.set('Inbox/my-note.md', file);
    files.set('Delete Candidates/my-note.md', existingFile);

    const mock = createMockApp(files);
    const result = await executeProposedAction(mock.app, file, {
      outputFolder: 'AI Reviews',
      skipConfirmation: true,
      deleteCandidateFolder: 'Delete Candidates',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Destination file already exists');
    expect(mock.renamedFiles).toHaveLength(0);
    expect(mock.trashedFiles).toHaveLength(0);
  });

  it('moves note to readLaterFolder on read_later action if provided', async () => {
    const file = createMockFile(
      'Inbox/my-note.md',
      `---
ai_review_recommended_action: read_later
---
Read later content`,
    );

    const files = new Map<string, TFile>();
    files.set('Inbox/my-note.md', file);

    const mock = createMockApp(files);
    const result = await executeProposedAction(mock.app, file, {
      outputFolder: 'AI Reviews',
      readLaterFolder: 'Read Later',
    });

    expect(result.success).toBe(true);
    expect(result.actionTaken).toBe('read_later');
    expect(mock.renamedFiles).toHaveLength(1);
    expect(mock.renamedFiles[0].dest).toBe('Read Later/my-note.md');
    expect(mock.createdFolders).toContain('Read Later');
  });

  it('fails safely for read_later action if readLaterFolder is not provided', async () => {
    const file = createMockFile(
      'Inbox/my-note.md',
      `---
ai_review_recommended_action: read_later
---
Read later content`,
    );

    const files = new Map<string, TFile>();
    files.set('Inbox/my-note.md', file);

    const mock = createMockApp(files);
    const result = await executeProposedAction(mock.app, file, {
      outputFolder: 'AI Reviews',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Read later folder is not configured.');
    expect(mock.renamedFiles).toHaveLength(0);
  });

  it('moves note to taskFolder on task action if provided', async () => {
    const file = createMockFile(
      'Inbox/my-note.md',
      `---
ai_review_recommended_action: task
---
Task content`,
    );

    const files = new Map<string, TFile>();
    files.set('Inbox/my-note.md', file);

    const mock = createMockApp(files);
    const result = await executeProposedAction(mock.app, file, {
      outputFolder: 'AI Reviews',
      taskFolder: 'Tasks',
    });

    expect(result.success).toBe(true);
    expect(result.actionTaken).toBe('task');
    expect(mock.renamedFiles).toHaveLength(1);
    expect(mock.renamedFiles[0].dest).toBe('Tasks/my-note.md');
    expect(mock.createdFolders).toContain('Tasks');
  });

  it('skips safely when the current frontmatter action differs from the expected action', async () => {
    const file = createMockFile(
      'Inbox/my-note.md',
      `---
ai_review_recommended_action: task
---
Task content`,
    );

    const files = new Map<string, TFile>();
    files.set('Inbox/my-note.md', file);

    const mock = createMockApp(files);
    const result = await executeProposedAction(mock.app, file, {
      outputFolder: 'AI Reviews',
      taskFolder: 'Tasks',
      expectedAction: 'archive',
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe('skipped');
    expect(result.actionTaken).not.toBe('task');
    expect(mock.renamedFiles).toHaveLength(0);
    expect(mock.createdFolders).toHaveLength(0);
  });

  it('skips safely when the current action is disabled by the allowlist', async () => {
    const file = createMockFile(
      'Inbox/my-note.md',
      `---
ai_review_recommended_action: task
---
Task content`,
    );

    const files = new Map<string, TFile>();
    files.set('Inbox/my-note.md', file);

    const mock = createMockApp(files);
    const result = await executeProposedAction(mock.app, file, {
      outputFolder: 'AI Reviews',
      taskFolder: 'Tasks',
      allowedActions: ['archive', 'read_later'],
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe('skipped');
    expect(result.error).toContain('disabled by the action allowlist');
    expect(mock.renamedFiles).toHaveLength(0);
    expect(mock.createdFolders).toHaveLength(0);
  });

  it('skips safely when the resolved destination differs from the reviewed destination', async () => {
    const file = createMockFile(
      'Inbox/my-note.md',
      `---
ai_review_recommended_action: archive
ai_review_suggested_folder: References/New
---
Reference content`,
    );
    const currentFolder = new TFolder();
    currentFolder.path = 'References/New';

    const files = new Map<string, TFile>();
    files.set('Inbox/my-note.md', file);
    (files as Map<string, TFile | TFolder>).set('References/New', currentFolder);

    const mock = createMockApp(files);
    const result = await executeProposedAction(mock.app, file, {
      outputFolder: 'AI Reviews',
      expectedAction: 'archive',
      expectedDestinationPath: 'References/Old/my-note.md',
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe('skipped');
    expect(result.error).toContain('destination changed');
    expect(mock.renamedFiles).toHaveLength(0);
    expect(mock.createdFolders).toHaveLength(0);
  });

  it('fails safely for task action if taskFolder is not provided', async () => {
    const file = createMockFile(
      'Inbox/my-note.md',
      `---
ai_review_recommended_action: task
---
Task content`,
    );

    const files = new Map<string, TFile>();
    files.set('Inbox/my-note.md', file);

    const mock = createMockApp(files);
    const result = await executeProposedAction(mock.app, file, {
      outputFolder: 'AI Reviews',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Task folder is not configured.');
    expect(mock.renamedFiles).toHaveLength(0);
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
    const result = await executeProposedAction(mock.app, file, {
      outputFolder: 'AI Reviews',
      allowedActions: ['archive'],
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('is not supported or requires no automated steps');
    expect(mock.renamedFiles).toHaveLength(0);
    expect(mock.trashedFiles).toHaveLength(0);
  });

  it('moves note to delete candidate folder after confirming modal manually', async () => {
    mockConfirmModalBehavior = 'confirm';
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
      deleteCandidateFolder: 'Delete Candidates',
    });

    expect(result.success).toBe(true);
    expect(result.status).toBe('executed');
    expect(result.actionTaken).toBe('delete_candidate');
    expect(mock.renamedFiles).toHaveLength(1);
    expect(mock.renamedFiles[0].dest).toBe('Delete Candidates/my-note.md');
    expect(mock.createdFolders).toContain('Delete Candidates');
  });

  it('reports manual execution modal cancellation as skipped', async () => {
    mockConfirmModalBehavior = 'cancel';
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
      deleteCandidateFolder: 'Delete Candidates',
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe('skipped');
    expect(result.error).toBe('User cancelled action execution.');
    expect(mock.renamedFiles).toHaveLength(0);
  });

  it('handles folder creation error or rename error on delete_candidate gracefully', async () => {
    const file = createMockFile(
      'Inbox/my-note.md',
      `---
ai_review_recommended_action: delete_candidate
---
Trash content`,
    );

    const files = new Map<string, TFile>();
    files.set('Inbox/my-note.md', file);

    const mock = createMockApp(files, {
      createFolder: async () => {
        throw new Error('Disk Full');
      },
    });

    const result = await executeProposedAction(mock.app, file, {
      outputFolder: 'AI Reviews',
      skipConfirmation: true,
      deleteCandidateFolder: 'Delete Candidates',
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe('failed');
    expect(result.error).toBe('Disk Full');
    expect(mock.renamedFiles).toHaveLength(0);
  });
});

describe('executeProposedAction automatic archive destination guard', () => {
  it('allows a descendant of the base path', async () => {
    const file = createMockFile(
      'Inbox/my-note.md',
      `---
ai_review_recommended_action: archive
ai_review_suggested_folder: References/Archive
---
Hello World`,
    );
    const folder = new TFolder();
    folder.path = 'ArchiveBase/References/Archive';

    const files = new Map<string, TFile>();
    files.set('Inbox/my-note.md', file);
    (files as any).set('ArchiveBase/References/Archive', folder);

    const mock = createMockApp(files);
    const result = await executeProposedAction(mock.app, file, {
      outputFolder: 'AI Reviews',
      suggestedFolderBasePath: 'ArchiveBase',
      automatic: true,
    });

    expect(result.success).toBe(true);
    expect(result.actionTaken).toBe('archive');
    expect(mock.renamedFiles).toHaveLength(1);
    expect(mock.renamedFiles[0].dest).toBe('ArchiveBase/References/Archive/my-note.md');
  });

  it('allows a nested descendant of the base path', async () => {
    const file = createMockFile(
      'Inbox/my-note.md',
      `---
ai_review_recommended_action: archive
ai_review_suggested_folder: Tech/Deep
---
Hello World`,
    );
    const folder = new TFolder();
    folder.path = 'ArchiveBase/Tech/Deep';

    const files = new Map<string, TFile>();
    files.set('Inbox/my-note.md', file);
    (files as any).set('ArchiveBase/Tech/Deep', folder);

    const mock = createMockApp(files);
    const result = await executeProposedAction(mock.app, file, {
      outputFolder: 'AI Reviews',
      suggestedFolderBasePath: 'ArchiveBase',
      automatic: true,
    });

    expect(result.success).toBe(true);
    expect(result.actionTaken).toBe('archive');
    expect(mock.renamedFiles[0].dest).toBe('ArchiveBase/Tech/Deep/my-note.md');
  });

  it('allows the base folder itself as the fallback destination', async () => {
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
    const result = await executeProposedAction(mock.app, file, {
      outputFolder: 'AI Reviews',
      suggestedFolderBasePath: 'ArchiveBase',
      automatic: true,
    });

    expect(result.success).toBe(true);
    expect(result.actionTaken).toBe('archive');
    expect(mock.renamedFiles).toHaveLength(1);
    expect(mock.renamedFiles[0].dest).toBe('ArchiveBase/my-note.md');
  });

  it('skips automatic archive when the base path is empty', async () => {
    const file = createMockFile(
      'Inbox/my-note.md',
      `---
ai_review_recommended_action: archive
ai_review_suggested_folder: References/Archive
---
Hello World`,
    );
    const folder = new TFolder();
    folder.path = 'References/Archive';

    const files = new Map<string, TFile>();
    files.set('Inbox/my-note.md', file);
    (files as any).set('References/Archive', folder);

    const mock = createMockApp(files);
    const result = await executeProposedAction(mock.app, file, {
      outputFolder: 'AI Reviews',
      automatic: true,
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe('skipped');
    expect(result.actionTaken).toBe('none');
    expect(result.action).toBe('archive');
    expect(result.error).toContain('base path');
    expect(mock.renamedFiles).toHaveLength(0);
  });

  it('skips automatic archive when the base path is invalid', async () => {
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
    const result = await executeProposedAction(mock.app, file, {
      outputFolder: 'AI Reviews',
      suggestedFolderBasePath: '../Unsafe',
      automatic: true,
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe('skipped');
    expect(mock.renamedFiles).toHaveLength(0);
  });

  it('skips automatic archive when the AI proposal escapes the base without falling back to base', async () => {
    const file = createMockFile(
      'Inbox/my-note.md',
      `---
ai_review_recommended_action: archive
ai_review_suggested_folder: ../Unsafe
---
Hello World`,
    );

    const files = new Map<string, TFile>();
    files.set('Inbox/my-note.md', file);

    const mock = createMockApp(files);
    const result = await executeProposedAction(mock.app, file, {
      outputFolder: 'AI Reviews',
      suggestedFolderBasePath: 'ArchiveBase',
      automatic: true,
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe('skipped');
    expect(result.error).toContain('outside the configured base path');
    expect(mock.renamedFiles).toHaveLength(0);
  });

  it('skips automatic archive when the AI proposal contains an encoded separator', async () => {
    const file = createMockFile(
      'Inbox/my-note.md',
      `---
ai_review_recommended_action: archive
ai_review_suggested_folder: Tech%2f..%2fSecret
---
Hello World`,
    );

    const files = new Map<string, TFile>();
    files.set('Inbox/my-note.md', file);

    const mock = createMockApp(files);
    const result = await executeProposedAction(mock.app, file, {
      outputFolder: 'AI Reviews',
      suggestedFolderBasePath: 'ArchiveBase',
      automatic: true,
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe('skipped');
    expect(mock.renamedFiles).toHaveLength(0);
  });

  it('preserves manual archive semantics (unsafe suggestion still falls back to base)', async () => {
    const file = createMockFile(
      'Inbox/my-note.md',
      `---
ai_review_recommended_action: archive
ai_review_suggested_folder: ../Unsafe
---
Hello World`,
    );

    const files = new Map<string, TFile>();
    files.set('Inbox/my-note.md', file);

    const mock = createMockApp(files);
    const result = await executeProposedAction(mock.app, file, {
      outputFolder: 'AI Reviews',
      suggestedFolderBasePath: 'ArchiveBase',
    });

    expect(result.success).toBe(true);
    expect(result.actionTaken).toBe('archive');
    expect(mock.renamedFiles[0].dest).toBe('ArchiveBase/my-note.md');
  });

  it('compares base containment by path segments (sibling-prefix trap)', () => {
    expect(isFolderPathWithinBase('Archive/note.md', 'Archive')).toBe(true);
    expect(isFolderPathWithinBase('Archive', 'Archive')).toBe(true);
    expect(isFolderPathWithinBase('Archive/Sub/note.md', 'Archive')).toBe(true);
    expect(isFolderPathWithinBase('ArchiveExtra/note.md', 'Archive')).toBe(false);
    expect(isFolderPathWithinBase('Archive2', 'Archive')).toBe(false);
    expect(isFolderPathWithinBase('Other/Archive/note.md', 'Archive')).toBe(false);
  });
});

describe('executeProposedAction automatic action binding (issue #11)', () => {
  it('skips without moving when frontmatter changed from the reviewed archive to delete_candidate', async () => {
    const file = createMockFile(
      'Inbox/my-note.md',
      `---
ai_review_recommended_action: delete_candidate
---
Body`,
    );

    const files = new Map<string, TFile>();
    files.set('Inbox/my-note.md', file);

    const mock = createMockApp(files);
    const result = await executeProposedAction(mock.app, file, {
      outputFolder: 'AI Reviews',
      deleteCandidateFolder: 'Delete Candidates',
      suggestedFolderBasePath: 'ArchiveBase',
      skipConfirmation: true,
      automatic: true,
      expectedAction: 'archive',
      allowedActions: ['archive', 'read_later', 'task', 'delete_candidate'],
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe('skipped');
    expect(result.actionTaken).toBeUndefined();
    expect(result.error).toContain('changed from archive to delete_candidate');
    expect(mock.renamedFiles).toHaveLength(0);
    expect(mock.trashedFiles).toHaveLength(0);
    expect(mock.createdFolders).toHaveLength(0);
  });

  it('never auto-moves a delete_candidate even when it is allowlisted, if it was not the reviewed action', async () => {
    const file = createMockFile(
      'Inbox/my-note.md',
      `---
ai_review_recommended_action: delete_candidate
---
Body`,
    );

    const files = new Map<string, TFile>();
    files.set('Inbox/my-note.md', file);

    const mock = createMockApp(files);
    const result = await executeProposedAction(mock.app, file, {
      outputFolder: 'AI Reviews',
      deleteCandidateFolder: 'Delete Candidates',
      skipConfirmation: true,
      automatic: true,
      expectedAction: 'read_later',
      allowedActions: ['archive', 'read_later', 'task', 'delete_candidate'],
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe('skipped');
    expect(result.actionTaken).toBeUndefined();
    expect(mock.renamedFiles).toHaveLength(0);
    expect(mock.trashedFiles).toHaveLength(0);
  });

  it('still executes an unchanged reviewed archive recommendation', async () => {
    const file = createMockFile(
      'Inbox/my-note.md',
      `---
ai_review_recommended_action: archive
---
Body`,
    );

    const files = new Map<string, TFile>();
    files.set('Inbox/my-note.md', file);

    const mock = createMockApp(files);
    const result = await executeProposedAction(mock.app, file, {
      outputFolder: 'AI Reviews',
      suggestedFolderBasePath: 'ArchiveBase',
      skipConfirmation: true,
      automatic: true,
      expectedAction: 'archive',
      allowedActions: ['archive', 'read_later', 'task'],
    });

    expect(result.success).toBe(true);
    expect(result.status).toBe('executed');
    expect(result.actionTaken).toBe('archive');
    expect(mock.renamedFiles).toHaveLength(1);
    expect(mock.renamedFiles[0].dest).toBe('ArchiveBase/my-note.md');
  });

  it('skips when the reviewed action is no longer permitted by the allowlist', async () => {
    const file = createMockFile(
      'Inbox/my-note.md',
      `---
ai_review_recommended_action: archive
---
Body`,
    );

    const files = new Map<string, TFile>();
    files.set('Inbox/my-note.md', file);

    const mock = createMockApp(files);
    const result = await executeProposedAction(mock.app, file, {
      outputFolder: 'AI Reviews',
      suggestedFolderBasePath: 'ArchiveBase',
      skipConfirmation: true,
      automatic: true,
      expectedAction: 'archive',
      allowedActions: ['read_later', 'task'],
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe('skipped');
    expect(result.error).toContain('disabled by the action allowlist');
    expect(mock.renamedFiles).toHaveLength(0);
    expect(mock.createdFolders).toHaveLength(0);
  });
});

describe('collectDeleteCandidateTargets', () => {
  it('returns only delete_candidate files with their destination and does not mutate', async () => {
    const deleteFile = createMockFile(
      'Inbox/del.md',
      `---
ai_review_recommended_action: delete_candidate
---
Body`,
    );
    const archiveFile = createMockFile(
      'Inbox/arch.md',
      `---
ai_review_recommended_action: archive
---
Body`,
    );

    const files = new Map<string, TFile>();
    files.set('Inbox/del.md', deleteFile);
    files.set('Inbox/arch.md', archiveFile);

    const mock = createMockApp(files);
    const targets = await collectDeleteCandidateTargets(mock.app, [deleteFile, archiveFile], {
      deleteCandidateFolder: 'Delete Candidates',
    });

    expect(targets).toHaveLength(1);
    expect(targets[0].notePath).toBe('Inbox/del.md');
    expect(targets[0].destinationPath).toBe('Delete Candidates/del.md');
    expect(targets[0].destinationFolder).toBe('Delete Candidates');
    expect(mock.renamedFiles).toHaveLength(0);
    expect(mock.trashedFiles).toHaveLength(0);
    expect(mock.createdFolders).toHaveLength(0);
  });

  it('reports no destination when the quarantine folder is not configured', async () => {
    const deleteFile = createMockFile(
      'Inbox/del.md',
      `---
ai_review_recommended_action: delete_candidate
---
Body`,
    );

    const files = new Map<string, TFile>();
    files.set('Inbox/del.md', deleteFile);

    const mock = createMockApp(files);
    const targets = await collectDeleteCandidateTargets(mock.app, [deleteFile], {});

    expect(targets).toHaveLength(1);
    expect(targets[0].destinationPath).toBeUndefined();
    expect(targets[0].destinationFolder).toBe('');
    expect(mock.renamedFiles).toHaveLength(0);
    expect(mock.trashedFiles).toHaveLength(0);
  });
});

describe('executeProposedAction delete_candidate staleness guards', () => {
  it('skips when the action changed before execution', async () => {
    const file = createMockFile(
      'Inbox/my-note.md',
      `---
ai_review_recommended_action: archive
---
Body`,
    );

    const files = new Map<string, TFile>();
    files.set('Inbox/my-note.md', file);

    const mock = createMockApp(files);
    const result = await executeProposedAction(mock.app, file, {
      outputFolder: 'AI Reviews',
      deleteCandidateFolder: 'Delete Candidates',
      skipConfirmation: true,
      expectedAction: 'delete_candidate',
      expectedDestinationPath: 'Delete Candidates/my-note.md',
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe('skipped');
    expect(mock.renamedFiles).toHaveLength(0);
    expect(mock.trashedFiles).toHaveLength(0);
  });

  it('skips when the destination changed before execution', async () => {
    const file = createMockFile(
      'Inbox/my-note.md',
      `---
ai_review_recommended_action: delete_candidate
---
Body`,
    );

    const files = new Map<string, TFile>();
    files.set('Inbox/my-note.md', file);

    const mock = createMockApp(files);
    const result = await executeProposedAction(mock.app, file, {
      outputFolder: 'AI Reviews',
      deleteCandidateFolder: 'Delete Candidates',
      skipConfirmation: true,
      expectedAction: 'delete_candidate',
      expectedDestinationPath: 'Quarantine/my-note.md',
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe('skipped');
    expect(result.error).toContain('destination changed');
    expect(mock.renamedFiles).toHaveLength(0);
    expect(mock.trashedFiles).toHaveLength(0);
  });
});
