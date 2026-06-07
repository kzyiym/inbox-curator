import { describe, expect, it } from 'vitest';
import { TFile } from 'obsidian';
import { extractAttachmentContext } from '../src/attachmentContext';

function createTFile(path: string) {
  const extension = path.split('.').pop() ?? '';
  const basename = path.split('/').pop()?.replace(/\.[^.]+$/, '') ?? path;
  return Object.assign(Object.create(TFile.prototype), {
    path,
    extension,
    basename,
  }) as TFile;
}

function createApp(resolver: Record<string, TFile | null>) {
  return {
    metadataCache: {
      getFirstLinkpathDest: (target: string) => resolver[target] ?? null,
    },
  };
}

describe('extractAttachmentContext', () => {
  it('collects wikilink, markdown link, embed, broken link, and classifies kinds without overcounting duplicates', () => {
    const sourceFile = createTFile('Inbox/source.md');
    const app = createApp({
      'assets/image.png': createTFile('assets/image.png'),
      'docs/report.pdf': createTFile('docs/report.pdf'),
      'media/video.mp4': createTFile('media/video.mp4'),
      'audio/theme.mp3': createTFile('audio/theme.mp3'),
      'files/spec.docx': createTFile('files/spec.docx'),
      'archives/data.zip': createTFile('archives/data.zip'),
    });

    const content = [
      '---',
      'title: Example',
      '---',
      '[[assets/image.png]]',
      '[[assets/image.png]]',
      '![[assets/image.png]]',
      '[report](docs/report.pdf)',
      '![video](media/video.mp4)',
      '[audio](audio/theme.mp3)',
      '[doc](files/spec.docx)',
      '[archive](archives/data.zip)',
      '[broken](missing/ghost.pdf)',
      '[external](https://example.com/image.png)',
    ].join('\n');

    const result = extractAttachmentContext(app as never, sourceFile, content);

    expect(result.attachmentSummary).toMatchObject({
      totalCount: 7,
      imageCount: 1,
      pdfCount: 2,
      videoCount: 1,
      audioCount: 1,
      documentCount: 1,
      archiveCount: 1,
      unresolvedCount: 1,
    });

    expect(result.attachments.find((item) => item.path === 'assets/image.png')).toMatchObject({
      embedded: true,
      exists: true,
      kind: 'image',
    });

    expect(result.attachments.find((item) => item.path === 'missing/ghost.pdf')).toMatchObject({
      exists: false,
      kind: 'pdf',
    });
  });
});
