import { describe, expect, it } from 'vitest';
import {
  resolveReviewContextBudget,
  REVIEW_CONTEXT_BUDGET,
} from '../src/utils/contentFilter';

describe('resolveReviewContextBudget — small preset', () => {
  const budget = resolveReviewContextBudget('small');

  it('resolves maxContextTokens to 8192', () => {
    expect(budget.maxContextTokens).toBe(8192);
  });

  it('resolves maxInputContentTokens to 5000', () => {
    expect(budget.maxInputContentTokens).toBe(5000);
  });

  it('resolves maxOutputTokens to 1024', () => {
    expect(budget.maxOutputTokens).toBe(1024);
  });

  it('resolves safetyMarginTokens to 1000', () => {
    expect(budget.safetyMarginTokens).toBe(1000);
  });

  it('derives maxInputContentChars as maxInputContentTokens * 2', () => {
    expect(budget.maxInputContentChars).toBe(5000 * 2);
  });

  it('sets estimatedCharsPerToken to 2', () => {
    expect(budget.estimatedCharsPerToken).toBe(2);
  });
});

describe('resolveReviewContextBudget — standard preset', () => {
  const budget = resolveReviewContextBudget('standard');

  it('resolves maxContextTokens to 32000', () => {
    expect(budget.maxContextTokens).toBe(32000);
  });

  it('resolves maxInputContentTokens to 20000', () => {
    expect(budget.maxInputContentTokens).toBe(20000);
  });

  it('resolves maxOutputTokens to 4096', () => {
    expect(budget.maxOutputTokens).toBe(4096);
  });

  it('derives maxInputContentChars as 40000', () => {
    expect(budget.maxInputContentChars).toBe(40000);
  });
});

describe('resolveReviewContextBudget — large preset', () => {
  const budget = resolveReviewContextBudget('large');

  it('resolves maxContextTokens to 64000', () => {
    expect(budget.maxContextTokens).toBe(64000);
  });

  it('resolves maxInputContentTokens to 40000', () => {
    expect(budget.maxInputContentTokens).toBe(40000);
  });

  it('resolves maxOutputTokens to 4096', () => {
    expect(budget.maxOutputTokens).toBe(4096);
  });

  it('derives maxInputContentChars as 80000', () => {
    expect(budget.maxInputContentChars).toBe(80000);
  });
});

describe('resolveReviewContextBudget — custom preset', () => {
  it('resolves custom values when provided', () => {
    const budget = resolveReviewContextBudget('custom', {
      maxContextTokens: 16384,
      maxInputContentTokens: 10000,
      maxOutputTokens: 2048,
      safetyMarginTokens: 2000,
    });

    expect(budget.maxContextTokens).toBe(16384);
    expect(budget.maxInputContentTokens).toBe(10000);
    expect(budget.maxOutputTokens).toBe(2048);
    expect(budget.safetyMarginTokens).toBe(2000);
    expect(budget.maxInputContentChars).toBe(20000);
  });

  it('clamps maxOutputTokens to minimum 256', () => {
    const budget = resolveReviewContextBudget('custom', {
      maxContextTokens: 8192,
      maxInputContentTokens: 5000,
      maxOutputTokens: 100,
      safetyMarginTokens: 500,
    });

    expect(budget.maxOutputTokens).toBe(256);
  });

  it('clamps maxOutputTokens to maximum 65536', () => {
    const budget = resolveReviewContextBudget('custom', {
      maxContextTokens: 100000,
      maxInputContentTokens: 50000,
      maxOutputTokens: 999999,
      safetyMarginTokens: 5000,
    });

    expect(budget.maxOutputTokens).toBe(65536);
  });

  it('clamps maxContextTokens to minimum 4096', () => {
    const budget = resolveReviewContextBudget('custom', {
      maxContextTokens: 512,
      maxInputContentTokens: 500,
      maxOutputTokens: 256,
      safetyMarginTokens: 100,
    });

    expect(budget.maxContextTokens).toBe(4096);
  });

  it('clamps maxInputContentTokens to minimum 1000', () => {
    const budget = resolveReviewContextBudget('custom', {
      maxContextTokens: 8192,
      maxInputContentTokens: 50,
      maxOutputTokens: 1024,
      safetyMarginTokens: 1000,
    });

    expect(budget.maxInputContentTokens).toBe(1000);
  });

  it('enforces maxInputContentTokens <= maxContextTokens - maxOutputTokens - safetyMarginTokens', () => {
    const budget = resolveReviewContextBudget('custom', {
      maxContextTokens: 10000,
      maxInputContentTokens: 20000,
      maxOutputTokens: 4096,
      safetyMarginTokens: 3000,
    });

    const available = 10000 - 4096 - 3000;
    expect(budget.maxInputContentTokens).toBe(available);
  });

  it('prevents maxInputContentTokens from going below 1000 even when budget exceeded', () => {
    const budget = resolveReviewContextBudget('custom', {
      maxContextTokens: 5000,
      maxInputContentTokens: 10000,
      maxOutputTokens: 4096,
      safetyMarginTokens: 3000,
    });

    const available = 5000 - 4096 - 3000;
    expect(available).toBeLessThan(1000);
    expect(budget.maxInputContentTokens).toBe(1000);
  });

  it('falls back to standard when no custom values provided', () => {
    const budget = resolveReviewContextBudget('custom');

    expect(budget.maxContextTokens).toBe(32000);
    expect(budget.maxInputContentTokens).toBe(20000);
    expect(budget.maxOutputTokens).toBe(4096);
  });
});

describe('REVIEW_CONTEXT_BUDGET equals standard preset', () => {
  it('has the same values as resolveReviewContextBudget("standard")', () => {
    const standard = resolveReviewContextBudget('standard');
    expect(REVIEW_CONTEXT_BUDGET.maxContextTokens).toBe(standard.maxContextTokens);
    expect(REVIEW_CONTEXT_BUDGET.maxInputContentTokens).toBe(standard.maxInputContentTokens);
    expect(REVIEW_CONTEXT_BUDGET.maxOutputTokens).toBe(standard.maxOutputTokens);
    expect(REVIEW_CONTEXT_BUDGET.safetyMarginTokens).toBe(standard.safetyMarginTokens);
    expect(REVIEW_CONTEXT_BUDGET.maxInputContentChars).toBe(standard.maxInputContentChars);
    expect(REVIEW_CONTEXT_BUDGET.estimatedCharsPerToken).toBe(standard.estimatedCharsPerToken);
  });
});
