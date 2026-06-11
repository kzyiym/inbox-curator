import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { registerInboxCuratorCommands } from '../src/commands';
import { TFile, MarkdownView } from 'obsidian';
import InboxCuratorPlugin from '../main.ts';

describe('registerInboxCuratorCommands', () => {
  let plugin: InboxCuratorPlugin;
  let commands: Record<string, { editorCheckCallback?: Function; callback?: Function }>;

  beforeEach(() => {
    plugin = new InboxCuratorPlugin({} as any, {} as any);
    commands = {};

    vi.spyOn(plugin, 'addCommand').mockImplementation((cmd: any) => {
      commands[cmd.id] = cmd;
      return cmd;
    });

    vi.spyOn(plugin, 'reviewFile').mockResolvedValue();
    vi.spyOn(plugin, 'executeProposedActionForFile').mockResolvedValue();
    vi.spyOn(plugin, 'reviewFolderAsCollection').mockResolvedValue();

    registerInboxCuratorCommands(plugin);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function makeMdFile(path = 'test.md'): TFile {
    const f = new TFile();
    f.extension = 'md';
    f.path = path;
    return f;
  }

  function makeView(file: TFile | null): MarkdownView {
    const v = new MarkdownView();
    v.file = file;
    return v;
  }

  // ─── review-current-note ───────────────────────────

  describe('review-current-note', () => {
    it('uses editorCheckCallback (not callback)', () => {
      const cmd = commands['review-current-note'];
      expect(cmd.editorCheckCallback).toBeTypeOf('function');
      expect(cmd.callback).toBeUndefined();
    });

    it('checking=true returns true when view.file is a valid md file', () => {
      const result = commands['review-current-note'].editorCheckCallback!(
        true, {} as any, makeView(makeMdFile())
      );
      expect(result).toBe(true);
    });

    it('checking=true returns false when view.file is null', () => {
      const result = commands['review-current-note'].editorCheckCallback!(
        true, {} as any, makeView(null)
      );
      expect(result).toBe(false);
    });

    it('checking=true returns false when file is not markdown', () => {
      const f = new TFile();
      f.extension = 'png';
      const result = commands['review-current-note'].editorCheckCallback!(
        true, {} as any, makeView(f)
      );
      expect(result).toBe(false);
    });

    it('checking=true returns false when file is an ai-review.md', () => {
      const result = commands['review-current-note'].editorCheckCallback!(
        true, {} as any, makeView(makeMdFile('note.ai-review.md'))
      );
      expect(result).toBe(false);
    });

    it('execution calls plugin.reviewFile with view.file', () => {
      const file = makeMdFile();
      commands['review-current-note'].editorCheckCallback!(
        false, {} as any, makeView(file)
      );
      expect(plugin.reviewFile).toHaveBeenCalledTimes(1);
      expect(plugin.reviewFile).toHaveBeenCalledWith(file);
    });

    it('execution skips reviewFile when view.file is null', () => {
      commands['review-current-note'].editorCheckCallback!(
        false, {} as any, makeView(null)
      );
      expect(plugin.reviewFile).not.toHaveBeenCalled();
    });

    it('execution skips reviewFile when file is not markdown', () => {
      const f = new TFile();
      f.extension = 'png';
      commands['review-current-note'].editorCheckCallback!(
        false, {} as any, makeView(f)
      );
      expect(plugin.reviewFile).not.toHaveBeenCalled();
    });
  });

  // ─── execute-proposed-action ───────────────────────

  describe('execute-proposed-action', () => {
    it('uses editorCheckCallback (not callback)', () => {
      const cmd = commands['execute-proposed-action'];
      expect(cmd.editorCheckCallback).toBeTypeOf('function');
      expect(cmd.callback).toBeUndefined();
    });

    it('checking=true returns true when view.file is a valid md file', () => {
      const result = commands['execute-proposed-action'].editorCheckCallback!(
        true, {} as any, makeView(makeMdFile())
      );
      expect(result).toBe(true);
    });

    it('checking=true returns false when view.file is null', () => {
      const result = commands['execute-proposed-action'].editorCheckCallback!(
        true, {} as any, makeView(null)
      );
      expect(result).toBe(false);
    });

    it('checking=true returns false when file is not markdown', () => {
      const f = new TFile();
      f.extension = 'pdf';
      const result = commands['execute-proposed-action'].editorCheckCallback!(
        true, {} as any, makeView(f)
      );
      expect(result).toBe(false);
    });

    it('checking=true returns false when file is an ai-review.md', () => {
      const result = commands['execute-proposed-action'].editorCheckCallback!(
        true, {} as any, makeView(makeMdFile('note.ai-review.md'))
      );
      expect(result).toBe(false);
    });

    it('execution calls plugin.executeProposedActionForFile with view.file', () => {
      const file = makeMdFile();
      commands['execute-proposed-action'].editorCheckCallback!(
        false, {} as any, makeView(file)
      );
      expect(plugin.executeProposedActionForFile).toHaveBeenCalledTimes(1);
      expect(plugin.executeProposedActionForFile).toHaveBeenCalledWith(file);
    });

    it('execution skips executeProposedActionForFile when view.file is null', () => {
      commands['execute-proposed-action'].editorCheckCallback!(
        false, {} as any, makeView(null)
      );
      expect(plugin.executeProposedActionForFile).not.toHaveBeenCalled();
    });
  });

  // ─── review-folder-as-collection ───────────────────

  describe('review-folder-as-collection', () => {
    it('uses editorCheckCallback (not callback)', () => {
      const cmd = commands['review-folder-as-collection'];
      expect(cmd.editorCheckCallback).toBeTypeOf('function');
      expect(cmd.callback).toBeUndefined();
    });

    it('checking=true always returns true', () => {
      const result1 = commands['review-folder-as-collection'].editorCheckCallback!(
        true, {} as any, makeView(null)
      );
      const result2 = commands['review-folder-as-collection'].editorCheckCallback!(
        true, {} as any, makeView(makeMdFile())
      );
      expect(result1).toBe(true);
      expect(result2).toBe(true);
    });

    it('execution calls reviewFolderAsCollection with view.file when markdown', () => {
      const file = makeMdFile('inbox/note.md');
      commands['review-folder-as-collection'].editorCheckCallback!(
        false, {} as any, makeView(file)
      );
      expect(plugin.reviewFolderAsCollection).toHaveBeenCalledTimes(1);
      expect(plugin.reviewFolderAsCollection).toHaveBeenCalledWith(file);
    });

    it('execution calls reviewFolderAsCollection with undefined when view.file is null', () => {
      commands['review-folder-as-collection'].editorCheckCallback!(
        false, {} as any, makeView(null)
      );
      expect(plugin.reviewFolderAsCollection).toHaveBeenCalledTimes(1);
      expect(plugin.reviewFolderAsCollection).toHaveBeenCalledWith(undefined);
    });

    it('execution calls reviewFolderAsCollection with undefined when file is not markdown', () => {
      const f = new TFile();
      f.extension = 'canvas';
      commands['review-folder-as-collection'].editorCheckCallback!(
        false, {} as any, makeView(f)
      );
      expect(plugin.reviewFolderAsCollection).toHaveBeenCalledWith(undefined);
    });

    it('execution passes ai-review.md file (folder review excludes internally)', () => {
      const file = makeMdFile('AI Reviews/some-note.ai-review.md');
      commands['review-folder-as-collection'].editorCheckCallback!(
        false, {} as any, makeView(file)
      );
      expect(plugin.reviewFolderAsCollection).toHaveBeenCalledWith(file);
    });
  });

  // ─── review-selected-notes-as-collection is untouched ──

  describe('review-selected-notes-as-collection (unchanged)', () => {
    it('still uses callback', () => {
      const cmd = commands['review-selected-notes-as-collection'];
      expect(cmd.callback).toBeTypeOf('function');
      expect(cmd.editorCheckCallback).toBeUndefined();
    });
  });

  describe('process-watched-folder (unchanged)', () => {
    it('still uses callback', () => {
      const cmd = commands['process-watched-folder'];
      expect(cmd.callback).toBeTypeOf('function');
      expect(cmd.editorCheckCallback).toBeUndefined();
    });
  });
});
