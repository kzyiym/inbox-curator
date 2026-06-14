import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TFile } from 'obsidian';
import InboxCuratorPlugin from '../main.ts';
import { executeProposedAction } from '../src/actionLayer';
import { DEFAULT_SETTINGS } from '../src/settings';
import type { ProposedActionItem } from '../src/utils/proposedActions';

const noticeMessages = vi.hoisted(() => [] as string[]);

vi.mock('obsidian', async (importOriginal) => {
  const actual = await importOriginal<typeof import('obsidian')>();
  return {
    ...actual,
    Notice: class {
      constructor(message?: string) {
        if (message) noticeMessages.push(message);
      }
    },
  };
});

vi.mock('../src/actionLayer', () => ({
  executeProposedAction: vi.fn(),
  resolveActionDestination: vi.fn(),
}));

vi.mock('../src/utils/autoSortHistory', () => ({
  appendAutoSortActionRecord: vi.fn().mockResolvedValue(undefined),
  readAutoSortHistory: vi.fn(),
}));

vi.mock('../src/utils/errorLog', () => ({
  logError: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/utils/operationLog', () => ({
  logOperation: vi.fn().mockResolvedValue(undefined),
}));

function createItem(path: string, action: ProposedActionItem['reviewAction']): ProposedActionItem {
  const file = new TFile();
  file.path = path;
  file.name = path.split('/').pop() ?? path;
  file.basename = file.name.replace(/\.md$/, '');
  file.extension = 'md';

  return {
    file,
    notePath: path,
    noteTitle: file.basename,
    action,
    reviewAction: action,
    confidence: 'high',
    reliabilityLabel: 'high',
    decision: {
      wouldAutoExecute: true,
      allowedByAllowlist: true,
    },
    destinationConflict: false,
  };
}

describe('applyProposedActionsFromPanel', () => {
  let plugin: InboxCuratorPlugin;

  beforeEach(() => {
    vi.clearAllMocks();
    noticeMessages.length = 0;

    plugin = new InboxCuratorPlugin({} as any, {} as any);
    plugin.settings = {
      ...DEFAULT_SETTINGS,
      reviewOutputFolder: 'AI Reviews',
      readLaterFolder: 'Read Later',
      taskFolder: 'Tasks',
      deleteCandidateFolder: 'Delete Candidates',
    };
  });

  it('continues applying later items after one action throws', async () => {
    const first = createItem('Inbox/first.md', 'archive');
    const second = createItem('Inbox/second.md', 'read_later');

    vi.mocked(executeProposedAction)
      .mockRejectedValueOnce(new Error('rename failed'))
      .mockResolvedValueOnce({
        success: true,
        status: 'executed',
        actionTaken: 'read_later',
        destinationPath: 'Read Later/second.md',
      });

    await expect(plugin.applyProposedActionsFromPanel([first, second])).resolves.toBeUndefined();

    expect(executeProposedAction).toHaveBeenCalledTimes(2);
    expect(noticeMessages.at(-1)).toContain('1 executed, 0 skipped, 1 failed');
  });

  it('revalidates the current allowlist before executing a stale panel item', async () => {
    plugin.settings.allowActionArchive = false;
    const item = createItem('Inbox/archive.md', 'archive');

    await plugin.applyProposedActionsFromPanel([item]);

    expect(executeProposedAction).not.toHaveBeenCalled();
    expect(noticeMessages.at(-1)).toContain('0 executed, 1 skipped, 0 failed');
  });

  it('does not execute panel actions in review only mode', async () => {
    plugin.settings.reviewMode = 'safe';
    const item = createItem('Inbox/archive.md', 'archive');

    await plugin.applyProposedActionsFromPanel([item]);

    expect(executeProposedAction).not.toHaveBeenCalled();
    expect(noticeMessages.at(-1)).toContain('0 executed, 1 skipped, 0 failed');
  });

  it('counts a user-cancelled action as skipped', async () => {
    const item = createItem('Inbox/delete.md', 'delete_candidate');
    vi.mocked(executeProposedAction).mockResolvedValue({
      success: false,
      status: 'skipped',
      error: 'User cancelled action execution.',
    });

    await plugin.applyProposedActionsFromPanel([item]);

    expect(noticeMessages.at(-1)).toContain('0 executed, 1 skipped, 0 failed');
  });
});
