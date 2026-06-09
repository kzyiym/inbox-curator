import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { TFile } from 'obsidian';
import { extractPdfText } from '../src/utils/pdf';
import { buildReviewModelInputPayload } from '../src/reviewPipeline';
import { extractAttachmentContext } from '../src/attachmentContext';

vi.mock('../src/attachmentContext', () => ({
  extractAttachmentContext: vi.fn(),
}));

function createMockPdfFile(path: string, size: number): TFile {
  const file = new TFile();
  file.path = path;
  file.name = path.split('/').pop() || '';
  file.stat = { mtime: 0, size };
  return file;
}

const originalWindow = { ...window };

describe('extractPdfText Utility', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    (window as any).pdfjsLib = undefined;
  });

  afterEach(() => {
    (window as any).pdfjsLib = (originalWindow as any).pdfjsLib;
  });

  it('returns warning when window.pdfjsLib is unavailable', async () => {
    const file = createMockPdfFile('attachments/document.pdf', 1000);
    const mockApp = {
      vault: {
        readBinary: vi.fn(),
      },
    };
    const res = await extractPdfText(mockApp as any, file);
    expect(res.ok).toBe(false);
    expect(res.warning).toContain('not available in this Obsidian environment');
    expect(mockApp.vault.readBinary).not.toHaveBeenCalled();
  });

  it('skips before readBinary when PDF exceeds maxBytes', async () => {
    const file = createMockPdfFile('attachments/document.pdf', 10 * 1024 * 1024); // 10MB
    const mockApp = {
      vault: {
        readBinary: vi.fn(),
      },
    };
    (window as any).pdfjsLib = {};
    const res = await extractPdfText(mockApp as any, file, { maxBytes: 5 * 1024 * 1024 });
    expect(res.ok).toBe(false);
    expect(res.warning).toContain('exceeds size limit');
    expect(mockApp.vault.readBinary).not.toHaveBeenCalled();
  });

  it('extracts PDF text successfully with mocked pdfjsLib', async () => {
    const file = createMockPdfFile('attachments/document.pdf', 1000);
    const mockApp = {
      vault: {
        readBinary: vi.fn().mockResolvedValue(new ArrayBuffer(10)),
      },
    };

    const mockPage = {
      getTextContent: vi.fn().mockResolvedValue({
        items: [{ str: 'Hello' }, { str: 'World' }],
      }),
    };

    const mockPdf = {
      numPages: 2,
      getPage: vi.fn().mockResolvedValue(mockPage),
    };

    (window as any).pdfjsLib = {
      getDocument: vi.fn().mockReturnValue({
        promise: Promise.resolve(mockPdf),
      }),
    };

    const res = await extractPdfText(mockApp as any, file);
    expect(res.ok).toBe(true);
    expect(res.text).toBe('Hello World\nHello World');
    expect(res.pagesRead).toBe(2);
    expect(mockApp.vault.readBinary).toHaveBeenCalledTimes(1);
  });

  it('truncates at maxChars', async () => {
    const file = createMockPdfFile('attachments/document.pdf', 1000);
    const mockApp = {
      vault: {
        readBinary: vi.fn().mockResolvedValue(new ArrayBuffer(10)),
      },
    };

    const mockPage = {
      getTextContent: vi.fn().mockResolvedValue({
        items: [{ str: 'ExtremelyLongPageTextContent' }],
      }),
    };

    const mockPdf = {
      numPages: 2,
      getPage: vi.fn().mockResolvedValue(mockPage),
    };

    (window as any).pdfjsLib = {
      getDocument: vi.fn().mockReturnValue({
        promise: Promise.resolve(mockPdf),
      }),
    };

    const res = await extractPdfText(mockApp as any, file, { maxChars: 15 });
    expect(res.ok).toBe(true);
    expect(res.text).toBe('ExtremelyLongPa'); // truncated to 15
  });

  it('respects maxPages limit', async () => {
    const file = createMockPdfFile('attachments/document.pdf', 1000);
    const mockApp = {
      vault: {
        readBinary: vi.fn().mockResolvedValue(new ArrayBuffer(10)),
      },
    };

    const mockPage = {
      getTextContent: vi.fn().mockResolvedValue({
        items: [{ str: 'Page' }],
      }),
    };

    const mockPdf = {
      numPages: 10,
      getPage: vi.fn().mockResolvedValue(mockPage),
    };

    (window as any).pdfjsLib = {
      getDocument: vi.fn().mockReturnValue({
        promise: Promise.resolve(mockPdf),
      }),
    };

    const res = await extractPdfText(mockApp as any, file, { maxPages: 3 });
    expect(res.ok).toBe(true);
    expect(res.pagesRead).toBe(3);
    expect(mockPdf.getPage).toHaveBeenCalledTimes(3);
  });

  it('returns warning when PDF has no extractable text', async () => {
    const file = createMockPdfFile('attachments/document.pdf', 1000);
    const mockApp = {
      vault: {
        readBinary: vi.fn().mockResolvedValue(new ArrayBuffer(10)),
      },
    };

    const mockPage = {
      getTextContent: vi.fn().mockResolvedValue({
        items: [],
      }),
    };

    const mockPdf = {
      numPages: 1,
      getPage: vi.fn().mockResolvedValue(mockPage),
    };

    (window as any).pdfjsLib = {
      getDocument: vi.fn().mockReturnValue({
        promise: Promise.resolve(mockPdf),
      }),
    };

    const res = await extractPdfText(mockApp as any, file);
    expect(res.ok).toBe(false);
    expect(res.warning).toContain('no extractable text');
  });
});

describe('Review Pipeline PDF Integration', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    (window as any).pdfjsLib = undefined;
  });

  afterEach(() => {
    (window as any).pdfjsLib = (originalWindow as any).pdfjsLib;
  });

  it('does not read PDF binary or extract when extractPdfText is disabled', async () => {
    const mockApp = {
      vault: {
        getAbstractFileByPath: vi.fn(),
      },
    };
    
    vi.mocked(extractAttachmentContext).mockReturnValue({
      attachments: [
        { path: 'attachments/document.pdf', displayName: 'document.pdf', extension: 'pdf', kind: 'pdf', embedded: true, exists: true }
      ],
      attachmentSummary: {
        totalCount: 1,
        pdfCount: 1,
      }
    } as any);

    const mockFile = {
      basename: 'Note',
      path: 'Note.md',
    } as any;

    const options = {
      outputFolder: 'AI Reviews',
      provider: 'openai-compatible' as const,
      endpointUrl: 'http://localhost',
      model: 'gpt-4',
      fetchUrlMetadata: false,
      extractUrlArticleText: false,
      maxExtractedCharacters: 1000,
      readImages: false,
      readVideos: false,
      requestTimeoutMs: 10000,
      promptLanguage: 'auto' as const,
      extractPdfText: false, // disabled
    };

    const payload = await buildReviewModelInputPayload(mockApp as any, mockFile, 'Note Content', {
      noteTitle: 'Note',
      notePath: 'Note.md',
      outputPath: 'AI Reviews/Note.ai-review.md',
      generatedAt: '',
      sourceHash: '',
    }, options);

    expect(payload.noteContent).toBe('Note Content');
  });

  it('extracts PDF text and appends to promptContent when extractPdfText is enabled', async () => {
    const mockApp = {
      vault: {
        getAbstractFileByPath: vi.fn().mockReturnValue(createMockPdfFile('attachments/document.pdf', 1000)),
        readBinary: vi.fn().mockResolvedValue(new ArrayBuffer(10)),
      },
    };
    
    vi.mocked(extractAttachmentContext).mockReturnValue({
      attachments: [
        { path: 'attachments/document.pdf', displayName: 'document.pdf', extension: 'pdf', kind: 'pdf', embedded: true, exists: true }
      ],
      attachmentSummary: {
        totalCount: 1,
        pdfCount: 1,
      }
    } as any);

    const mockPage = {
      getTextContent: vi.fn().mockResolvedValue({
        items: [{ str: 'Mocked PDF Body Text' }],
      }),
    };

    const mockPdf = {
      numPages: 1,
      getPage: vi.fn().mockResolvedValue(mockPage),
    };

    (window as any).pdfjsLib = {
      getDocument: vi.fn().mockReturnValue({
        promise: Promise.resolve(mockPdf),
      }),
    };

    const mockFile = {
      basename: 'Note',
      path: 'Note.md',
    } as any;

    const options = {
      outputFolder: 'AI Reviews',
      provider: 'openai-compatible' as const,
      endpointUrl: 'http://localhost',
      model: 'gpt-4',
      fetchUrlMetadata: false,
      extractUrlArticleText: false,
      maxExtractedCharacters: 1000,
      readImages: false,
      readVideos: false,
      requestTimeoutMs: 10000,
      promptLanguage: 'auto' as const,
      extractPdfText: true, // enabled
    };

    const payload = await buildReviewModelInputPayload(mockApp as any, mockFile, 'Note Content', {
      noteTitle: 'Note',
      notePath: 'Note.md',
      outputPath: 'AI Reviews/Note.ai-review.md',
      generatedAt: '',
      sourceHash: '',
    }, options);

    expect(payload.noteContent).toContain('## Extracted PDF Text');
    expect(payload.noteContent).toContain('Source: attachments/document.pdf');
    expect(payload.noteContent).toContain('Mocked PDF Body Text');
  });
});
