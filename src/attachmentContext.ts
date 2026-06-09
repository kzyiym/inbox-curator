import { App, TFile } from 'obsidian';
import type { ReviewAttachment, ReviewAttachmentKind, ReviewAttachmentSummary } from './types';

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif', 'heic']);
const VIDEO_EXTENSIONS = new Set(['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi']);
const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'm4a', 'ogg', 'flac', 'aac']);
const PDF_EXTENSIONS = new Set(['pdf']);
const DOCUMENT_EXTENSIONS = new Set(['doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'csv', 'txt', 'rtf']);
const ARCHIVE_EXTENSIONS = new Set(['zip', '7z', 'rar', 'tar', 'gz']);

const WIKILINK_REGEX = /(!?)\[\[([^\]|]+?)(?:\|([^\]]*))?\]\]/g;
const MARKDOWN_LINK_REGEX = /(!?)\[([^\]]*)\]\(([^)]+)\)/g;

interface AttachmentCandidate {
  rawTarget: string;
  displayName?: string;
  embedded: boolean;
}

function stripFrontmatter(content: string): string {
  return content.replace(/^---\n[\s\S]*?\n---\n?/, '');
}

function normalizeTarget(target: string): string {
  return target.trim().replace(/^<|>$/g, '');
}

function isExternalTarget(target: string): boolean {
  return /^(https?:|mailto:|data:)/i.test(target);
}

function getExtension(target: string): string | undefined {
  const sanitized = target.split('?')[0].split('#')[0].trim();
  const lastDot = sanitized.lastIndexOf('.');
  if (lastDot < 0 || lastDot === sanitized.length - 1) {
    return undefined;
  }

  return sanitized.slice(lastDot + 1).toLowerCase();
}

function classifyKind(extension: string | undefined): ReviewAttachmentKind {
  if (!extension) {
    return 'other';
  }
  if (IMAGE_EXTENSIONS.has(extension)) {
    return 'image';
  }
  if (VIDEO_EXTENSIONS.has(extension)) {
    return 'video';
  }
  if (AUDIO_EXTENSIONS.has(extension)) {
    return 'audio';
  }
  if (PDF_EXTENSIONS.has(extension)) {
    return 'pdf';
  }
  if (DOCUMENT_EXTENSIONS.has(extension)) {
    return 'document';
  }
  if (ARCHIVE_EXTENSIONS.has(extension)) {
    return 'archive';
  }
  return 'other';
}

function collectCandidatesFromApi(app: App, sourceFile: TFile): AttachmentCandidate[] {
  const candidates: AttachmentCandidate[] = [];
  const cache = app.metadataCache.getFileCache(sourceFile);

  if (cache) {
    if (cache.links) {
      for (const link of cache.links) {
        const rawTarget = normalizeTarget(link.link);
        if (!rawTarget || isExternalTarget(rawTarget)) {
          continue;
        }
        candidates.push({
          rawTarget,
          displayName: link.displayText || undefined,
          embedded: false,
        });
      }
    }

    if (cache.embeds) {
      for (const embed of cache.embeds) {
        const rawTarget = normalizeTarget(embed.link);
        if (!rawTarget || isExternalTarget(rawTarget)) {
          continue;
        }
        candidates.push({
          rawTarget,
          displayName: embed.displayText || undefined,
          embedded: true,
        });
      }
    }
  }

  return candidates;
}

function collectCandidatesFromText(content: string): AttachmentCandidate[] {
  const body = stripFrontmatter(content);
  const candidates: AttachmentCandidate[] = [];

  const wikiMatches = Array.from(body.matchAll(WIKILINK_REGEX));
  for (const match of wikiMatches) {
    const embedded = Boolean(match[1]);
    const rawTarget = normalizeTarget((match[2] ?? '').split('#')[0]);
    const displayName = normalizeTarget(match[3] ?? '');
    if (!rawTarget || isExternalTarget(rawTarget)) {
      continue;
    }
    candidates.push({ rawTarget, displayName: displayName || undefined, embedded });
  }

  const markdownMatches = Array.from(body.matchAll(MARKDOWN_LINK_REGEX));
  for (const match of markdownMatches) {
    const embedded = Boolean(match[1]);
    const rawTarget = normalizeTarget(match[3] ?? '');
    if (!rawTarget || isExternalTarget(rawTarget)) {
      continue;
    }
    candidates.push({ rawTarget, embedded });
  }

  return candidates;
}

function shouldTreatAsAttachment(target: string, resolved: TFile | null): boolean {
  if (resolved && resolved.extension.toLowerCase() !== 'md') {
    return true;
  }

  const extension = getExtension(target);
  return Boolean(extension && extension !== 'md');
}

function buildSummary(attachments: ReviewAttachment[]): ReviewAttachmentSummary {
  return {
    totalCount: attachments.length,
    imageCount: attachments.filter((item) => item.kind === 'image').length,
    videoCount: attachments.filter((item) => item.kind === 'video').length,
    audioCount: attachments.filter((item) => item.kind === 'audio').length,
    pdfCount: attachments.filter((item) => item.kind === 'pdf').length,
    documentCount: attachments.filter((item) => item.kind === 'document').length,
    archiveCount: attachments.filter((item) => item.kind === 'archive').length,
    otherCount: attachments.filter((item) => item.kind === 'other').length,
    unresolvedCount: attachments.filter((item) => !item.exists).length,
  };
}

export function extractAttachmentContext(app: App, sourceFile: TFile, content: string): {
  attachments: ReviewAttachment[];
  attachmentSummary?: ReviewAttachmentSummary;
} {
  const attachments: ReviewAttachment[] = [];
  const byPath = new Map<string, ReviewAttachment>();

  let candidates: AttachmentCandidate[] = [];
  
  if (typeof app.metadataCache?.getFileCache === 'function') {
    candidates = collectCandidatesFromApi(app, sourceFile);
  }

  // Fallback to regex text-parsing if metadata cache is unavailable or returns no results (e.g. in test envs)
  if (candidates.length === 0) {
    candidates = collectCandidatesFromText(content);
  }

  for (const candidate of candidates) {
    const resolved = app.metadataCache.getFirstLinkpathDest(candidate.rawTarget, sourceFile.path);
    if (!shouldTreatAsAttachment(candidate.rawTarget, resolved instanceof TFile ? resolved : null)) {
      continue;
    }

    const path = resolved instanceof TFile ? resolved.path : candidate.rawTarget;
    const extension = (resolved instanceof TFile ? resolved.extension : getExtension(candidate.rawTarget) ?? '').toLowerCase();
    const existing = byPath.get(path);
    if (existing) {
      existing.embedded = existing.embedded || candidate.embedded;
      existing.exists = existing.exists || resolved instanceof TFile;
      continue;
    }

    const attachment: ReviewAttachment = {
      path,
      displayName: candidate.displayName || (resolved instanceof TFile ? resolved.basename : candidate.rawTarget),
      extension,
      kind: classifyKind(extension || undefined),
      embedded: candidate.embedded,
      exists: resolved instanceof TFile,
    };

    byPath.set(path, attachment);
    attachments.push(attachment);
  }

  return {
    attachments,
    ...(attachments.length > 0 ? { attachmentSummary: buildSummary(attachments) } : {}),
  };
}
