import { describe, expect, it, vi, beforeEach } from 'vitest';
import { TFile } from 'obsidian';
import InboxCuratorPlugin from '../main.ts';
import { executeProposedAction } from '../src/actionLayer';
import { runReviewPipeline } from '../src/reviewPipeline';
import { ReviewJob } from '../src/queue/queueTypes';

vi.mock('../src/actionLayer', () => ({
  executeProposedAction: vi.fn(),
}));

vi.mock('../src/reviewPipeline', () => ({
  runReviewPipeline: vi.fn(),
  buildReviewSourceInfo: vi.fn().mockReturnValue({ sourceHash: 'hash123' }),
}));

describe('InboxCuratorPlugin Auto-execute', () => {
  let plugin: InboxCuratorPlugin;
  let mockApp: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockApp = {
      vault: {
        read: vi.fn().mockResolvedValue('note content'),
        getAbstractFileByPath: vi.fn().mockImplementation((path) => {
          const file = new TFile();
          file.path = path;
          file.extension = 'md';
          return file;
        }),
      },
    };

    plugin = new InboxCuratorPlugin(mockApp, {});
    plugin.settings = {
      ...plugin.settings,
      autoExecuteProposedActions: true,
      reviewOutputFolder: 'AI Reviews',
    };
    // Initialize the queue to allow pause() mock check
    (plugin as any).reviewQueue = {
      pause: vi.fn(),
    };
  });

  it('runs auto-archive when action is archive and source is watched-folder-auto', async () => {
    vi.mocked(runReviewPipeline).mockResolvedValue({
      ok: true,
      reviewResult: {
        verdict: {
          recommendedAction: 'archive',
        },
        suggestedFolder: 'References/Archive',
      },
    } as any);

    vi.mocked(executeProposedAction).mockResolvedValue({
      success: true,
      actionTaken: 'archive',
    });

    const job: ReviewJob = {
      id: 'job-1',
      notePath: 'Inbox/my-note.md',
      source: 'watched-folder-auto',
      delayBeforeStartMs: 0,
    };

    const result = await (plugin as any).runQueuedReviewJob(job);

    expect(result.status).toBe('processed');
    expect(executeProposedAction).toHaveBeenCalledTimes(1);
    expect(executeProposedAction).toHaveBeenCalledWith(mockApp, expect.any(TFile), {
      outputFolder: 'AI Reviews',
      skipConfirmation: true,
    });
  });

  it('does not run auto-archive if recommended action is delete_candidate', async () => {
    vi.mocked(runReviewPipeline).mockResolvedValue({
      ok: true,
      reviewResult: {
        verdict: {
          recommendedAction: 'delete_candidate',
        },
      },
    } as any);

    const job: ReviewJob = {
      id: 'job-1',
      notePath: 'Inbox/my-note.md',
      source: 'watched-folder-auto',
      delayBeforeStartMs: 0,
    };

    const result = await (plugin as any).runQueuedReviewJob(job);

    expect(result.status).toBe('processed');
    expect(executeProposedAction).not.toHaveBeenCalled();
  });

  it('does not run auto-archive if autoExecuteProposedActions is disabled', async () => {
    plugin.settings.autoExecuteProposedActions = false;

    vi.mocked(runReviewPipeline).mockResolvedValue({
      ok: true,
      reviewResult: {
        verdict: {
          recommendedAction: 'archive',
        },
      },
    } as any);

    const job: ReviewJob = {
      id: 'job-1',
      notePath: 'Inbox/my-note.md',
      source: 'watched-folder-auto',
      delayBeforeStartMs: 0,
    };

    const result = await (plugin as any).runQueuedReviewJob(job);

    expect(result.status).toBe('processed');
    expect(executeProposedAction).not.toHaveBeenCalled();
  });

  it('pauses the queue and returns failed status if executeProposedAction fails', async () => {
    vi.mocked(runReviewPipeline).mockResolvedValue({
      ok: true,
      reviewResult: {
        verdict: {
          recommendedAction: 'archive',
        },
      },
    } as any);

    vi.mocked(executeProposedAction).mockResolvedValue({
      success: false,
      error: 'Destination file already exists.',
    });

    const job: ReviewJob = {
      id: 'job-1',
      notePath: 'Inbox/my-note.md',
      source: 'watched-folder-auto',
      delayBeforeStartMs: 0,
    };

    const result = await (plugin as any).runQueuedReviewJob(job);

    expect(result.status).toBe('failed');
    expect(result.error).toContain('Auto-execute archive failed');
    expect(plugin.reviewQueue.pause).toHaveBeenCalledTimes(1);
  });
});
