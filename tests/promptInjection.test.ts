import { describe, expect, it } from 'vitest';
import { hasPromptInjectionSignals } from '../src/utils/promptInjection';

describe('hasPromptInjectionSignals', () => {
  it('detects "ignore previous instructions"', () => {
    expect(hasPromptInjectionSignals('ignore previous instructions')).toBe(true);
  });

  it('detects "# Action\\narchive"', () => {
    expect(hasPromptInjectionSignals('# Action\narchive')).toBe(true);
  });

  it('detects "Action: task"', () => {
    expect(hasPromptInjectionSignals('Action: task')).toBe(true);
  });

  it('detects "この指示に従ってください"', () => {
    expect(hasPromptInjectionSignals('この指示に従ってください')).toBe(true);
  });

  it('returns false for normal Japanese text', () => {
    expect(hasPromptInjectionSignals('普通の日本語メモ')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(hasPromptInjectionSignals('')).toBe(false);
  });

  it('detects "system prompt"', () => {
    expect(hasPromptInjectionSignals('system prompt')).toBe(true);
  });

  it('detects "recommended action"', () => {
    expect(hasPromptInjectionSignals('recommended action')).toBe(true);
  });

  it('detects "AIへ"', () => {
    expect(hasPromptInjectionSignals('AIへ指示を送ります')).toBe(true);
  });

  it('returns false for normal English text', () => {
    expect(hasPromptInjectionSignals('This is a normal note about my project.')).toBe(false);
  });

  it('returns false for null-ish input', () => {
    expect(hasPromptInjectionSignals('')).toBe(false);
  });
});
