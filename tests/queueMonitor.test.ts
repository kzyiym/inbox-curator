import { describe, expect, it, vi, beforeEach } from 'vitest';
import { TFile } from 'obsidian';
import InboxCuratorPlugin from '../main.ts';
import { ReviewQueue } from '../src/queue/reviewQueue';
import { createReviewJob } from '../src/queue/job';
import type { ReviewJob } from '../src/queue/queueTypes';
import { runReviewPipeline } from '../src/reviewPipeline';
import { executeProposedAction } from '../src/actionLayer';

vi.mock('../src/utils/errorLog', () => ({
  logError: vi.fn(),
}));

vi.mock('../src/utils/operationLog', () => ({
  logOperation: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/reviewPipeline', () => ({
  runReviewPipeline: vi.fn(),
  buildReviewSourceInfo: vi.fn().mockReturnValue({ sourceHash: 'hash-current' }),
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

function makeFile(path: string, mtime = 100): TFile {
  const file = new TFile();
  file.path = path;
  file.name = path.split('/').pop() ?? path;
  file.basename = file.name.replace(/\.md$/, '');
  file.extension = 'md';
  file.stat = { mtime, size: 0 } as TFile['stat'];
  return file;
}

function createPlugin(options: {
  files?: Map<string, TFile>;
  frontmatter?: Record<string, unknown> | null;
} = {}) {
  const files = options.files ?? new Map<string, TFile>();
  const mockApp = {
    vault: {
      getAbstractFileByPath: vi.fn((path: string) => files.get(path) ?? null),
      read: vi.fn().mockResolvedValue('note content'),
      getMarkdownFiles: vi.fn().mockReturnValue([]),
    },
    metadataCache: {
      getFileCache: vi.fn().mockReturnValue(options.frontmatter ? { frontmatter: options.frontmatter } : null),
    },
    fileManager: {
      renameFile: vi.fn().mockImplementation(async (file: TFile, newPath: string) => {
        file.path = newPath;
      }),
    },
  };

  const plugin = new InboxCuratorPlugin(mockApp as never, {} as never);
  return { plugin, mockApp };
}

function createGate() {
  const started: string[] = [];
  const resolvers = new Map<string, () => void>();
  const processor = async (job: ReviewJob) => {
    started.push(job.notePath);
    await new Promise<void>((resolve) => resolvers.set(job.notePath, resolve));
    return { status: 'processed' as const };
  };

  return {
    processor,
    started,
    release: (path: string) => resolvers.get(path)?.(),
  };
}

describe('retryFailedReview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips retry when the note no longer exists', async () => {
    const { plugin } = createPlugin();
    const gate = createGate();
    (plugin as unknown as { reviewQueue: ReviewQueue }).reviewQueue = new ReviewQueue(gate.processor, {
      maxConcurrentJobs: 1,
    });

    const outcome = await plugin.retryFailedReview('Inbox/missing.md', 'manual-folder');

    expect(outcome).toEqual({ accepted: false, reason: 'file-missing' });
    expect(plugin.reviewQueue.getSnapshot().pending).toBe(0);
  });

  it('skips retry without starting a job when the note is already reviewed', async () => {
    const file = makeFile('Inbox/done.md', 123);
    const { plugin } = createPlugin({
      files: new Map([[file.path, file]]),
      frontmatter: { ai_review_source_hash: 'hash-x' },
    });
    const gate = createGate();
    (plugin as unknown as { reviewQueue: ReviewQueue; fileSkipCache: Map<string, { mtime: number; reviewHash: string }> }).reviewQueue =
      new ReviewQueue(gate.processor, { maxConcurrentJobs: 1 });
    (plugin as unknown as { fileSkipCache: Map<string, { mtime: number; reviewHash: string }> }).fileSkipCache.set(file.path, {
      mtime: 123,
      reviewHash: 'hash-x',
    });

    const outcome = await plugin.retryFailedReview('Inbox/done.md', 'manual-folder');

    expect(outcome).toEqual({ accepted: false, reason: 'already-reviewed' });
    expect(gate.started).toHaveLength(0);
    expect(plugin.reviewQueue.getSnapshot().pending).toBe(0);
  });

  it('does not double-enqueue a note that is already running', async () => {
    const file = makeFile('Inbox/running.md');
    const { plugin } = createPlugin({ files: new Map([[file.path, file]]) });
    const gate = createGate();
    const queue = new ReviewQueue(gate.processor, { maxConcurrentJobs: 1 });
    (plugin as unknown as { reviewQueue: ReviewQueue }).reviewQueue = queue;

    queue.enqueue(createReviewJob('auto-create', file.path));
    await Promise.resolve();
    await Promise.resolve();
    expect(queue.getSnapshot().running).toBe(1);

    const outcome = await plugin.retryFailedReview(file.path, 'auto-create');

    expect(outcome).toEqual({ accepted: false, reason: 'already-queued' });
    expect(gate.started).toEqual([file.path]);

    gate.release(file.path);
  });

  it('accepts a retry while paused but keeps it pending', async () => {
    const file = makeFile('Inbox/queued.md');
    const { plugin } = createPlugin({ files: new Map([[file.path, file]]) });
    const gate = createGate();
    const queue = new ReviewQueue(gate.processor, { maxConcurrentJobs: 1 });
    (plugin as unknown as { reviewQueue: ReviewQueue }).reviewQueue = queue;

    queue.pause();
    const outcome = await plugin.retryFailedReview(file.path, 'polling');

    expect(outcome).toEqual({ accepted: true });
    expect(queue.getSnapshot().pending).toBe(1);
    expect(queue.getSnapshot().running).toBe(0);
    expect(gate.started).toHaveLength(0);

    queue.resume();
    await Promise.resolve();
    await Promise.resolve();
    expect(gate.started).toEqual([file.path]);

    gate.release(file.path);
  });

  it('preserves the original job source when retrying', async () => {
    const file = makeFile('Inbox/source.md');
    const { plugin } = createPlugin({ files: new Map([[file.path, file]]) });
    const gate = createGate();
    const queue = new ReviewQueue(gate.processor, { maxConcurrentJobs: 1 });
    (plugin as unknown as { reviewQueue: ReviewQueue }).reviewQueue = queue;

    const outcome = await plugin.retryFailedReview(file.path, 'auto-modify');

    expect(outcome).toEqual({ accepted: true });
    const snapshot = queue.getSnapshot();
    const job = snapshot.runningJobs[0] ?? snapshot.pendingJobs[0];
    expect(job?.source).toBe('auto-modify');

    gate.release(file.path);
  });

  it('runs auto-sort on retry when the original source is a watched-folder source', async () => {
    const file = makeFile('Inbox/auto.md');
    const { plugin, mockApp } = createPlugin({ files: new Map([[file.path, file]]) });
    plugin.settings = {
      ...plugin.settings,
      autoExecuteArchive: true,
      reviewOutputFolder: 'AI Reviews',
      readLaterFolder: 'Read Later',
      taskFolder: 'Tasks',
      deleteCandidateFolder: 'Delete Candidates',
    };
    mockApp.vault.read.mockResolvedValue('note content');

    vi.mocked(runReviewPipeline).mockResolvedValue({
      ok: true,
      reviewResult: {
        promptLanguage: 'english',
        verdict: { reliabilityLabel: 'high', recommendedAction: 'archive' },
        suggestedFolder: 'References/Archive',
      },
      writeResult: { outputPath: 'AI Reviews/auto.ai-review.md' },
    } as never);

    vi.mocked(executeProposedAction).mockResolvedValue({
      success: true,
      status: 'executed',
      actionTaken: 'archive',
      destinationPath: 'References/Archive/auto.md',
    } as never);

    const queue = new ReviewQueue(
      async (job) => (plugin as unknown as { runQueuedReviewJob: (j: ReviewJob) => Promise<unknown> }).runQueuedReviewJob(job) as Promise<never>,
      { maxConcurrentJobs: 1 },
    );
    (plugin as unknown as { reviewQueue: ReviewQueue }).reviewQueue = queue;

    const outcome = await plugin.retryFailedReview(file.path, 'auto-create');
    expect(outcome).toEqual({ accepted: true });

    await vi.waitFor(() => expect(executeProposedAction).toHaveBeenCalledTimes(1));
  });
});
