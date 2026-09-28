import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TFile } from 'obsidian';
import InboxCuratorPlugin from '../main.ts';
import { writeReviewDiagnostic } from '../src/utils/reviewDiagnostics';
import { runReviewPipeline } from '../src/reviewPipeline';

const modalState = vi.hoisted(() => ({
  behavior: 'confirm' as 'confirm' | 'cancel',
  consentOpen: 0,
  cleanupOpen: 0,
  cleanupCount: 0,
  onConfirmHook: null as (() => void) | null,
}));

vi.mock('../src/diagnosticCaptureModal', () => ({
  DiagnosticCaptureConsentModal: class {
    constructor(_app: unknown, _folder: string, _command: string, onConfirm: () => void, onCancel: () => void) {
      (this as unknown as { onConfirm: () => void; onCancel: () => void }).onConfirm = onConfirm;
      (this as unknown as { onConfirm: () => void; onCancel: () => void }).onCancel = onCancel;
    }
    open(): void {
      modalState.consentOpen += 1;
      const self = this as unknown as { onConfirm: () => void; onCancel: () => void };
      if (modalState.behavior === 'confirm') self.onConfirm();
      else self.onCancel();
    }
  },
  DiagnosticCleanupConfirmModal: class {
    constructor(_app: unknown, count: number, onConfirm: () => void, onCancel: () => void) {
      modalState.cleanupCount = count;
      (this as unknown as { onConfirm: () => void; onCancel: () => void }).onConfirm = onConfirm;
      (this as unknown as { onConfirm: () => void; onCancel: () => void }).onCancel = onCancel;
    }
    open(): void {
      modalState.cleanupOpen += 1;
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

vi.mock('../src/reviewPipeline', () => ({
  runReviewPipeline: vi.fn(),
  buildReviewSourceInfo: vi.fn().mockReturnValue({ sourceHash: 'hash' }),
}));

vi.mock('../src/utils/reviewDiagnostics', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/utils/reviewDiagnostics')>();
  return {
    ...actual,
    writeReviewDiagnostic: vi.fn().mockResolvedValue('.inbox-curator/diagnostics/review-x.json'),
  };
});

vi.mock('../src/utils/errorLog', () => ({ logError: vi.fn() }));
vi.mock('../src/utils/operationLog', () => ({ logOperation: vi.fn().mockResolvedValue(undefined) }));

function makePlugin(adapter: Record<string, unknown>) {
  const file = new TFile();
  file.path = 'Inbox/note.md';
  file.name = 'note.md';
  file.basename = 'note';
  file.extension = 'md';

  const app = {
    workspace: { getActiveViewOfType: vi.fn() },
    vault: {
      adapter,
      getAbstractFileByPath: vi.fn(() => null),
    },
  };

  const plugin = new InboxCuratorPlugin(app as never, {});
  (plugin as unknown as { getActiveMarkdownFile: () => TFile }).getActiveMarkdownFile = () => file;
  (plugin as unknown as { tryBeginProcessing: () => boolean }).tryBeginProcessing = () => true;
  (plugin as unknown as { updateProcessingStatus: () => void }).updateProcessingStatus = () => {};
  (plugin as unknown as { finishProcessing: () => void }).finishProcessing = () => {};
  (plugin as unknown as { getReviewPipelineOptions: () => Record<string, unknown> }).getReviewPipelineOptions = () => ({});
  return plugin;
}

function diagnosticCapture() {
  return {
    capturedAt: '2026-09-24T01:02:03.000Z',
    operationId: 'diag-1',
    notePath: 'Inbox/note.md',
    noteTitle: 'note',
    provider: 'openai-compatible',
    model: 'gpt-4o-mini',
    reviewMode: 'standard',
    promptLanguage: 'english',
    contentType: 'plain_note',
    inputProfile: 'plain_note',
    fetchStatus: 'not_applicable',
    imageAttachmentCount: 0,
    systemPrompt: 'system',
    userPrompt: 'user',
    rawResponseText: '{}',
    normalized: {
      summary: [],
      readingDecision: 'read_source',
      readingDecisionReason: '',
      takeaways: [],
      recommendedAction: 'archive',
      priority: 'medium',
      credibilityReview: '',
    },
  };
}

beforeEach(() => {
  modalState.behavior = 'confirm';
  modalState.consentOpen = 0;
  modalState.cleanupOpen = 0;
  modalState.cleanupCount = 0;
  modalState.onConfirmHook = null;
  vi.clearAllMocks();
  vi.mocked(runReviewPipeline).mockReset();
});

describe('reviewActiveFileWithDiagnostics consent', () => {
  it('does not run the review or write anything when consent is cancelled', async () => {
    modalState.behavior = 'cancel';
    const plugin = makePlugin({ list: vi.fn(async () => ({ files: [] })), remove: vi.fn() });

    await plugin.reviewActiveFileWithDiagnostics();

    expect(modalState.consentOpen).toBe(1);
    expect(vi.mocked(runReviewPipeline)).not.toHaveBeenCalled();
    expect(vi.mocked(writeReviewDiagnostic)).not.toHaveBeenCalled();
  });

  it('runs the opt-in capture and writes the sanitized diagnostic when confirmed', async () => {
    vi.mocked(runReviewPipeline).mockResolvedValue({ ok: true, diagnostic: diagnosticCapture() } as never);
    const plugin = makePlugin({ list: vi.fn(async () => ({ files: [] })), remove: vi.fn() });

    await plugin.reviewActiveFileWithDiagnostics();

    expect(modalState.consentOpen).toBe(1);
    expect(vi.mocked(runReviewPipeline)).toHaveBeenCalledTimes(1);
    const options = vi.mocked(runReviewPipeline).mock.calls[0][2] as { diagnosticCapture?: boolean };
    expect(options.diagnosticCapture).toBe(true);
    expect(vi.mocked(writeReviewDiagnostic)).toHaveBeenCalledTimes(1);
  });

  it('does not write when the capture produced no diagnostic', async () => {
    vi.mocked(runReviewPipeline).mockResolvedValue({ ok: true } as never);
    const plugin = makePlugin({ list: vi.fn(async () => ({ files: [] })), remove: vi.fn() });

    await plugin.reviewActiveFileWithDiagnostics();

    expect(vi.mocked(writeReviewDiagnostic)).not.toHaveBeenCalled();
  });
});

describe('cleanupReviewDiagnostics', () => {
  it('confirms and removes only diagnostic review files', async () => {
    const remove = vi.fn(async () => {});
    const list = vi.fn(async () => ({
      files: ['.inbox-curator/diagnostics/review-1.json', '.inbox-curator/diagnostics/other.json'],
      folders: [],
    }));
    const exists = vi.fn(async () => true);
    const plugin = makePlugin({ list, exists, remove });

    await plugin.cleanupReviewDiagnostics();

    expect(modalState.cleanupOpen).toBe(1);
    expect(modalState.cleanupCount).toBe(1);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith('.inbox-curator/diagnostics/review-1.json');
  });

  it('removes only the confirmed files even if new diagnostics appear while the modal is open', async () => {
    let files = ['.inbox-curator/diagnostics/review-1.json'];
    const list = vi.fn(async () => ({ files: [...files], folders: [] }));
    const remove = vi.fn(async () => {});
    const exists = vi.fn(async () => true);
    const plugin = makePlugin({ list, exists, remove });
    modalState.onConfirmHook = () => {
      files = ['.inbox-curator/diagnostics/review-1.json', '.inbox-curator/diagnostics/review-2.json'];
    };

    await plugin.cleanupReviewDiagnostics();

    expect(modalState.cleanupCount).toBe(1);
    expect(list).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith('.inbox-curator/diagnostics/review-1.json');
    expect(remove).not.toHaveBeenCalledWith('.inbox-curator/diagnostics/review-2.json');
  });

  it('reports a confirmed file that disappeared before removal without deleting others', async () => {
    const remove = vi.fn(async () => {});
    const exists = vi.fn(async () => false);
    const list = vi.fn(async () => ({ files: ['.inbox-curator/diagnostics/review-1.json'], folders: [] }));
    const plugin = makePlugin({ list, exists, remove });

    await plugin.cleanupReviewDiagnostics();

    expect(modalState.cleanupOpen).toBe(1);
    expect(exists).toHaveBeenCalledWith('.inbox-curator/diagnostics/review-1.json');
    expect(remove).not.toHaveBeenCalled();
  });

  it('moves nothing when cleanup is cancelled', async () => {
    modalState.behavior = 'cancel';
    const remove = vi.fn(async () => {});
    const list = vi.fn(async () => ({ files: ['.inbox-curator/diagnostics/review-1.json'], folders: [] }));
    const exists = vi.fn(async () => true);
    const plugin = makePlugin({ list, exists, remove });

    await plugin.cleanupReviewDiagnostics();

    expect(modalState.cleanupOpen).toBe(1);
    expect(remove).not.toHaveBeenCalled();
  });

  it('does not prompt or remove when there are no diagnostic files', async () => {
    const remove = vi.fn(async () => {});
    const list = vi.fn(async () => ({ files: ['.inbox-curator/diagnostics/other.json'], folders: [] }));
    const exists = vi.fn(async () => true);
    const plugin = makePlugin({ list, exists, remove });

    await plugin.cleanupReviewDiagnostics();

    expect(modalState.cleanupOpen).toBe(0);
    expect(remove).not.toHaveBeenCalled();
  });
});
