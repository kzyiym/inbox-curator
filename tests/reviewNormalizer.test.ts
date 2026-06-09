import { describe, expect, it } from 'vitest';
import {
  normalizeReviewAction,
  parseReviewResponse,
  canAutoExecuteReviewAction,
  buildSimpleReviewJson,
  computeReviewConfidence,
  trimContentForMode,
  type ReviewAction,
} from '../src/reviewNormalizer';

describe('normalizeReviewAction', () => {
  it('normalizes read later variants', () => {
    expect(normalizeReviewAction('read later')).toBe('read_later');
    expect(normalizeReviewAction('Read Later')).toBe('read_later');
    expect(normalizeReviewAction('read-later')).toBe('read_later');
    expect(normalizeReviewAction('read_later')).toBe('read_later');
    expect(normalizeReviewAction('  read_later  ')).toBe('read_later');
  });

  it('normalizes archive variants', () => {
    expect(normalizeReviewAction('archive')).toBe('archive');
    expect(normalizeReviewAction('Archive')).toBe('archive');
    expect(normalizeReviewAction('archivenote')).toBe('archive');
    expect(normalizeReviewAction('archived')).toBe('archive');
  });

  it('normalizes task variants', () => {
    expect(normalizeReviewAction('task')).toBe('task');
    expect(normalizeReviewAction('turn_into_task')).toBe('task');
    expect(normalizeReviewAction('turn into task')).toBe('task');
  });

  it('normalizes delete_candidate variants', () => {
    expect(normalizeReviewAction('delete_candidate')).toBe('delete_candidate');
    expect(normalizeReviewAction('delete candidate')).toBe('delete_candidate');
    expect(normalizeReviewAction('delete-candidate')).toBe('delete_candidate');
    expect(normalizeReviewAction('Delete Candidate')).toBe('delete_candidate');
    expect(normalizeReviewAction('deletecandidate')).toBe('delete_candidate');
  });

  it('returns none for unknown values', () => {
    expect(normalizeReviewAction('something_else')).toBe('none');
    expect(normalizeReviewAction('xyz')).toBe('none');
  });

  it('returns none for empty and undefined', () => {
    expect(normalizeReviewAction('')).toBe('none');
    expect(normalizeReviewAction('   ')).toBe('none');
    expect(normalizeReviewAction(undefined)).toBe('none');
  });

  it('normalizes none variants', () => {
    expect(normalizeReviewAction('none')).toBe('none');
    expect(normalizeReviewAction('None')).toBe('none');
  });

  it('normalizes Japanese actions', () => {
    expect(normalizeReviewAction('あとで読む')).toBe('read_later');
    expect(normalizeReviewAction('後で読む')).toBe('read_later');
    expect(normalizeReviewAction('なし')).toBe('none');
    expect(normalizeReviewAction('不要')).toBe('none');
    expect(normalizeReviewAction('アーカイブ')).toBe('archive');
    expect(normalizeReviewAction('タスク')).toBe('task');
    expect(normalizeReviewAction('削除候補')).toBe('delete_candidate');
    expect(normalizeReviewAction('不明なアクション')).toBe('none');
  });
});

describe('parseReviewResponse', () => {
  it('parses a valid simple response', () => {
    const text = `# Summary
This is a brief summary of the note content.

# Importance
high

# Action
archive

# Reason
This note is no longer relevant.`;

    const result = parseReviewResponse(text);
    expect(result.summary).toContain('brief summary');
    expect(result.importance).toBe('high');
    expect(result.action).toBe('archive');
    expect(result.reason).toContain('no longer relevant');
    expect(result.parseStatus).toBe('parsed');
  });

  it('parses Action: read later format', () => {
    const text = `# Summary
A short summary.

# Importance
medium

# Action
read later

# Reason
Worth reading later.`;

    const result = parseReviewResponse(text);
    expect(result.action).toBe('read_later');
    expect(result.parseStatus).toBe('parsed');
  });

  it('parses recommended_action: read_later format', () => {
    const text = `# Summary
A short summary.

# Importance
low

recommended_action: read_later

# Reason
Interesting article.`;

    const result = parseReviewResponse(text);
    expect(result.action).toBe('read_later');
    expect(result.parseStatus).toBe('parsed');
  });

  it('handles extra text before headers', () => {
    const text = `Here is some preliminary text that should be ignored.

# Summary
Actual summary here.

# Importance
medium

# Action
none

# Reason
No action needed.`;

    const result = parseReviewResponse(text);
    expect(result.summary).toContain('Actual summary');
    expect(result.action).toBe('none');
    expect(result.parseStatus).toBe('parsed');
  });

  it('handles truncated response (missing sections)', () => {
    const text = `# Summary
This is a truncated summary without action or reason.`;

    const result = parseReviewResponse(text);
    expect(result.summary).toContain('truncated summary');
    expect(result.action).toBe('none');
    expect(result.parseStatus).toBe('partial');
  });

  it('returns failed for empty response', () => {
    const result = parseReviewResponse('');
    expect(result.parseStatus).toBe('failed');
    expect(result.action).toBe('none');
    expect(result.summary).toBe('');
  });

  it('returns failed for whitespace-only response', () => {
    const result = parseReviewResponse('   \n  \n  ');
    expect(result.parseStatus).toBe('failed');
  });

  it('returns fallback for unparseable text without polluting summary', () => {
    const text = `Some random AI output that has no structured format at all. Just a blob of text.`;

    const result = parseReviewResponse(text);
    expect(result.parseStatus).toBe('fallback');
    expect(result.summary).toBe('');
    expect(result.rawFallback).toContain('random AI output');
    expect(result.action).toBe('none');
  });

  it('returns partial when action found but no summary', () => {
    const text = `# Action\nread_later`;

    const result = parseReviewResponse(text);
    expect(result.parseStatus).toBe('partial');
    expect(result.summary).toBe('');
    expect(result.action).toBe('read_later');
    expect(result.rawFallback).toContain('read_later');
  });

  it('handles non-truncated valid response with ## headers', () => {
    const text = `## Summary
Two-line summary here.

## Importance
high

## Action
task

## Reason
Needs follow-up.`;

    const result = parseReviewResponse(text);
    expect(result.summary).toContain('Two-line summary');
    expect(result.importance).toBe('high');
    expect(result.action).toBe('task');
    expect(result.parseStatus).toBe('parsed');
  });

  it('parses Japanese headers', () => {
    const text = `# 要約
これは日本語の要約です。

# 重要度
high

# 推奨アクション
あとで読む

# 理由
後でじっくり読むため。`;

    const result = parseReviewResponse(text);
    expect(result.summary).toContain('日本語の要約');
    expect(result.importance).toBe('high');
    expect(result.action).toBe('read_later');
    expect(result.reason).toContain('後で');
    expect(result.parseStatus).toBe('parsed');
  });

  it('parses Japanese header # アクション', () => {
    const text = `# 要約
Short summary.

# 重要度
medium

# アクション
アーカイブ

# 理由
Not needed.`;

    const result = parseReviewResponse(text);
    expect(result.action).toBe('archive');
    expect(result.parseStatus).toBe('parsed');
  });
});

describe('canAutoExecuteReviewAction', () => {
  const std = 'standard' as const;
  const safe = 'safe' as const;
  const enabledSettings = {
    autoExecuteArchive: true,
    autoExecuteReadLater: true,
    autoExecuteTask: true,
  };
  const disabledSettings = {
    autoExecuteArchive: false,
    autoExecuteReadLater: false,
    autoExecuteTask: false,
  };

  it('returns true for archive with high confidence', () => {
    expect(canAutoExecuteReviewAction('archive', 'parsed', 'high', std, enabledSettings)).toBe(true);
  });

  it('returns true for read_later with high confidence', () => {
    expect(canAutoExecuteReviewAction('read_later', 'parsed', 'high', std, enabledSettings)).toBe(true);
  });

  it('returns true for task with high confidence', () => {
    expect(canAutoExecuteReviewAction('task', 'parsed', 'high', std, enabledSettings)).toBe(true);
  });

  it('returns false for delete_candidate even with settings enabled', () => {
    expect(canAutoExecuteReviewAction('delete_candidate', 'parsed', 'high', std, enabledSettings)).toBe(false);
  });

  it('returns false when settings are disabled', () => {
    expect(canAutoExecuteReviewAction('archive', 'parsed', 'high', std, disabledSettings)).toBe(false);
    expect(canAutoExecuteReviewAction('read_later', 'parsed', 'high', std, disabledSettings)).toBe(false);
    expect(canAutoExecuteReviewAction('task', 'parsed', 'high', std, disabledSettings)).toBe(false);
  });

  it('returns false when action is none', () => {
    expect(canAutoExecuteReviewAction('none', 'parsed', 'high', std, enabledSettings)).toBe(false);
  });

  it('returns false for non-parsed statuses', () => {
    expect(canAutoExecuteReviewAction('archive', 'partial', 'high', std, enabledSettings)).toBe(false);
    expect(canAutoExecuteReviewAction('archive', 'fallback', 'high', std, enabledSettings)).toBe(false);
    expect(canAutoExecuteReviewAction('archive', 'failed', 'high', std, enabledSettings)).toBe(false);
  });

  it('returns false for low confidence', () => {
    expect(canAutoExecuteReviewAction('archive', 'parsed', 'low', std, enabledSettings)).toBe(false);
    expect(canAutoExecuteReviewAction('read_later', 'parsed', 'low', std, enabledSettings)).toBe(false);
  });

  it('returns false for task with medium confidence', () => {
    expect(canAutoExecuteReviewAction('task', 'parsed', 'medium', std, enabledSettings)).toBe(false);
  });

  it('returns true for archive/read_later with medium confidence', () => {
    expect(canAutoExecuteReviewAction('archive', 'parsed', 'medium', std, enabledSettings)).toBe(true);
    expect(canAutoExecuteReviewAction('read_later', 'parsed', 'medium', std, enabledSettings)).toBe(true);
  });

  it('returns false for safe mode', () => {
    expect(canAutoExecuteReviewAction('archive', 'parsed', 'high', safe, enabledSettings)).toBe(false);
  });
});

describe('buildSimpleReviewJson', () => {
  const source = {
    noteTitle: 'test note',
    notePath: 'Inbox/test.md',
    outputPath: 'AI Reviews/test.ai-review.md',
    generatedAt: new Date().toISOString(),
    sourceHash: 'abc123',
  };

  it('builds a valid JSON-compatible record', () => {
    const parsed = {
      summary: 'A brief summary.',
      importance: 'high',
      action: 'archive' as const,
      reason: 'No longer needed.',
      parseStatus: 'parsed' as const,
      rawFallback: '',
    };

    const json = buildSimpleReviewJson(parsed, source);
    expect(json.verdict).toBeDefined();
    expect(json.verdict.recommendedAction).toBe('archive');
    expect(json.verdict.readingValueLabel).toBe('high');
    expect(json.verdict.savingValueLabel).toBe('high');
    expect(json.verdict.reliabilityLabel).toBe('medium');
    expect(json.decisionReason).toBe('No longer needed.');
    expect(json.summary).toEqual(['A brief summary.']);
    expect(json.flags.deleteCandidate).toBe(false);
  });

  it('maps task action to task', () => {
    const parsed = {
      summary: 'Summary.',
      importance: 'medium',
      action: 'task' as const,
      reason: 'Needs work.',
      parseStatus: 'parsed' as const,
      rawFallback: '',
    };

    const json = buildSimpleReviewJson(parsed, source);
    expect(json.verdict.recommendedAction).toBe('task');
    expect(json.verdict.reliabilityLabel).toBe('medium');
  });

  it('maps delete_candidate action and sets flag', () => {
    const parsed = {
      summary: 'Spam.',
      importance: 'low',
      action: 'delete_candidate' as const,
      reason: 'Spam.',
      parseStatus: 'parsed' as const,
      rawFallback: '',
    };

    const json = buildSimpleReviewJson(parsed, source);
    expect(json.verdict.recommendedAction).toBe('delete_candidate');
    expect(json.flags.deleteCandidate).toBe(true);
  });

  it('defaults to archive for none action', () => {
    const parsed = {
      summary: 'Informational note.',
      importance: 'medium',
      action: 'none' as const,
      reason: 'Just info.',
      parseStatus: 'parsed' as const,
      rawFallback: '',
    };

    const json = buildSimpleReviewJson(parsed, source);
    expect(json.verdict.recommendedAction).toBe('archive');
    expect(json.verdict.reliabilityLabel).toBe('medium');
  });

  it('uses low reliability for partial status', () => {
    const parsed = {
      summary: '',
      importance: 'medium',
      action: 'none' as const,
      reason: '',
      parseStatus: 'partial' as const,
      rawFallback: '',
    };

    const json = buildSimpleReviewJson(parsed, source);
    expect(json.verdict.reliabilityLabel).toBe('low');
  });

  it('handles fallback with raw response in detailedSummary', () => {
    const parsed = {
      summary: '',
      importance: 'medium',
      action: 'none' as const,
      reason: '',
      parseStatus: 'fallback' as const,
      rawFallback: 'Some random AI output that could not be parsed.',
    };

    const json = buildSimpleReviewJson(parsed, source);
    expect(json.verdict.reliabilityLabel).toBe('low');
    expect(json.summary).toEqual([]);
    expect(json.detailedSummary).toContain('## AI Review');
    expect(json.detailedSummary).toContain('could not be fully parsed');
    expect(json.decisionReason).toBeUndefined();
  });

  it('safe mode sets recommendedAction to keep_as_reference', () => {
    const parsed = {
      summary: 'Summary.',
      importance: 'medium',
      action: 'archive' as const,
      reason: 'Reason.',
      parseStatus: 'parsed' as const,
      rawFallback: '',
    };

    const json = buildSimpleReviewJson(parsed, source, 'safe');
    expect(json.verdict.recommendedAction).toBe('keep_as_reference');
    expect(json.verdict.reliabilityLabel).toBe('low');
  });
});

describe('computeReviewConfidence', () => {
  const base = {
    parseStatus: 'parsed' as const,
    action: 'archive' as ReviewAction,
    summary: 'A proper summary with enough detail.',
    reason: 'Good reason.',
    rawResponse: '# Summary\nA proper summary.\n# Action\narchive\n# Reason\nGood reason.',
    reviewMode: 'simple' as const,
  };

  it('returns high for parsed + summary + reason + valid action', () => {
    expect(computeReviewConfidence(base)).toBe('high');
  });

  it('returns max medium for partial', () => {
    expect(computeReviewConfidence({ ...base, parseStatus: 'partial', summary: 'Short summary.' })).toBe('medium');
  });

  it('returns low for partial with empty summary', () => {
    expect(computeReviewConfidence({ ...base, parseStatus: 'partial', summary: '' })).toBe('low');
  });

  it('returns low for fallback', () => {
    expect(computeReviewConfidence({ ...base, parseStatus: 'fallback', summary: '' })).toBe('low');
  });

  it('returns low for failed', () => {
    expect(computeReviewConfidence({ ...base, parseStatus: 'failed', summary: '' })).toBe('low');
  });

  it('returns low for safe mode', () => {
    expect(computeReviewConfidence({ ...base, reviewMode: 'safe' })).toBe('low');
  });

  it('returns medium for delete_candidate (not high)', () => {
    expect(computeReviewConfidence({ ...base, action: 'delete_candidate' })).toBe('medium');
  });

  it('returns low when summary is too short', () => {
    expect(computeReviewConfidence({ ...base, summary: 'Hi' })).toBe('low');
  });

  it('returns medium when reason is empty', () => {
    expect(computeReviewConfidence({ ...base, reason: '' })).toBe('medium');
  });

  it('returns medium when rawResponse is too short', () => {
    expect(computeReviewConfidence({ ...base, rawResponse: 'short' })).toBe('medium');
  });
});

describe('trimContentForMode', () => {
  const longText = 'A'.repeat(10000);

  it('standard mode keeps existing maxChars', () => {
    const result = trimContentForMode(longText, 'standard', 50000);
    expect(result.truncated).toBe(false);
    expect(result.text).toBe(longText);
    expect(result.originalLength).toBe(10000);
  });

  it('simple mode reduces input', () => {
    const result = trimContentForMode(longText, 'simple', 50000);
    expect(result.truncated).toBe(true);
    expect(result.finalLength).toBe(8000);
    expect(result.text.length).toBe(8000);
  });

  it('safe mode reduces input further', () => {
    const result = trimContentForMode(longText, 'safe', 50000);
    expect(result.truncated).toBe(true);
    expect(result.finalLength).toBe(4000);
    expect(result.text.length).toBe(4000);
  });

  it('does not truncate short content', () => {
    const short = 'Short note.';
    const result = trimContentForMode(short, 'safe', 50000);
    expect(result.truncated).toBe(false);
    expect(result.text).toBe(short);
  });

  it('respects maxChars when smaller than mode limit', () => {
    const result = trimContentForMode(longText, 'simple', 2000);
    expect(result.truncated).toBe(true);
    expect(result.finalLength).toBe(2000);
  });

  it('handles undefined maxChars gracefully', () => {
    const result = trimContentForMode(longText, 'standard', undefined);
    expect(result.truncated).toBe(false);
    expect(result.text).toBe(longText);
  });
});
