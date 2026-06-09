import { describe, expect, it } from 'vitest';
import {
  isAdOrIframeLine,
  filterAiReviewInputContent,
  truncateContent,
  REVIEW_CONTEXT_BUDGET,
} from '../src/utils/contentFilter';

describe('isAdOrIframeLine', () => {
  it('detects <iframe> opening tag lines', () => {
    expect(isAdOrIframeLine('<iframe src="https://example.com"></iframe>')).toBe(true);
    expect(isAdOrIframeLine('<iframe width="560" height="315" src="https://youtube.com/embed/xxx"></iframe>')).toBe(true);
    expect(isAdOrIframeLine('  <iframe src="https://example.com"></iframe>')).toBe(true);
  });

  it('detects </iframe> closing tag lines', () => {
    expect(isAdOrIframeLine('</iframe>')).toBe(true);
    expect(isAdOrIframeLine('  </iframe>')).toBe(true);
  });

  it('detects <script> and </script> lines', () => {
    expect(isAdOrIframeLine('<script>alert(1)</script>')).toBe(true);
    expect(isAdOrIframeLine('</script>')).toBe(true);
    expect(isAdOrIframeLine('<script async src="https://example.com/tracker.js"></script>')).toBe(true);
  });

  it('detects <style> and </style> lines', () => {
    expect(isAdOrIframeLine('<style>.ad { display: none; }</style>')).toBe(true);
    expect(isAdOrIframeLine('</style>')).toBe(true);
  });

  it('detects ad domain patterns in lines', () => {
    expect(isAdOrIframeLine('https://doubleclick.net/abc')).toBe(true);
    expect(isAdOrIframeLine('https://googlesyndication.com/abc')).toBe(true);
    expect(isAdOrIframeLine('https://googletagmanager.com/gtag/js')).toBe(true);
    expect(isAdOrIframeLine('https://googleads.g.doubleclick.net/pagead')).toBe(true);
    expect(isAdOrIframeLine('https://adservice.google.com/')).toBe(true);
    expect(isAdOrIframeLine('https://platform.twitter.com/widgets.js')).toBe(true);
  });

  it('detects obvious ad label lines', () => {
    expect(isAdOrIframeLine('advertisement')).toBe(true);
    expect(isAdOrIframeLine('  advertisement  ')).toBe(true);
    expect(isAdOrIframeLine('sponsored')).toBe(true);
    expect(isAdOrIframeLine('sponsored link')).toBe(true);
    expect(isAdOrIframeLine('スポンサーリンク')).toBe(true);
    expect(isAdOrIframeLine('スポンサードリンク')).toBe(true);
  });

  it('detects decorate ad label lines', () => {
    expect(isAdOrIframeLine('## advertisement')).toBe(true);
    expect(isAdOrIframeLine('* 広告 *')).toBe(true);
    expect(isAdOrIframeLine('- sponsored -')).toBe(true);
  });

  it('does not flag normal content lines', () => {
    expect(isAdOrIframeLine('')).toBe(false);
    expect(isAdOrIframeLine('This is a normal sentence.')).toBe(false);
    expect(isAdOrIframeLine('本文です。')).toBe(false);
    expect(isAdOrIframeLine('広告代理店の資料を読む')).toBe(false);
    expect(isAdOrIframeLine('PR TIMESのニュース')).toBe(false);
    expect(isAdOrIframeLine('PR記事です')).toBe(false);
    expect(isAdOrIframeLine('sponsored by our team')).toBe(false);
    expect(isAdOrIframeLine('関連記事を読む')).toBe(false);
  });
});

describe('filterAiReviewInputContent', () => {
  it('passes through clean content unchanged', () => {
    const input = 'Line 1\nLine 2\nLine 3';
    const result = filterAiReviewInputContent(input);
    expect(result.content).toBe(input);
    expect(result.wasFiltered).toBe(false);
    expect(result.removedLineCount).toBe(0);
    expect(result.removedCharCount).toBe(0);
  });

  it('removes iframe lines and returns stats', () => {
    const input = 'Normal paragraph.\n<iframe src="ad"></iframe>\nMore normal text.\n</iframe>\nFinal line.';
    const result = filterAiReviewInputContent(input);
    expect(result.content).toBe('Normal paragraph.\nMore normal text.\nFinal line.');
    expect(result.wasFiltered).toBe(true);
    expect(result.removedLineCount).toBe(2);
  });

  it('removes ad domain lines', () => {
    const input = 'Content.\nhttps://doubleclick.net/tracker\nMore content.';
    const result = filterAiReviewInputContent(input);
    expect(result.content).toBe('Content.\nMore content.');
    expect(result.wasFiltered).toBe(true);
  });

  it('removes obvious ad label lines', () => {
    const input = 'Article text.\nadvertisement\nMore text.';
    const result = filterAiReviewInputContent(input);
    expect(result.content).toBe('Article text.\nMore text.');
  });

  it('removes advertisement label even with decoration', () => {
    const input = 'Text.\n## 広告\nMore text.';
    const result = filterAiReviewInputContent(input);
    expect(result.content).toBe('Text.\nMore text.');
  });

  it('does not remove normal text containing "広告" as part of a word', () => {
    const input = '広告代理店のマーケティング戦略について';
    const result = filterAiReviewInputContent(input);
    expect(result.content).toBe(input);
    expect(result.wasFiltered).toBe(false);
  });

  it('does not remove normal text containing "sponsored" as part of a phrase', () => {
    const input = 'This was sponsored by our engineering team.';
    const result = filterAiReviewInputContent(input);
    expect(result.content).toBe(input);
  });

  it('handles empty content gracefully', () => {
    const result = filterAiReviewInputContent('');
    expect(result.content).toBe('');
    expect(result.wasFiltered).toBe(false);
  });

  it('accumulates removedCharCount correctly', () => {
    const input = 'Keep.\nhttps://doubleclick.net/track\nKeep.\n<iframe src="x"></iframe>\nEnd.';
    const result = filterAiReviewInputContent(input);
    expect(result.removedLineCount).toBe(2);
    expect(result.removedCharCount).toBeGreaterThan(0);
  });
});

describe('truncateContent', () => {
  it('returns content unchanged when within limit', () => {
    const input = 'Short text.';
    const result = truncateContent(input, 100);
    expect(result.content).toBe(input);
    expect(result.wasTruncated).toBe(false);
    expect(result.truncatedCharCount).toBe(0);
  });

  it('truncates at exact boundary when no good breakpoint found', () => {
    const input = 'A'.repeat(100);
    const result = truncateContent(input, 50);
    expect(result.wasTruncated).toBe(true);
    expect(result.content).toBe('A'.repeat(50));
  });

  it('truncates at last newline when available after 80% threshold', () => {
    const line1 = 'A'.repeat(90);
    const line2 = 'B'.repeat(90);
    const input = line1 + '\n' + line2;
    const result = truncateContent(input, 100);
    expect(result.wasTruncated).toBe(true);
    expect(result.content).toBe(line1);
  });

  it('truncates at last sentence boundary when available after 80% threshold', () => {
    const input = 'First sentence. Second sentence. Third sentence. Fourth sentence.';
    const result = truncateContent(input, 40);
    expect(result.wasTruncated).toBe(true);
    expect(result.content).toMatch(/^First sentence\./);
  });

  it('truncates at last Japanese period when available after 80% threshold', () => {
    const input = '最初の文。次の文。三つ目の文。四つ目の文。';
    const result = truncateContent(input, 20);
    expect(result.wasTruncated).toBe(true);
    expect(result.content).toMatch(/^最初の文。/);
  });
});

describe('REVIEW_CONTEXT_BUDGET', () => {
  it('matches the standard preset values', () => {
    expect(REVIEW_CONTEXT_BUDGET.maxContextTokens).toBe(32000);
    expect(REVIEW_CONTEXT_BUDGET.maxInputContentTokens).toBe(20000);
    expect(REVIEW_CONTEXT_BUDGET.maxOutputTokens).toBe(4096);
    expect(REVIEW_CONTEXT_BUDGET.maxInputContentChars).toBe(40000);
    expect(REVIEW_CONTEXT_BUDGET.safetyMarginTokens).toBe(3000);
    expect(REVIEW_CONTEXT_BUDGET.estimatedCharsPerToken).toBe(2);
  });
});
