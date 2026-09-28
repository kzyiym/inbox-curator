import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TFile } from 'obsidian';
import InboxCuratorPlugin from '../main.ts';

const modalState = vi.hoisted(() => ({
  behavior: 'confirm' as 'confirm' | 'cancel',
  openCount: 0,
  items: [] as Array<{ notePath: string; destinationFolder: string }>,
  onConfirmHook: null as (() => void) | null,
}));

vi.mock('../src/deleteCandidateBatchModal', () => ({
  DeleteCandidateBatchConfirmModal: class {
    constructor(
      _app: unknown,
      items: Array<{ notePath: string; destinationFolder: string }>,
      onConfirm: () => void,
      onCancel: () => void,
    ) {
      modalState.items = items;
      (this as unknown as { onConfirm: () => void }).onConfirm = onConfirm;
      (this as unknown as { onCancel: () => void }).onCancel = onCancel;
    }

    open(): void {
      modalState.openCount += 1;
      const self = this as unknown as { onConfirm: () => void; onCancel: () => void };
      if (modalState.behavior === 'confirm') {
        modalState.onConfirmHook?.();
        self.onConfirm();
      } else {
        self.onCancel();
      }
    }
  },
}));

vi.mock('../src/utils/errorLog', () => ({
  logError: vi.fn(),
}));

vi.mock('../src/utils/operationLog', () => ({
  logOperation: vi.fn().mockResolvedValue(undefined),
}));

const DELETE_CONTENT = `---\nai_review_recommended_action: delete_candidate\n---\nBody`;
const ARCHIVE_CONTENT = `---\nai_review_recommended_action: archive\n---\nBody`;

function makeFile(path: string): TFile {
  const file = new TFile();
  file.path = path;
  const parts = path.split('/');
  file.name = parts[parts.length - 1];
  file.basename = file.name.replace(/\.md$/, '');
  file.extension = 'md';
  return file;
}

function makeApp(reads: Record<string, string[]>) {
  const renamed: Array<{ file: TFile; dest: string }> = [];
  const trashed: TFile[] = [];
  const app = {
    vault: {
      read: vi.fn(async (file: TFile) => {
        const queue = reads[file.path];
        if (!queue || queue.length === 0) return '';
        return queue.length > 1 ? (queue.shift() as string) : queue[0];
      }),
      getAbstractFileByPath: vi.fn(() => null),
      createFolder: vi.fn(async () => {}),
      getMarkdownFiles: vi.fn(() => []),
      trash: vi.fn(async (file: TFile) => {
        trashed.push(file);
      }),
    },
    metadataCache: {
      getFileCache: vi.fn(() => null),
    },
    fileManager: {
      renameFile: vi.fn(async (file: TFile, dest: string) => {
        renamed.push({ file, dest });
        file.path = dest;
      }),
    },
  };
  return { app: app as unknown as ConstructorParameters<typeof InboxCuratorPlugin>[0], renamed, trashed };
}

function makePlugin(app: ConstructorParameters<typeof InboxCuratorPlugin>[0]): InboxCuratorPlugin {
  const plugin = new InboxCuratorPlugin(app, {});
  plugin.settings = {
    ...plugin.settings,
    reviewMode: 'standard',
    allowActionArchive: true,
    allowActionReadLater: true,
    allowActionTask: true,
    allowActionDeleteCandidate: true,
    reviewOutputFolder: 'AI Reviews',
    readLaterFolder: 'Read Later',
    taskFolder: 'Tasks',
    deleteCandidateFolder: 'Delete Candidates',
    suggestedFolderBasePath: 'ArchiveBase',
  };
  return plugin;
}

beforeEach(() => {
  modalState.behavior = 'confirm';
  modalState.openCount = 0;
  modalState.items = [];
  modalState.onConfirmHook = null;
  vi.clearAllMocks();
});

describe('executeProposedActionsForFiles delete_candidate confirmation', () => {
  it('confirms once and quarantines every delete_candidate target without deleting anything', async () => {
    const a = makeFile('Inbox/a.md');
    const b = makeFile('Inbox/b.md');
    const c = makeFile('Inbox/c.md');
    const { app, renamed, trashed } = makeApp({
      'Inbox/a.md': [DELETE_CONTENT],
      'Inbox/b.md': [DELETE_CONTENT],
      'Inbox/c.md': [ARCHIVE_CONTENT],
    });
    const plugin = makePlugin(app);

    await plugin.executeProposedActionsForFiles([a, b, c]);

    expect(modalState.openCount).toBe(1);
    expect(modalState.items.map((item) => item.notePath).sort()).toEqual(['Inbox/a.md', 'Inbox/b.md']);
    expect(modalState.items.every((item) => item.destinationFolder === 'Delete Candidates')).toBe(true);

    const destinations = renamed.map((entry) => entry.dest).sort();
    expect(destinations).toContain('Delete Candidates/a.md');
    expect(destinations).toContain('Delete Candidates/b.md');
    expect(destinations).toContain('ArchiveBase/c.md');
    expect(trashed).toHaveLength(0);
  });

  it('cancels the whole batch and moves nothing', async () => {
    const a = makeFile('Inbox/a.md');
    const c = makeFile('Inbox/c.md');
    const { app, renamed, trashed } = makeApp({
      'Inbox/a.md': [DELETE_CONTENT],
      'Inbox/c.md': [ARCHIVE_CONTENT],
    });
    const plugin = makePlugin(app);
    modalState.behavior = 'cancel';

    await plugin.executeProposedActionsForFiles([a, c]);

    expect(modalState.openCount).toBe(1);
    expect(renamed).toHaveLength(0);
    expect(trashed).toHaveLength(0);
  });

  it('does not prompt when no delete_candidate target is present', async () => {
    const c = makeFile('Inbox/c.md');
    const { app, renamed } = makeApp({ 'Inbox/c.md': [ARCHIVE_CONTENT] });
    const plugin = makePlugin(app);

    await plugin.executeProposedActionsForFiles([c]);

    expect(modalState.openCount).toBe(0);
    expect(renamed.map((entry) => entry.dest)).toContain('ArchiveBase/c.md');
  });

  it('skips a target whose action changed after the preview', async () => {
    const a = makeFile('Inbox/a.md');
    const { app, renamed, trashed } = makeApp({ 'Inbox/a.md': [DELETE_CONTENT, ARCHIVE_CONTENT] });
    const plugin = makePlugin(app);

    await plugin.executeProposedActionsForFiles([a]);

    expect(modalState.openCount).toBe(1);
    expect(renamed).toHaveLength(0);
    expect(trashed).toHaveLength(0);
  });

  it('skips a target whose destination changed after the preview', async () => {
    const a = makeFile('Inbox/a.md');
    const { app, renamed, trashed } = makeApp({ 'Inbox/a.md': [DELETE_CONTENT] });
    const plugin = makePlugin(app);
    modalState.onConfirmHook = () => {
      plugin.settings.deleteCandidateFolder = 'Other Quarantine';
    };

    await plugin.executeProposedActionsForFiles([a]);

    expect(modalState.openCount).toBe(1);
    expect(renamed).toHaveLength(0);
    expect(trashed).toHaveLength(0);
  });

  it('does not quarantine a file that becomes delete_candidate after preflight (TOCTOU)', async () => {
    const a = makeFile('Inbox/a.md');
    const x = makeFile('Inbox/x.md');
    const { app, renamed, trashed } = makeApp({
      'Inbox/a.md': [DELETE_CONTENT],
      'Inbox/x.md': [ARCHIVE_CONTENT, DELETE_CONTENT],
    });
    const plugin = makePlugin(app);

    await plugin.executeProposedActionsForFiles([a, x]);

    expect(modalState.openCount).toBe(1);
    expect(modalState.items.map((item) => item.notePath)).toEqual(['Inbox/a.md']);

    const destinations = renamed.map((entry) => entry.dest);
    expect(destinations).toContain('Delete Candidates/a.md');
    expect(destinations).not.toContain('Delete Candidates/x.md');
    expect(trashed).toHaveLength(0);
  });

  it('does not quarantine a late delete_candidate when no target was confirmed', async () => {
    const x = makeFile('Inbox/x.md');
    const { app, renamed, trashed } = makeApp({ 'Inbox/x.md': [ARCHIVE_CONTENT, DELETE_CONTENT] });
    const plugin = makePlugin(app);

    await plugin.executeProposedActionsForFiles([x]);

    expect(modalState.openCount).toBe(0);
    expect(renamed).toHaveLength(0);
    expect(trashed).toHaveLength(0);
  });
});
