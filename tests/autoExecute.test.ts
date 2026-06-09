import { describe, expect, it, vi, beforeEach } from 'vitest';
import { TFile } from 'obsidian';
import InboxCuratorPlugin from '../main.ts';
import { executeProposedAction } from '../src/actionLayer';
import { runReviewPipeline } from '../src/reviewPipeline';
import { appendAutoExecuteResult } from '../src/reviewWriter';
import { createReviewJob } from '../src/queue/job';

vi.mock('../src/utils/errorLog', () => ({
  logError: vi.fn(),
}));

vi.mock('../src/utils/operationLog', () => ({
  logOperation: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/actionLayer', () => ({
  executeProposedAction: vi.fn(),
}));

vi.mock('../src/reviewPipeline', () => ({
  runReviewPipeline: vi.fn(),
  buildReviewSourceInfo: vi.fn().mockReturnValue({ sourceHash: 'hash123' }),
}));

vi.mock('../src/reviewWriter', () => ({
  writeReviewNote: vi.fn(),
  appendAutoExecuteResult: vi.fn().mockResolvedValue(undefined),
}));

describe('InboxCuratorPlugin Auto-execute', () => {
  let plugin: InboxCuratorPlugin;
  let mockApp: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockApp = {
      vault: {
        read: vi.fn().mockResolvedValue('note content'),
        modify: vi.fn().mockResolvedValue(undefined),
        getAbstractFileByPath: vi.fn().mockImplementation((path) => {
          const file = new TFile();
          file.path = path;
          file.extension = 'md';
          const parts = path.split('/');
          const fileName = parts[parts.length - 1];
          file.name = fileName;
          file.basename = fileName.replace(/\.md$/, '');
          return file;
        }),
        getMarkdownFiles: vi.fn().mockReturnValue([]),
      },
      metadataCache: {
        getFileCache: vi.fn().mockReturnValue(null),
      },
      fileManager: {
        renameFile: vi.fn().mockImplementation(async (file: TFile, newPath: string) => {
          file.path = newPath;
        }),
      },
    };

    plugin = new InboxCuratorPlugin(mockApp, {});
    plugin.settings = {
      ...plugin.settings,
      autoExecuteArchive: false,
      autoExecuteReadLater: false,
      autoExecuteTask: false,
      autoExecuteDeleteCandidate: false,
      reviewOutputFolder: 'AI Reviews',
      readLaterFolder: 'Read Later',
      taskFolder: 'Tasks',
      deleteCandidateFolder: 'Delete Candidates',
    };
    // Initialize the queue to allow pause() mock check
    (plugin as any).reviewQueue = {
      pause: vi.fn(),
    };
  });

  it('runs auto-archive when action is archive and autoExecuteArchive is enabled', async () => {
    plugin.settings.autoExecuteArchive = true;

    vi.mocked(runReviewPipeline).mockResolvedValue({
      ok: true,
      reviewResult: {
        promptLanguage: 'english',
        verdict: {
          reliabilityLabel: 'high',
          recommendedAction: 'archive',
        },
        suggestedFolder: 'References/Archive',
      },
      writeResult: {
        outputPath: 'AI Reviews/my-note.ai-review.md',
      },
    } as any);

    vi.mocked(executeProposedAction).mockResolvedValue({
      success: true,
      status: 'success',
      actionTaken: 'archive',
      destinationPath: 'References/Archive/my-note.md',
    });

    const job = createReviewJob('auto-create', 'Inbox/my-note.md', 0);

    const result = await (plugin as any).runQueuedReviewJob(job);

    expect(result.status).toBe('processed');
    expect(executeProposedAction).toHaveBeenCalledTimes(1);
    expect(executeProposedAction).toHaveBeenCalledWith(mockApp, expect.any(TFile), {
      outputFolder: 'AI Reviews',
      readLaterFolder: 'Read Later',
      taskFolder: 'Tasks',
      deleteCandidateFolder: 'Delete Candidates',
      skipConfirmation: true,
      suggestedFolderBasePath: '',
    });
    expect(appendAutoExecuteResult).toHaveBeenCalledWith(mockApp, 'AI Reviews/my-note.ai-review.md', {
      recommendedAction: 'archive',
      executed: true,
      status: 'success',
      sourcePath: 'Inbox/my-note.md',
      destinationPath: 'References/Archive/my-note.md',
      error: undefined,
    }, 'english');
  });

  it('runs auto-read-later when action is read_later and autoExecuteReadLater is enabled', async () => {
    plugin.settings.autoExecuteReadLater = true;

    vi.mocked(runReviewPipeline).mockResolvedValue({
      ok: true,
      reviewResult: {
        promptLanguage: 'english',
        verdict: {
          reliabilityLabel: 'high',
          recommendedAction: 'read_later',
        },
      },
      writeResult: {
        outputPath: 'AI Reviews/my-note.ai-review.md',
      },
    } as any);

    vi.mocked(executeProposedAction).mockResolvedValue({
      success: true,
      status: 'success',
      actionTaken: 'read_later',
      destinationPath: 'Read Later/my-note.md',
    });

    const job = createReviewJob('auto-create', 'Inbox/my-note.md', 0);

    const result = await (plugin as any).runQueuedReviewJob(job);

    expect(result.status).toBe('processed');
    expect(executeProposedAction).toHaveBeenCalledTimes(1);
    expect(appendAutoExecuteResult).toHaveBeenCalledWith(mockApp, 'AI Reviews/my-note.ai-review.md', {
      recommendedAction: 'read_later',
      executed: true,
      status: 'success',
      sourcePath: 'Inbox/my-note.md',
      destinationPath: 'Read Later/my-note.md',
      error: undefined,
    }, 'english');
  });

  it('runs auto-task when action is task and autoExecuteTask is enabled', async () => {
    plugin.settings.autoExecuteTask = true;

    vi.mocked(runReviewPipeline).mockResolvedValue({
      ok: true,
      reviewResult: {
        promptLanguage: 'english',
        verdict: {
          reliabilityLabel: 'high',
          recommendedAction: 'task',
        },
      },
      writeResult: {
        outputPath: 'AI Reviews/my-note.ai-review.md',
      },
    } as any);

    vi.mocked(executeProposedAction).mockResolvedValue({
      success: true,
      status: 'success',
      actionTaken: 'task',
      destinationPath: 'Tasks/my-note.md',
    });

    const job = createReviewJob('auto-create', 'Inbox/my-note.md', 0);

    const result = await (plugin as any).runQueuedReviewJob(job);

    expect(result.status).toBe('processed');
    expect(executeProposedAction).toHaveBeenCalledTimes(1);
    expect(appendAutoExecuteResult).toHaveBeenCalledWith(mockApp, 'AI Reviews/my-note.ai-review.md', {
      recommendedAction: 'task',
      executed: true,
      status: 'success',
      sourcePath: 'Inbox/my-note.md',
      destinationPath: 'Tasks/my-note.md',
      error: undefined,
    }, 'english');
  });

  it('skips auto-delete-candidate even when autoExecuteDeleteCandidate is enabled', async () => {
    plugin.settings.autoExecuteDeleteCandidate = true;

    vi.mocked(runReviewPipeline).mockResolvedValue({
      ok: true,
      reviewResult: {
        promptLanguage: 'english',
        verdict: {
          reliabilityLabel: 'high',
          recommendedAction: 'delete_candidate',
        },
      },
      writeResult: {
        outputPath: 'AI Reviews/my-note.ai-review.md',
      },
    } as any);

    const job = createReviewJob('auto-create', 'Inbox/my-note.md', 0);

    const result = await (plugin as any).runQueuedReviewJob(job);

    expect(result.status).toBe('processed');
    expect(executeProposedAction).toHaveBeenCalledTimes(0);
  });

  it('does not run auto-execute if the corresponding action toggle is disabled', async () => {
    plugin.settings.autoExecuteArchive = false;
    plugin.settings.autoExecuteReadLater = false;

    vi.mocked(runReviewPipeline).mockResolvedValue({
      ok: true,
      reviewResult: {
        promptLanguage: 'english',
        verdict: {
          recommendedAction: 'archive',
        },
      },
      writeResult: {
        outputPath: 'AI Reviews/my-note.ai-review.md',
      },
    } as any);

    const job = createReviewJob('auto-create', 'Inbox/my-note.md', 0);

    const result = await (plugin as any).runQueuedReviewJob(job);

    expect(result.status).toBe('processed');
    expect(executeProposedAction).not.toHaveBeenCalled();
    expect(appendAutoExecuteResult).not.toHaveBeenCalled();
  });

  it('does not pause the queue but returns failed status if executeProposedAction fails', async () => {
    plugin.settings.autoExecuteArchive = true;

    vi.mocked(runReviewPipeline).mockResolvedValue({
      ok: true,
      reviewResult: {
        promptLanguage: 'english',
        verdict: {
          reliabilityLabel: 'high',
          recommendedAction: 'archive',
        },
      },
      writeResult: {
        outputPath: 'AI Reviews/my-note.ai-review.md',
      },
    } as any);

    vi.mocked(executeProposedAction).mockResolvedValue({
      success: false,
      status: 'failed',
      error: 'Vault is currently locked.',
    });

    const job = createReviewJob('auto-create', 'Inbox/my-note.md', 0);

    const result = await (plugin as any).runQueuedReviewJob(job);

    expect(result.status).toBe('failed');
    expect(result.error).toContain('Auto-execute action archive failed');
    expect(plugin.reviewQueue.pause).not.toHaveBeenCalled();
    expect(appendAutoExecuteResult).toHaveBeenCalledWith(mockApp, 'AI Reviews/my-note.ai-review.md', {
      recommendedAction: 'archive',
      executed: false,
      status: 'failed',
      sourcePath: 'Inbox/my-note.md',
      destinationPath: undefined,
      error: 'Vault is currently locked.',
    }, 'english');
  });

  it('does not pause the queue but returns failed status if folder is not configured (empty string)', async () => {
    plugin.settings.autoExecuteReadLater = true;
    plugin.settings.readLaterFolder = ''; // Empty folder

    vi.mocked(runReviewPipeline).mockResolvedValue({
      ok: true,
      reviewResult: {
        promptLanguage: 'english',
        verdict: {
          reliabilityLabel: 'high',
          recommendedAction: 'read_later',
        },
      },
      writeResult: {
        outputPath: 'AI Reviews/my-note.ai-review.md',
      },
    } as any);

    vi.mocked(executeProposedAction).mockResolvedValue({
      success: false,
      status: 'failed',
      error: 'Read later folder is not configured.',
    });

    const job = createReviewJob('auto-create', 'Inbox/my-note.md', 0);

    const result = await (plugin as any).runQueuedReviewJob(job);

    expect(result.status).toBe('failed');
    expect(result.error).toContain('Auto-execute action read_later failed: Read later folder is not configured.');
    expect(plugin.reviewQueue.pause).not.toHaveBeenCalled();
    expect(appendAutoExecuteResult).toHaveBeenCalledWith(mockApp, 'AI Reviews/my-note.ai-review.md', {
      recommendedAction: 'read_later',
      executed: false,
      status: 'failed',
      sourcePath: 'Inbox/my-note.md',
      destinationPath: undefined,
      error: 'Read later folder is not configured.',
    }, 'english');
  });

  it('handles destination conflict as skipped and does not pause the queue', async () => {
    plugin.settings.autoExecuteArchive = true;

    vi.mocked(runReviewPipeline).mockResolvedValue({
      ok: true,
      reviewResult: {
        promptLanguage: 'english',
        verdict: {
          reliabilityLabel: 'high',
          recommendedAction: 'archive',
        },
      },
      writeResult: {
        outputPath: 'AI Reviews/my-note.ai-review.md',
      },
    } as any);

    vi.mocked(executeProposedAction).mockResolvedValue({
      success: false,
      status: 'skipped',
      error: 'Destination file already exists.',
      destinationPath: 'References/Archive/my-note.md',
    });

    const job = createReviewJob('auto-create', 'Inbox/my-note.md', 0);

    const result = await (plugin as any).runQueuedReviewJob(job);

    expect(result.status).toBe('failed');
    expect(result.error).toContain('Auto-execute action archive failed: Destination file already exists.');
    expect(plugin.reviewQueue.pause).not.toHaveBeenCalled();
    expect(appendAutoExecuteResult).toHaveBeenCalledWith(mockApp, 'AI Reviews/my-note.ai-review.md', {
      recommendedAction: 'archive',
      executed: false,
      status: 'skipped',
      sourcePath: 'Inbox/my-note.md',
      destinationPath: 'References/Archive/my-note.md',
      error: 'Destination file already exists.',
    }, 'english');
  });

  it('continues queue even if appendAutoExecuteResult fails (non-blocking)', async () => {
    plugin.settings.autoExecuteArchive = true;

    vi.mocked(runReviewPipeline).mockResolvedValue({
      ok: true,
      reviewResult: {
        promptLanguage: 'english',
        verdict: {
          recommendedAction: 'archive',
        },
      },
      writeResult: {
        outputPath: 'AI Reviews/my-note.ai-review.md',
      },
    } as any);

    vi.mocked(executeProposedAction).mockResolvedValue({
      success: true,
      status: 'success',
      actionTaken: 'archive',
      destinationPath: 'References/Archive/my-note.md',
    });

    vi.mocked(appendAutoExecuteResult).mockRejectedValue(new Error('Disk write error'));

    const job = createReviewJob('auto-create', 'Inbox/my-note.md', 0);

    const result = await (plugin as any).runQueuedReviewJob(job);

    // Queue continues and the job succeeds since main pipeline and action succeeded
    expect(result.status).toBe('processed');
    expect(plugin.reviewQueue.pause).not.toHaveBeenCalled();
  });

  describe('reliability gate (#5)', () => {
    it('auto-executes when reliabilityLabel is high', async () => {
      plugin.settings.autoExecuteArchive = true;

      vi.mocked(runReviewPipeline).mockResolvedValue({
        ok: true,
        reviewResult: {
        promptLanguage: 'english',
          verdict: {
            recommendedAction: 'archive',
            reliabilityLabel: 'high',
          },
        },
        writeResult: {
          outputPath: 'AI Reviews/my-note.ai-review.md',
        },
      } as any);

      vi.mocked(executeProposedAction).mockResolvedValue({
        success: true,
        status: 'success',
        actionTaken: 'archive',
      });

      const job = createReviewJob('auto-create', 'Inbox/my-note.md', 0);
      const result = await (plugin as any).runQueuedReviewJob(job);

      expect(result.status).toBe('processed');
      expect(executeProposedAction).toHaveBeenCalledTimes(1);
    });

    it('auto-executes archive when reliabilityLabel is medium', async () => {
      plugin.settings.autoExecuteArchive = true;

      vi.mocked(runReviewPipeline).mockResolvedValue({
        ok: true,
        reviewResult: {
        promptLanguage: 'english',
          verdict: {
            recommendedAction: 'archive',
            reliabilityLabel: 'medium',
          },
        },
        writeResult: {
          outputPath: 'AI Reviews/my-note.ai-review.md',
        },
      } as any);

      vi.mocked(executeProposedAction).mockResolvedValue({
        success: true,
        status: 'success',
        actionTaken: 'archive',
      });

      const job = createReviewJob('auto-create', 'Inbox/my-note.md', 0);
      const result = await (plugin as any).runQueuedReviewJob(job);

      expect(result.status).toBe('processed');
      expect(executeProposedAction).toHaveBeenCalledTimes(1);
    });

    it('auto-executes read_later when reliabilityLabel is medium', async () => {
      plugin.settings.autoExecuteReadLater = true;

      vi.mocked(runReviewPipeline).mockResolvedValue({
        ok: true,
        reviewResult: {
        promptLanguage: 'english',
          verdict: {
            recommendedAction: 'read_later',
            reliabilityLabel: 'medium',
          },
        },
        writeResult: {
          outputPath: 'AI Reviews/my-note.ai-review.md',
        },
      } as any);

      vi.mocked(executeProposedAction).mockResolvedValue({
        success: true,
        status: 'success',
        actionTaken: 'read_later',
      });

      const job = createReviewJob('auto-create', 'Inbox/my-note.md', 0);
      const result = await (plugin as any).runQueuedReviewJob(job);

      expect(result.status).toBe('processed');
      expect(executeProposedAction).toHaveBeenCalledTimes(1);
    });

    it('skips task auto-execute when reliabilityLabel is medium', async () => {
      plugin.settings.autoExecuteTask = true;

      vi.mocked(runReviewPipeline).mockResolvedValue({
        ok: true,
        reviewResult: {
        promptLanguage: 'english',
          verdict: {
            recommendedAction: 'task',
            reliabilityLabel: 'medium',
          },
        },
        writeResult: {
          outputPath: 'AI Reviews/my-note.ai-review.md',
        },
      } as any);

      vi.mocked(executeProposedAction).mockResolvedValue({
        success: true,
        status: 'success',
        actionTaken: 'task',
      });

      const job = createReviewJob('auto-create', 'Inbox/my-note.md', 0);
      const result = await (plugin as any).runQueuedReviewJob(job);

      expect(result.status).toBe('processed');
      expect(executeProposedAction).not.toHaveBeenCalled();
    });

    it('skips delete_candidate auto-execute when reliabilityLabel is medium', async () => {
      plugin.settings.autoExecuteDeleteCandidate = true;

      vi.mocked(runReviewPipeline).mockResolvedValue({
        ok: true,
        reviewResult: {
        promptLanguage: 'english',
          verdict: {
            recommendedAction: 'delete_candidate',
            reliabilityLabel: 'medium',
          },
        },
        writeResult: {
          outputPath: 'AI Reviews/my-note.ai-review.md',
        },
      } as any);

      vi.mocked(executeProposedAction).mockResolvedValue({
        success: true,
        status: 'success',
        actionTaken: 'delete_candidate',
      });

      const job = createReviewJob('auto-create', 'Inbox/my-note.md', 0);
      const result = await (plugin as any).runQueuedReviewJob(job);

      expect(result.status).toBe('processed');
      expect(executeProposedAction).not.toHaveBeenCalled();
    });

    it('skips auto-execute when reliabilityLabel is low', async () => {
      plugin.settings.autoExecuteArchive = true;

      vi.mocked(runReviewPipeline).mockResolvedValue({
        ok: true,
        reviewResult: {
        promptLanguage: 'english',
          verdict: {
            recommendedAction: 'archive',
            reliabilityLabel: 'low',
          },
        },
        writeResult: {
          outputPath: 'AI Reviews/my-note.ai-review.md',
        },
      } as any);

      vi.mocked(executeProposedAction).mockResolvedValue({
        success: true,
        status: 'success',
        actionTaken: 'archive',
      });

      const job = createReviewJob('auto-create', 'Inbox/my-note.md', 0);
      const result = await (plugin as any).runQueuedReviewJob(job);

      expect(result.status).toBe('processed');
      expect(executeProposedAction).not.toHaveBeenCalled();
    });

    it('skips auto-execute when reliabilityLabel is missing (effective confidence falls to low)', async () => {
      plugin.settings.autoExecuteArchive = true;

      vi.mocked(runReviewPipeline).mockResolvedValue({
        ok: true,
        reviewResult: {
        promptLanguage: 'english',
          verdict: {
            recommendedAction: 'archive',
          },
        },
        writeResult: {
          outputPath: 'AI Reviews/my-note.ai-review.md',
        },
      } as any);

      vi.mocked(executeProposedAction).mockResolvedValue({
        success: true,
        status: 'success',
        actionTaken: 'archive',
      });

      const job = createReviewJob('auto-create', 'Inbox/my-note.md', 0);
      const result = await (plugin as any).runQueuedReviewJob(job);

      expect(result.status).toBe('processed');
      expect(executeProposedAction).not.toHaveBeenCalled();
    });

    describe('prompt injection gate', () => {
      it('skips task auto-execute when hasPromptInjectionSignals is true', async () => {
        plugin.settings.autoExecuteTask = true;

        vi.mocked(runReviewPipeline).mockResolvedValue({
          ok: true,
          reviewResult: {
        promptLanguage: 'english',
            verdict: {
              recommendedAction: 'task',
              reliabilityLabel: 'high',
            },
          },
          writeResult: {
            outputPath: 'AI Reviews/my-note.ai-review.md',
          },
          hasPromptInjectionSignals: true,
        } as any);

        vi.mocked(executeProposedAction).mockResolvedValue({
          success: true,
          status: 'success',
          actionTaken: 'task',
        });

        const job = createReviewJob('auto-create', 'Inbox/my-note.md', 0);
        const result = await (plugin as any).runQueuedReviewJob(job);

        expect(result.status).toBe('processed');
        expect(executeProposedAction).not.toHaveBeenCalled();
      });

      it('allows archive auto-execute even when hasPromptInjectionSignals is true', async () => {
        plugin.settings.autoExecuteArchive = true;

        vi.mocked(runReviewPipeline).mockResolvedValue({
          ok: true,
          reviewResult: {
        promptLanguage: 'english',
            verdict: {
              recommendedAction: 'archive',
              reliabilityLabel: 'high',
            },
          },
          writeResult: {
            outputPath: 'AI Reviews/my-note.ai-review.md',
          },
          hasPromptInjectionSignals: true,
        } as any);

        vi.mocked(executeProposedAction).mockResolvedValue({
          success: true,
          status: 'success',
          actionTaken: 'archive',
        });

        const job = createReviewJob('auto-create', 'Inbox/my-note.md', 0);
        const result = await (plugin as any).runQueuedReviewJob(job);

        expect(result.status).toBe('processed');
        expect(executeProposedAction).toHaveBeenCalledTimes(1);
      });

      it('allows read_later auto-execute even when hasPromptInjectionSignals is true', async () => {
        plugin.settings.autoExecuteReadLater = true;

        vi.mocked(runReviewPipeline).mockResolvedValue({
          ok: true,
          reviewResult: {
        promptLanguage: 'english',
            verdict: {
              recommendedAction: 'read_later',
              reliabilityLabel: 'high',
            },
          },
          writeResult: {
            outputPath: 'AI Reviews/my-note.ai-review.md',
          },
          hasPromptInjectionSignals: true,
        } as any);

        vi.mocked(executeProposedAction).mockResolvedValue({
          success: true,
          status: 'success',
          actionTaken: 'read_later',
        });

        const job = createReviewJob('auto-create', 'Inbox/my-note.md', 0);
        const result = await (plugin as any).runQueuedReviewJob(job);

        expect(result.status).toBe('processed');
        expect(executeProposedAction).toHaveBeenCalledTimes(1);
      });

      it('allows task auto-execute when hasPromptInjectionSignals is false', async () => {
        plugin.settings.autoExecuteTask = true;

        vi.mocked(runReviewPipeline).mockResolvedValue({
          ok: true,
          reviewResult: {
        promptLanguage: 'english',
            verdict: {
              recommendedAction: 'task',
              reliabilityLabel: 'high',
            },
          },
          writeResult: {
            outputPath: 'AI Reviews/my-note.ai-review.md',
          },
          hasPromptInjectionSignals: false,
        } as any);

        vi.mocked(executeProposedAction).mockResolvedValue({
          success: true,
          status: 'success',
          actionTaken: 'task',
        });

        const job = createReviewJob('auto-create', 'Inbox/my-note.md', 0);
        const result = await (plugin as any).runQueuedReviewJob(job);

        expect(result.status).toBe('processed');
        expect(executeProposedAction).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('shouldSkipWatchedFile', () => {
    it('returns true if existing hash matches current source hash', async () => {
      // Setup mock content with frontmatter hash
      const content = '---\nai_review_source_hash: hash123\n---\nHello';
      mockApp.vault.read.mockResolvedValue(content);

      const file = new TFile();
      file.path = 'Inbox/reviewed-note.md';
      file.extension = 'md';

      const shouldSkip = await (plugin as any).shouldSkipWatchedFile(file);
      expect(shouldSkip).toBe(true);
    });

    it('returns false if existing hash does not match current source hash', async () => {
      const content = '---\nai_review_source_hash: different_hash\n---\nHello';
      mockApp.vault.read.mockResolvedValue(content);

      const file = new TFile();
      file.path = 'Inbox/reviewed-note.md';
      file.extension = 'md';

      const shouldSkip = await (plugin as any).shouldSkipWatchedFile(file);
      expect(shouldSkip).toBe(false);
    });

    it('returns false if there is no existing hash in frontmatter', async () => {
      const content = 'Hello without frontmatter';
      mockApp.vault.read.mockResolvedValue(content);

      const file = new TFile();
      file.path = 'Inbox/reviewed-note.md';
      file.extension = 'md';

      const shouldSkip = await (plugin as any).shouldSkipWatchedFile(file);
      expect(shouldSkip).toBe(false);
    });
  });

  describe('processing marker behavior', () => {
    beforeEach(() => {
      plugin.settings.showProcessingMarkerInFileName = true;
      plugin.settings.autoExecuteArchive = false;
      plugin.settings.autoExecuteReadLater = false;
      plugin.settings.autoExecuteTask = false;
      plugin.settings.autoExecuteDeleteCandidate = false;
    });

    it('renames file with marker prefix when setting is ON and source is auto', async () => {
      vi.mocked(runReviewPipeline).mockResolvedValue({
        ok: true,
        reviewResult: {
        promptLanguage: 'english',
          verdict: { recommendedAction: 'keep_as_reference' },
        },
        writeResult: { outputPath: 'AI Reviews/my-note.ai-review.md' },
      } as any);

      const job = createReviewJob('auto-create', 'Inbox/my-note.md', 0);

      const result = await (plugin as any).runQueuedReviewJob(job);

      expect(result.status).toBe('processed');
      expect(mockApp.fileManager.renameFile).toHaveBeenCalled();
      const renameCall = vi.mocked(mockApp.fileManager.renameFile).mock.calls[0];
      expect(renameCall[1]).toContain('🤖 ');
    });

    it('does NOT rename file when setting is OFF', async () => {
      plugin.settings.showProcessingMarkerInFileName = false;

      vi.mocked(runReviewPipeline).mockResolvedValue({
        ok: true,
        reviewResult: {
        promptLanguage: 'english',
          verdict: { recommendedAction: 'keep_as_reference' },
        },
        writeResult: { outputPath: 'AI Reviews/my-note.ai-review.md' },
      } as any);

      vi.mocked(mockApp.fileManager.renameFile).mockClear();

      const job = createReviewJob('auto-create', 'Inbox/my-note.md', 0);

      const result = await (plugin as any).runQueuedReviewJob(job);

      expect(result.status).toBe('processed');
      expect(mockApp.fileManager.renameFile).not.toHaveBeenCalled();
    });

    it('does NOT rename file for manual watched-folder jobs', async () => {
      vi.mocked(runReviewPipeline).mockResolvedValue({
        ok: true,
        reviewResult: {
        promptLanguage: 'english',
          verdict: { recommendedAction: 'keep_as_reference' },
        },
        writeResult: { outputPath: 'AI Reviews/my-note.ai-review.md' },
      } as any);

      vi.mocked(mockApp.fileManager.renameFile).mockClear();

      const job = createReviewJob('manual-folder', 'Inbox/my-note.md', 0);

      const result = await (plugin as any).runQueuedReviewJob(job);

      expect(result.status).toBe('processed');
      expect(mockApp.fileManager.renameFile).not.toHaveBeenCalled();
    });
  });
});
