import { describe, expect, it } from 'vitest';
import { resolveSafeSuggestedPath } from '../src/utils/folder';

describe('resolveSafeSuggestedPath', () => {
  it('resolves path with base path and suggested folder', () => {
    expect(resolveSafeSuggestedPath('AI/Thinking', 'Archive')).toBe('Archive/AI/Thinking');
  });

  it('preserves existing behavior when empty base path', () => {
    expect(resolveSafeSuggestedPath('AI/Thinking', '')).toBe('AI/Thinking');
    expect(resolveSafeSuggestedPath('AI/Thinking')).toBe('AI/Thinking');
  });

  it('normalizes backslashes and redundant slashes', () => {
    expect(resolveSafeSuggestedPath('AI\\\\Thinking', 'Archive//')).toBe('Archive/AI/Thinking');
    expect(resolveSafeSuggestedPath('AI/Thinking/', 'Archive/')).toBe('Archive/AI/Thinking');
  });

  it('rejects directory traversal', () => {
    expect(resolveSafeSuggestedPath('../Secrets', 'Archive')).toBeNull();
    expect(resolveSafeSuggestedPath('AI/../Thinking', 'Archive')).toBeNull();
  });

  it('rejects absolute and root paths', () => {
    expect(resolveSafeSuggestedPath('/AI', 'Archive')).toBeNull();
    expect(resolveSafeSuggestedPath('\\AI', 'Archive')).toBeNull();
  });

  it('rejects Windows drive paths', () => {
    expect(resolveSafeSuggestedPath('C:\\foo', 'Archive')).toBeNull();
    expect(resolveSafeSuggestedPath('D:/foo', 'Archive')).toBeNull();
  });

  it('rejects forbidden hidden directories', () => {
    expect(resolveSafeSuggestedPath('.obsidian', 'Archive')).toBeNull();
    expect(resolveSafeSuggestedPath('.git', 'Archive')).toBeNull();
    expect(resolveSafeSuggestedPath('AI/.git', 'Archive')).toBeNull();
    expect(resolveSafeSuggestedPath('AI/.obsidian', 'Archive')).toBeNull();
    expect(resolveSafeSuggestedPath('.hidden', 'Archive')).toBeNull();
  });

  it('rejects Windows reserved names', () => {
    expect(resolveSafeSuggestedPath('CON', 'Archive')).toBeNull();
    expect(resolveSafeSuggestedPath('aux.txt', 'Archive')).toBeNull();
    expect(resolveSafeSuggestedPath('com3', 'Archive')).toBeNull();
  });
});
