import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TFile, TFolder } from 'obsidian';
import InboxCuratorPlugin from '../main.ts';
import { ReviewQueue } from '../src/queue/reviewQueue';
import { createReviewJob } from '../src/queue/job';
import { runReviewPipeline } from '../src/reviewPipeline';

vi.mock('../src/utils/errorLog', () => ({
  logError: vi.fn(),
}));

vi.mock('../src/utils/operationLog', () => ({
  logOperation: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/reviewPipeline', () => ({
  runReviewPipeline: vi.fn(),
  buildReviewSourceInfo: vi.fn().mockReturnValue({
    sourceHash: 'hash-current',
    notePath: 'Inbox/url-only.md',
    noteTitle: 'url-only',
    outputPath: 'AI Reviews/url-only.ai-review.md',
  }),
}));

vi.mock('../src/actionLayer', () => ({
  executeProposedAction: vi.fn(),
}));

vi.mock('../src/reviewWriter', () => ({
  writeReviewNote: vi.fn(),
  appendAutoExecuteResult: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/utils/autoSortHistory', () => ({
  appendAutoSortActionRecord: vi.fn().mockResolvedValue(undefined),
}));

const AWAITING_RESULT = {
  ok: false,
  error: 'URL-only note without fetched article content.',
  errorCode: 'awaiting_manual_review',
  stage: 'input',
  retryable: false,
} as const;

function makeFile(path: string, mtime = 100): TFile {
  const name = path.split('/').pop() ?? path;
  const file = new TFile();
  file.path = path;
  file.name = name;
  file.basename = name.replace(/\.md$/, '');
  file.extension = 'md';
  file.stat = { mtime, size: 20 } as TFile['stat'];
  return file;
}

function createPlugin(files: Map<string, TFile>) {
  const mockApp = {
    vault: {
      getAbstractFileByPath: vi.fn((path: string) => {
        if (path === 'Inbox') {
          const folder = new TFolder();
          folder.path = 'Inbox';
          folder.name = 'Inbox';
          return folder;
        }
        return files.get(path) ?? null;
      }),
      read: vi.fn().mockResolvedValue('https://example.com/article'),
      getMarkdownFiles: vi.fn(() => Array.from(files.values())),
      on: vi.fn().mockReturnValue({}),
    },
    metadataCache: {
      getFileCache: vi.fn().mockReturnValue(null),
      getFirstLinkpathDest: vi.fn().mockReturnValue(null),
    },
    fileManager: { renameFile: vi.fn() },
    workspace: { on: vi.fn().mockReturnValue({ off: vi.fn() }) },
  };

  const plugin = new InboxCuratorPlugin(mockApp as never, {} as never);
  plugin.settings = {
    ...plugin.settings,
    watchedFolder: 'Inbox',
    reviewOutputFolder: 'AI Reviews',
    enablePolling: true,
    maxNotesPerRun: 50,
    showProcessingMarkerInFileName: false,
    fetchUrlMetadata: true,
    extractUrlArticleText: true,
  };
  (plugin as unknown as { reviewQueue: ReviewQueue }).reviewQueue = new ReviewQueue(
    (job) => (plugin as unknown as { runQueuedReviewJob: (j: unknown) => Promise<never> }).runQueuedReviewJob(job),
    { maxConcurrentJobs: 1 },
  );

  return { plugin, mockApp };
}

describe('URL-only notes in background review', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(runReviewPipeline).mockReset();
  });

  it('marks a background URL-only job awaiting manual review and disables remote fetch', async () => {
    vi.mocked(runReviewPipeline).mockResolvedValue(AWAITING_RESULT as never);
    const file = makeFile('Inbox/url-only.md');
    const { plugin } = createPlugin(new Map([[file.path, file]]));

    const job = createReviewJob('polling', file.path);
    const result = await (plugin as unknown as {
      runQueuedReviewJob: (j: unknown) => Promise<{ status: string }>;
    }).runQueuedReviewJob(job);

    expect(result.status).toBe('awaiting_manual_review');
    const options = vi.mocked(runReviewPipeline).mock.calls[0][2] as {
      allowRemoteUrlFetch?: boolean;
      isBackgroundAutoJob?: boolean;
    };
    expect(options.allowRemoteUrlFetch).toBe(false);
    expect(options.isBackgroundAutoJob).toBe(true);
  });

  it('does not re-attempt an unchanged URL-only note on the next polling sweep', async () => {
    vi.mocked(runReviewPipeline).mockResolvedValue(AWAITING_RESULT as never);
    const file = makeFile('Inbox/url-only.md');
    const { plugin } = createPlugin(new Map([[file.path, file]]));

    await (plugin as any).runPollingSweep();
    await vi.waitFor(() => {
      expect(plugin.reviewQueue.getSnapshot().awaitingManualReviewJobs).toHaveLength(1);
    });

    await (plugin as any).runPollingSweep();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(vi.mocked(runReviewPipeline)).toHaveBeenCalledTimes(1);
  });

  it('re-attempts a URL-only note once its content changes (mtime)', async () => {
    vi.mocked(runReviewPipeline).mockResolvedValue(AWAITING_RESULT as never);
    const file = makeFile('Inbox/url-only.md', 100);
    const { plugin } = createPlugin(new Map([[file.path, file]]));

    await (plugin as any).runPollingSweep();
    await vi.waitFor(() => {
      expect(plugin.reviewQueue.getSnapshot().awaitingManualReviewJobs).toHaveLength(1);
    });

    file.stat.mtime = 200;
    await (plugin as any).runPollingSweep();
    await vi.waitFor(() => {
      expect(vi.mocked(runReviewPipeline)).toHaveBeenCalledTimes(2);
    });
  });

  it('clears the suppression cache and delegates to a foreground manual review', async () => {
    const file = makeFile('Inbox/url-only.md');
    const { plugin } = createPlugin(new Map([[file.path, file]]));
    (plugin as any).backgroundUrlOnlyAwaitSkipCache.set(file.path, file.stat.mtime);
    const reviewFile = vi
      .spyOn(plugin as unknown as { reviewFile: (f: TFile) => Promise<void> }, 'reviewFile')
      .mockResolvedValue(undefined);

    await (plugin as any).reviewAwaitingNote(file.path);

    expect(reviewFile).toHaveBeenCalledWith(file);
    expect((plugin as any).backgroundUrlOnlyAwaitSkipCache.has(file.path)).toBe(false);
  });

  it('runs a foreground manual job with remote URL fetching enabled', async () => {
    vi.mocked(runReviewPipeline).mockResolvedValue({
      ok: false,
      error: 'Note body has no readable content.',
      errorCode: 'insufficient_input',
      stage: 'input',
      retryable: false,
    } as never);
    const file = makeFile('Inbox/url-only.md');
    const { plugin } = createPlugin(new Map([[file.path, file]]));
    (plugin as any).processingInProgress = true;

    const job = createReviewJob('manual-current', file.path);
    await (plugin as unknown as {
      runQueuedReviewJob: (j: unknown) => Promise<unknown>;
    }).runQueuedReviewJob(job);

    const options = vi.mocked(runReviewPipeline).mock.calls[0][2] as {
      allowRemoteUrlFetch?: boolean;
      isBackgroundAutoJob?: boolean;
    };
    expect(options.allowRemoteUrlFetch).toBe(true);
    expect(options.isBackgroundAutoJob).toBe(false);
  });

  it('reports a missing note without throwing when triggered from the queue monitor', async () => {
    const { plugin } = createPlugin(new Map());

    await expect((plugin as any).reviewAwaitingNote('Inbox/gone.md')).resolves.toBeUndefined();
  });
});
