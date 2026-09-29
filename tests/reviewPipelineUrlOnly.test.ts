import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TFile } from 'obsidian';

vi.mock('../src/urlExtraction', () => ({
  fetchUrlContext: vi.fn(),
}));

vi.mock('../src/utils/operationLog', () => ({
  logOperation: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/utils/errorLog', () => ({
  logError: vi.fn().mockResolvedValue(undefined),
}));

import { runReviewPipeline, type ReviewPipelineOptions } from '../src/reviewPipeline';
import { fetchUrlContext } from '../src/urlExtraction';

function createTFile(path: string): TFile {
  const name = path.split('/').pop() ?? path;
  const basename = name.replace(/\.[^.]+$/, '');
  return Object.assign(Object.create(TFile.prototype), {
    path,
    name,
    basename,
    extension: 'md',
    stat: { mtime: 100, size: 10 },
  }) as TFile;
}

function createApp(noteContent: string) {
  return {
    vault: { read: vi.fn().mockResolvedValue(noteContent) },
    metadataCache: { getFirstLinkpathDest: () => null },
  };
}

const baseOptions: ReviewPipelineOptions = {
  outputFolder: 'AI Reviews',
  provider: 'openai-compatible',
  endpointUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  fetchUrlMetadata: true,
  extractUrlArticleText: true,
  maxExtractedCharacters: 12000,
  readImages: false,
  optimizeImagesForAi: false,
  readVideos: false,
  requestTimeoutMs: 60000,
  promptLanguage: 'auto',
  extractPdfText: false,
  maxInputContentChars: 10000,
  maxOutputTokens: 1024,
  reviewMode: 'standard',
};

describe('runReviewPipeline URL-only background classification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('classifies a background URL-only note as awaiting manual review and never fetches', async () => {
    const file = createTFile('Inbox/link.md');
    const app = createApp('https://example.com/article\n');

    const result = await runReviewPipeline(app as never, file, {
      ...baseOptions,
      allowRemoteUrlFetch: false,
      isBackgroundAutoJob: true,
    });

    expect(fetchUrlContext).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.errorCode).toBe('awaiting_manual_review');
      expect(result.stage).toBe('input');
      expect(result.retryable).toBe(false);
    }
  });

  it('keeps a foreground URL-only note with a failed fetch as insufficient input', async () => {
    vi.mocked(fetchUrlContext).mockResolvedValue({
      fetchStatus: 'failed',
      extractionUsed: false,
    } as never);
    const file = createTFile('Inbox/link.md');
    const app = createApp('https://example.com/article\n');

    const result = await runReviewPipeline(app as never, file, {
      ...baseOptions,
      allowRemoteUrlFetch: true,
      isBackgroundAutoJob: false,
    });

    expect(fetchUrlContext).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.errorCode).toBe('insufficient_input');
    }
  });
});
