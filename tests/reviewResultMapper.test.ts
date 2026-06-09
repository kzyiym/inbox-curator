import { describe, expect, it } from 'vitest';
import { mapToReviewResult } from '../src/reviewResultMapper';

const context = {
  source: {
    noteTitle: 'Test Note',
    notePath: 'Inbox/Test Note.md',
    outputPath: 'AI Reviews/Test Note.ai-review.md',
    generatedAt: '2026-06-08T09:00:00Z',
    sourceHash: 'abcd1234',
  },
};

const getBaseRaw = () => ({
  verdict: {
    readingValueLabel: 'high',
    savingValueLabel: 'medium',
    reliabilityLabel: 'low',
    recommendedAction: 'archive',
    priority: 'medium',
  },
  scores: {
    readingValue: 80,
    savingValue: 60,
    reliability: 40,
    practicality: 50,
  },
  summary: ['Point 1'],
  detailedSummary: 'Very detailed.',
  credibilityReview: 'Credible.',
  practicalityReview: 'Practical.',
  flags: {
    needsVerification: false,
    deleteCandidate: false,
  },
});

describe('mapToReviewResult', () => {
  it('maps a valid result successfully', () => {
    const res = mapToReviewResult(getBaseRaw(), context);
    expect(res.ok).toBe(true);
  });

  it('normalizes numeric confidence as string and scales 0-1 values', () => {
    const raw = getBaseRaw();
    raw.scores.reliability = '0.85' as any;
    raw.scores.readingValue = 0.9 as any;
    raw.scores.savingValue = '90' as any;

    const res = mapToReviewResult(raw, context);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.result.scores.reliability).toBe(85);
      expect(res.result.scores.readingValue).toBe(90);
      expect(res.result.scores.savingValue).toBe(90);
    }
  });

  it('normalizes array field represented as string', () => {
    const raw = getBaseRaw();
    raw.summary = 'Only one summary point' as any;
    raw.suggestedTags = 'AI' as any;

    const res = mapToReviewResult(raw, context);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.result.summary).toEqual(['Only one summary point']);
      expect(res.result.suggestedTags).toEqual(['AI']);
    }
  });

  it('removes empty strings and trims elements in arrays', () => {
    const raw = getBaseRaw();
    raw.summary = ['   trimmed point   ', '', 'another point'] as any;

    const res = mapToReviewResult(raw, context);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.result.summary).toEqual(['trimmed point', 'another point']);
    }
  });

  it('truncates long strings to protect memory', () => {
    const raw = getBaseRaw();
    raw.detailedSummary = 'a'.repeat(12000);
    raw.decisionReason = 'b'.repeat(1500);
    raw.noteTitle = 'c'.repeat(400);
    raw.suggestedFolder = 'd'.repeat(500);

    const res = mapToReviewResult(raw, context);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.result.detailedSummary.length).toBe(10000);
      expect(res.result.decisionReason?.length).toBe(1000);
      expect(res.result.source.noteTitle.length).toBe(300);
      expect(res.result.suggestedFolder?.length).toBe(300);
    }
  });

  it('maps shortSummary if summary is missing', () => {
    const raw = getBaseRaw();
    delete (raw as any).summary;
    (raw as any).shortSummary = 'This is short summary';

    const res = mapToReviewResult(raw, context);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.result.summary).toEqual(['This is short summary']);
    }
  });

  it('maps known action variants and normalizes case/symbols', () => {
    const raw = getBaseRaw();
    const actions = [
      'archive-note',
      'READ_LATER',
      'turn-into-task',
      'delete',
      'keep-as-reference',
    ];
    const expected = [
      'archive',
      'read_later',
      'task',
      'delete_candidate',
      'keep_as_reference',
    ];

    for (let i = 0; i < actions.length; i++) {
      raw.verdict.recommendedAction = actions[i] as any;
      const res = mapToReviewResult(raw, context);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.result.verdict.recommendedAction).toBe(expected[i]);
      }
    }
  });

  it('falls back to archive for unknown actions', () => {
    const raw = getBaseRaw();
    raw.verdict.recommendedAction = 'make-coffee' as any;

    const res = mapToReviewResult(raw, context);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.result.verdict.recommendedAction).toBe('archive');
    }
  });

  it('maps turn_into_note to archive (deprecated)', () => {
    const raw = getBaseRaw();
    raw.verdict.recommendedAction = 'turn_into_note' as any;

    const res = mapToReviewResult(raw, context);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.result.verdict.recommendedAction).toBe('archive');
    }
  });

  it('maps "note" to archive (deprecated)', () => {
    const raw = getBaseRaw();
    raw.verdict.recommendedAction = 'note' as any;

    const res = mapToReviewResult(raw, context);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.result.verdict.recommendedAction).toBe('archive');
    }
  });

  it('maps deprecated actions correctly', () => {
    const raw = getBaseRaw();
    const tests: { input: string; expected: string }[] = [
      { input: 'needs_verification', expected: 'archive' },
      { input: 'research_more', expected: 'read_later' },
      { input: 'research', expected: 'read_later' },
      { input: 'ignore', expected: 'archive' },
      { input: 'none', expected: 'archive' },
    ];
    for (const { input, expected } of tests) {
      raw.verdict.recommendedAction = input as any;
      const res = mapToReviewResult(raw, context);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.result.verdict.recommendedAction).toBe(expected);
      }
    }
  });

  it('maps turn_into_task to task (forward-compat)', () => {
    const raw = getBaseRaw();
    raw.verdict.recommendedAction = 'turn_into_task' as any;
    const res = mapToReviewResult(raw, context);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.result.verdict.recommendedAction).toBe('task');
    }
  });

  it('maps all 5 valid recommended actions correctly', () => {
    const raw = getBaseRaw();
    const actions = [
      'keep_as_reference',
      'read_later',
      'archive',
      'task',
      'delete_candidate',
    ];

    for (const action of actions) {
      raw.verdict.recommendedAction = action;
      const res = mapToReviewResult(raw, context);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.result.verdict.recommendedAction).toBe(action);
      }
    }
  });

    it('propagates delete_candidate from verdict to flags', () => {
    const raw = getBaseRaw();
    raw.verdict.recommendedAction = 'delete_candidate';
    raw.flags.deleteCandidate = true;

    const res = mapToReviewResult(raw, context);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.result.verdict.recommendedAction).toBe('delete_candidate');
      expect(res.result.flags.deleteCandidate).toBe(true);
    }
  });

  it('maps a technical article fixture correctly (keep_as_reference, high scores)', () => {
    const raw = getBaseRaw();
    raw.verdict.recommendedAction = 'keep_as_reference';
    raw.verdict.savingValueLabel = 'high';
    raw.verdict.readingValueLabel = 'high';
    raw.verdict.reliabilityLabel = 'high';
    raw.verdict.priority = 'high';
    raw.scores.savingValue = 85;
    raw.scores.readingValue = 90;
    raw.scores.reliability = 85;

    const res = mapToReviewResult(raw, context);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.result.verdict.recommendedAction).toBe('keep_as_reference');
      expect(res.result.verdict.priority).toBe('high');
      expect(res.result.scores.savingValue).toBe(85);
      expect(res.result.scores.readingValue).toBe(90);
    }
  });

  it('maps a news article fixture correctly (archive, medium scores)', () => {
    const raw = getBaseRaw();
    raw.verdict.recommendedAction = 'archive';
    raw.verdict.savingValueLabel = 'low';
    raw.verdict.readingValueLabel = 'medium';
    raw.verdict.reliabilityLabel = 'medium';
    raw.verdict.priority = 'low';
    raw.scores.savingValue = 40;
    raw.scores.readingValue = 55;
    raw.scores.reliability = 60;
    raw.flags.needsVerification = true;

    const res = mapToReviewResult(raw, context);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.result.verdict.recommendedAction).toBe('archive');
      expect(res.result.verdict.priority).toBe('low');
      expect(res.result.scores.savingValue).toBe(40);
      expect(res.result.flags.needsVerification).toBe(true);
    }
  });

  it('maps a delete_candidate fixture correctly (low scores, flag)', () => {
    const raw = getBaseRaw();
    raw.verdict.recommendedAction = 'delete_candidate';
    raw.verdict.savingValueLabel = 'low';
    raw.verdict.readingValueLabel = 'low';
    raw.verdict.reliabilityLabel = 'low';
    raw.verdict.priority = 'low';
    raw.scores.savingValue = 20;
    raw.scores.readingValue = 25;
    raw.scores.reliability = 30;
    raw.scores.practicality = 10;
    raw.flags.deleteCandidate = true;

    const res = mapToReviewResult(raw, context);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.result.verdict.recommendedAction).toBe('delete_candidate');
      expect(res.result.flags.deleteCandidate).toBe(true);
      expect(res.result.scores.savingValue).toBe(20);
      expect(res.result.scores.readingValue).toBe(25);
    }
  });

  it('still fails when critical required fields are missing', () => {
    const raw = getBaseRaw();
    delete (raw as any).detailedSummary;

    const res = mapToReviewResult(raw, context);
    expect(res.ok).toBe(false);
  });
});
