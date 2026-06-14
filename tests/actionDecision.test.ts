import { describe, it, expect } from 'vitest';
import { computeActionDecision, isActionAllowed, type ActionDecisionSettings } from '../src/actionDecision';

const baseSettings: ActionDecisionSettings = {
  autoExecuteArchive: true,
  autoExecuteReadLater: true,
  autoExecuteTask: true,
  allowActionArchive: true,
  allowActionReadLater: true,
  allowActionTask: true,
  allowActionDeleteCandidate: true,
  minConfidenceArchive: 'medium',
  minConfidenceReadLater: 'medium',
  minConfidenceTask: 'high',
};

function input(overrides: Partial<Parameters<typeof computeActionDecision>[0]> = {}) {
  return computeActionDecision({
    action: 'archive',
    reviewAction: 'archive',
    parseStatus: 'parsed',
    confidence: 'high',
    reliabilityLabel: 'high',
    reviewMode: 'standard',
    hasPromptInjectionSignals: false,
    settings: baseSettings,
    ...overrides,
  });
}

describe('computeActionDecision', () => {
  it('auto-executes archive with high confidence and reliability', () => {
    expect(input().wouldAutoExecute).toBe(true);
  });

  it('blocks safe mode', () => {
    const d = input({ reviewMode: 'safe' });
    expect(d.wouldAutoExecute).toBe(false);
    expect(d.skipCode).toBe('safe_mode');
  });

  it('blocks when parse status is not parsed', () => {
    const d = input({ parseStatus: 'partial' });
    expect(d.wouldAutoExecute).toBe(false);
    expect(d.skipCode).toBe('parse_status');
  });

  it('blocks via allowlist and reports allowlist_blocked', () => {
    const d = input({
      settings: { ...baseSettings, allowActionArchive: false },
    });
    expect(d.wouldAutoExecute).toBe(false);
    expect(d.allowedByAllowlist).toBe(false);
    expect(d.skipCode).toBe('allowlist_blocked');
  });

  it('applies configurable confidence threshold for archive', () => {
    const d = input({
      confidence: 'medium',
      settings: { ...baseSettings, minConfidenceArchive: 'high' },
    });
    expect(d.wouldAutoExecute).toBe(false);
    expect(d.skipCode).toBe('confidence_low');
  });

  it('keeps default task threshold at high', () => {
    const d = input({
      action: 'task',
      reviewAction: 'task',
      confidence: 'medium',
    });
    expect(d.wouldAutoExecute).toBe(false);
    expect(d.skipCode).toBe('task_requires_high');
  });

  it('retains reliability gate even when confidence passes', () => {
    const d = input({ reliabilityLabel: 'low' });
    expect(d.wouldAutoExecute).toBe(false);
    expect(d.skipCode).toBe('reliability_low');
  });

  it('allows archive with medium reliability (existing exception)', () => {
    expect(input({ reliabilityLabel: 'medium' }).wouldAutoExecute).toBe(true);
  });

  it('blocks task when reliability is medium', () => {
    const d = input({ action: 'task', reviewAction: 'task', reliabilityLabel: 'medium' });
    expect(d.wouldAutoExecute).toBe(false);
    expect(d.skipCode).toBe('reliability_low');
  });

  it('blocks task auto-execute on prompt injection signals', () => {
    const d = input({
      action: 'task',
      reviewAction: 'task',
      hasPromptInjectionSignals: true,
    });
    expect(d.wouldAutoExecute).toBe(false);
    expect(d.skipCode).toBe('prompt_injection');
  });

  it('blocks archive auto-execute on prompt injection signals', () => {
    const d = input({ hasPromptInjectionSignals: true });
    expect(d.wouldAutoExecute).toBe(false);
    expect(d.skipCode).toBe('prompt_injection');
  });

  it('never auto-executes delete_candidate', () => {
    const d = input({ action: 'delete_candidate', reviewAction: 'delete_candidate' });
    expect(d.wouldAutoExecute).toBe(false);
    expect(d.skipCode).toBe('delete_candidate');
  });

  it('reports setting_disabled when toggle is off', () => {
    const d = input({ settings: { ...baseSettings, autoExecuteArchive: false } });
    expect(d.wouldAutoExecute).toBe(false);
    expect(d.skipCode).toBe('setting_disabled');
  });
});

describe('isActionAllowed', () => {
  it('reflects per-action allowlist settings', () => {
    const s = { ...baseSettings, allowActionTask: false };
    expect(isActionAllowed('task', s)).toBe(false);
    expect(isActionAllowed('archive', s)).toBe(true);
    expect(isActionAllowed('none', s)).toBe(true);
  });
});
