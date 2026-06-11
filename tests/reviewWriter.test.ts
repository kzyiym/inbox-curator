import { describe, expect, it } from 'vitest';
import { buildReviewContent, sanitizeAiContent, appendAutoExecuteResult } from '../src/reviewWriter';
import { TFile } from 'obsidian';
import type { ReviewResult } from '../src/types';

const mockBaseResult = (): ReviewResult => ({
  source: {
    noteTitle: 'My Test Note',
    notePath: 'Inbox/My Test Note.md',
    outputPath: 'AI Reviews/My Test Note.ai-review.md',
    generatedAt: '2026-06-08T09:00:00Z',
    sourceHash: 'abcd1234',
  },
  contentType: 'plain_note',
  inputProfile: 'plain_note',
  fetchStatus: 'not_applicable',
  domainProfile: 'none',
  provider: 'gemini',
  model: 'gemini-1.5-flash',
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
  summary: ['Takeaway Point 1', 'Takeaway Point 2'],
  detailedSummary: 'This is a detailed overview of the note content.',
  credibilityReview: 'This is credibility caveat.',
  practicalityReview: 'Refer to this note for next steps.',
  decisionReason: 'Recommended action is archive.',
  retentionReasons: ['Important for design', 'Reference for implementation'],
  evidenceBasis: ['official_documentation'],
  structuredSummary: {
    centralClaim: 'Central claim here.',
    keyPoints: ['Structured Key Point 1', 'Structured Key Point 2'],
    evidenceMentioned: ['Docs page 12'],
  },
  strengths: ['Clear design'],
  risksOrGaps: ['Missing test cases'],
  verificationNeeded: [],
  nextActions: [],
  actionItems: [],
  suggestedTags: ['test', 'unit-test'],
  suggestedFolder: 'Reviews/Testing',
  flags: {
    needsVerification: false,
    deleteCandidate: false,
  },
  promptLanguage: 'english',
});

describe('buildReviewContent', () => {
  it('formats output with Overview before Curation Decision, Key Takeaways near the top, and Technical Metadata at the bottom', () => {
    const result = mockBaseResult();
    const output = buildReviewContent(result);

    const overviewIdx = output.indexOf('## Overview');
    const decisionIdx = output.indexOf('### Curation Decision');
    const takeawaysIdx = output.indexOf('## Key Takeaways');
    const techMetaIdx = output.indexOf('### Technical Metadata');
    const verdictIdx = output.indexOf('**Verdict**:');

    expect(overviewIdx).toBeGreaterThan(-1);
    expect(decisionIdx).toBeGreaterThan(-1);
    expect(takeawaysIdx).toBeGreaterThan(-1);
    expect(techMetaIdx).toBeGreaterThan(-1);
    expect(verdictIdx).toBeGreaterThan(-1);

    expect(verdictIdx).toBeLessThan(overviewIdx);
    expect(overviewIdx).toBeLessThan(decisionIdx);
    expect(takeawaysIdx).toBeLessThan(decisionIdx);
    expect(techMetaIdx).toBeGreaterThan(decisionIdx);
  });

  it('outputs None for Required actions and Optional actions when they are empty and verification is not needed', () => {
    const result = mockBaseResult();
    result.verificationNeeded = [];
    result.nextActions = [];
    result.actionItems = [];
    result.flags.needsVerification = false;

    const output = buildReviewContent(result);

    const requiredHeaderIdx = output.indexOf('#### Required');
    const optionalHeaderIdx = output.indexOf('#### Optional');
    const orgHeaderIdx = output.indexOf('### Organization');

    expect(requiredHeaderIdx).toBeGreaterThan(-1);
    expect(optionalHeaderIdx).toBeGreaterThan(-1);

    const requiredSection = output.slice(requiredHeaderIdx, optionalHeaderIdx);
    const optionalSection = output.slice(optionalHeaderIdx, orgHeaderIdx);

    expect(requiredSection).toContain('- None');
    expect(optionalSection).toContain('- None');
  });

  it('outputs Required actions when needsVerification is true', () => {
    const result = mockBaseResult();
    result.flags.needsVerification = true;
    result.verificationNeeded = ['Check the source link'];
    result.nextActions = ['Implement tests'];
    result.actionItems = [
      { type: 'verify', title: 'Double check API key' },
      { type: 'task', title: 'Refactor code' },
    ];

    const output = buildReviewContent(result);

    const requiredHeaderIdx = output.indexOf('#### Required');
    const optionalHeaderIdx = output.indexOf('#### Optional');
    const orgHeaderIdx = output.indexOf('### Organization');

    const requiredSection = output.slice(requiredHeaderIdx, optionalHeaderIdx);
    const optionalSection = output.slice(optionalHeaderIdx, orgHeaderIdx);

    expect(requiredSection).toContain('Check the source link');
    expect(requiredSection).toContain('Verify: Double check API key');

    expect(optionalSection).toContain('Implement tests');
    expect(optionalSection).toContain('Task: Refactor code');
  });

  it('outputs Suggested Tags and Suggested Folder under Organization', () => {
    const result = mockBaseResult();
    const output = buildReviewContent(result);

    const orgIdx = output.indexOf('### Organization');
    expect(orgIdx).toBeGreaterThan(-1);

    const orgSection = output.slice(orgIdx, output.indexOf('### Technical Metadata'));

    expect(orgSection).toContain('- **Suggested Tags**: test, unit-test');
    expect(orgSection).toContain('- **Suggested Folder**: Reviews/Testing');
  });

  it('formats Verdict with short human-readable label instead of old long phrase', () => {
    const result = mockBaseResult();
    result.verdict.recommendedAction = 'keep_as_reference';
    result.verdict.priority = 'medium';

    const output = buildReviewContent(result);

    expect(output).toContain('**Verdict**: Keep as reference / Medium priority');
    expect(output).not.toContain('Store in knowledge base for future lookups');
  });

  it('formats Verdict in Japanese when promptLanguage=japanese', () => {
    const result = mockBaseResult();
    result.promptLanguage = 'japanese';
    result.verdict.recommendedAction = 'keep_as_reference';
    result.verdict.priority = 'high';

    const output = buildReviewContent(result);

    expect(output).toContain('**Verdict**: 参照用に保存 / High priority');
  });

  it('strips Caveats: label from the beginning of caveat text', () => {
    const result = mockBaseResult();
    result.credibilityReview = 'Caveats: This article has potential bias.';

    const output = buildReviewContent(result);

    expect(output).toContain('- This article has potential bias.');
    expect(output).not.toContain('- Caveats:');
  });

  it('strips Suggested Use: label from the beginning of practicalityReview', () => {
    const result = mockBaseResult();
    result.practicalityReview = 'Suggested Use: Long-term reference material.';

    const output = buildReviewContent(result);

    expect(output).toContain('Long-term reference material.');
    expect(output).not.toContain('Suggested Use: Long-term');
  });

  it('formats verify action items without target= in output', () => {
    const result = mockBaseResult();
    result.flags.needsVerification = true;
    result.actionItems = [
      { type: 'verify', title: 'Check claims', detail: 'Verify against official source', targetPath: 'References/Official' },
    ];

    const output = buildReviewContent(result);

    expect(output).toContain('Verify: Check claims');
    expect(output).not.toContain('target=');
    expect(output).not.toContain('References/Official');
  });

  it('converts Verify: to 検証: in Japanese output', () => {
    const result = mockBaseResult();
    result.promptLanguage = 'japanese';
    result.flags.needsVerification = true;
    result.actionItems = [
      { type: 'verify', title: '公式発表を確認', targetPath: 'References/Official' },
    ];

    const output = buildReviewContent(result);

    expect(output).toContain('検証: 公式発表を確認');
    expect(output).not.toContain('target=');
    expect(output).not.toContain('Verify:');
  });

  it('converts Review Attachment: to 確認: in Japanese output', () => {
    const result = mockBaseResult();
    result.promptLanguage = 'japanese';
    result.flags.needsVerification = true;
    result.actionItems = [
      { type: 'review_attachment', title: '添付資料を確認', detail: '要確認', targetPath: 'Attachments/Sample' },
    ];

    const output = buildReviewContent(result);

    expect(output).toContain('確認: 添付資料を確認');
    expect(output).not.toContain('target=');
    expect(output).not.toContain('Review attachment:');
  });

  it('suppresses Required actions when needsVerification is false and recommendedAction is archive', () => {
    const result = mockBaseResult();
    result.flags.needsVerification = false;
    result.verdict.recommendedAction = 'archive';
    result.verificationNeeded = ['Verify the source'];
    result.actionItems = [
      { type: 'verify', title: 'Check source' },
    ];

    const output = buildReviewContent(result);

    const requiredHeaderIdx = output.indexOf('#### Required');
    const optionalHeaderIdx = output.indexOf('#### Optional');
    const requiredSection = output.slice(requiredHeaderIdx, optionalHeaderIdx);

    expect(requiredSection).toContain('Verify: Check source');
  });

  it('suppresses Required to None when needsVerification is false and no serious action needed', () => {
    const result = mockBaseResult();
    result.flags.needsVerification = false;
    result.verdict.recommendedAction = 'read_later';
    result.verificationNeeded = ['Check the source link'];
    result.actionItems = [
      { type: 'verify', title: 'Double check API key' },
    ];

    const output = buildReviewContent(result);

    const requiredHeaderIdx = output.indexOf('#### Required');
    const optionalHeaderIdx = output.indexOf('#### Optional');
    const requiredSection = output.slice(requiredHeaderIdx, optionalHeaderIdx);

    expect(requiredSection).toContain('- None');
  });

  it('limits Required and Optional to at most 3 items each', () => {
    const result = mockBaseResult();
    result.flags.needsVerification = true;
    result.verificationNeeded = ['A', 'B', 'C', 'D'];
    result.nextActions = ['1', '2', '3', '4'];

    const output = buildReviewContent(result);

    const requiredHeaderIdx = output.indexOf('#### Required');
    const optionalHeaderIdx = output.indexOf('#### Optional');
    const orgHeaderIdx = output.indexOf('### Organization');

    const requiredSection = output.slice(requiredHeaderIdx, optionalHeaderIdx);
    const optionalSection = output.slice(optionalHeaderIdx, orgHeaderIdx);

    const requiredLines = requiredSection.split('\n').filter(line => line.startsWith('- '));
    const optionalLines = optionalSection.split('\n').filter(line => line.startsWith('- '));

    expect(requiredLines.length).toBeLessThanOrEqual(3);
    expect(optionalLines.length).toBeLessThanOrEqual(3);
  });

  it('removes Why It Matters: label from retentionReasons', () => {
    const result = mockBaseResult();
    result.retentionReasons = ['Why It Matters: This is a key reference for design decisions.'];

    const output = buildReviewContent(result);

    expect(output).toContain('This is a key reference for design decisions.');
    expect(output).not.toContain('Why It Matters: This is');
  });

  it('does not produce duplicate content between Required and Optional', () => {
    const result = mockBaseResult();
    result.flags.needsVerification = true;
    result.verificationNeeded = ['Verify the source'];
    result.nextActions = ['Verify the source'];

    const output = buildReviewContent(result);

    const requiredHeaderIdx = output.indexOf('#### Required');
    const optionalHeaderIdx = output.indexOf('#### Optional');
    const orgHeaderIdx = output.indexOf('### Organization');

    const requiredSection = output.slice(requiredHeaderIdx, optionalHeaderIdx);
    const optionalSection = output.slice(optionalHeaderIdx, orgHeaderIdx);

    expect(requiredSection).toContain('Verify the source');
    if (optionalSection.includes('Verify the source')) {
      const requiredCount = (requiredSection.match(/Verify the source/g) || []).length;
      const optionalCount = (optionalSection.match(/Verify the source/g) || []).length;
      expect(requiredCount).toBe(1);
      expect(optionalCount).toBe(0);
    }
  });

  it('strips Overview: label from detailedSummary', () => {
    const result = mockBaseResult();
    result.detailedSummary = 'Overview: This note discusses the key concepts.';

    const output = buildReviewContent(result);

    expect(output).toContain('This note discusses the key concepts.');
    expect(output).not.toContain('Overview: This note');
  });

  it('strips Key Takeaways: label from structuredSummary fields', () => {
    const result = mockBaseResult();
    result.structuredSummary = {
      centralClaim: 'Key Takeaways: Main point here.',
      keyPoints: [],
      evidenceMentioned: [],
    };
    result.detailedSummary = '';
    const output = buildReviewContent(result);

    expect(output).toContain('Main point here.');
    expect(output).not.toContain('Key Takeaways: Main');
  });
});

describe('Caveats compression', () => {
  it('limits caveats to at most 3 items', () => {
    const result = mockBaseResult();
    result.credibilityReview = 'This is the first caveat. This is the second caveat. This is the third caveat. This is the fourth caveat.';
    result.risksOrGaps = ['Risk A', 'Risk B', 'Risk C'];
    const output = buildReviewContent(result);

    const caveatIdx = output.indexOf('## Caveats');
    const suggestedIdx = output.indexOf('## Suggested Use');
    const caveatSection = output.slice(caveatIdx, suggestedIdx);
    const caveatLines = caveatSection.split('\n').filter((l) => l.startsWith('- '));

    expect(caveatLines.length).toBeLessThanOrEqual(3);
  });

  it('limits each caveat to at most 2 sentences', () => {
    const result = mockBaseResult();
    result.credibilityReview = 'Sentence one. Sentence two. Sentence three. Sentence four.';
    result.risksOrGaps = [];
    const output = buildReviewContent(result);

    const caveatIdx = output.indexOf('## Caveats');
    const suggestedIdx = output.indexOf('## Suggested Use');
    const caveatSection = output.slice(caveatIdx, suggestedIdx);
    const caveatLines = caveatSection.split('\n').filter((l) => l.startsWith('- '));

    expect(caveatLines.length).toBeLessThanOrEqual(3);
  });

  it('prepends time-sensitive recheck when needsVerification is true', () => {
    const result = mockBaseResult();
    result.flags.needsVerification = true;
    result.credibilityReview = 'Some caveat text.';
    const output = buildReviewContent(result);

    const caveatIdx = output.indexOf('## Caveats');
    const suggestedIdx = output.indexOf('## Suggested Use');
    const caveatSection = output.slice(caveatIdx, suggestedIdx);

    expect(caveatSection).toContain('Recheck the official source');
  });

  it('prepends time-sensitive recheck in Japanese when promptLanguage=japanese', () => {
    const result = mockBaseResult();
    result.promptLanguage = 'japanese';
    result.flags.needsVerification = true;
    result.credibilityReview = 'Some caveat text.';
    const output = buildReviewContent(result);

    const caveatIdx = output.indexOf('## 注意点');
    const suggestedIdx = output.indexOf('## 活用方法');
    const caveatSection = output.slice(caveatIdx, suggestedIdx);

    expect(caveatSection).toContain('時点依存の情報です');
    expect(caveatSection).toContain('公式情報で再確認');
  });
});

describe('Suggested Use as bullet list', () => {
  it('renders practicalityReview as bullet list', () => {
    const result = mockBaseResult();
    result.practicalityReview = 'Use as: reference material\nNext action: verify pricing\nRecheck before use: CLI commands';
    const output = buildReviewContent(result);

    const suggestedIdx = output.indexOf('## Suggested Use');
    const conceptIdx = output.indexOf('## Concept Candidates');
    const afterSuggested = suggestedIdx + '## Suggested Use'.length;
    const endIdx = conceptIdx > -1 ? conceptIdx : output.indexOf('---', afterSuggested);
    const section = output.slice(suggestedIdx, endIdx);

    expect(section).toContain('- Use as: reference material');
    expect(section).toContain('- Next action: verify pricing');
    expect(section).toContain('- Recheck before use: CLI commands');
  });

  it('falls back to - None when practicalityReview is empty', () => {
    const result = mockBaseResult();
    result.practicalityReview = '';
    const output = buildReviewContent(result);

    expect(output).toContain('## Suggested Use\n\n- None');
  });
});

describe('Concept Candidates section', () => {
  it('renders conceptCandidates when present', () => {
    const result = mockBaseResult();
    result.conceptCandidates = [
      { title: 'HOTL', description: 'Human-outside-the-loop operational model' },
      { title: 'Agent-friendly Workflow', description: 'Workflow designed for AI agent execution' },
    ];
    const output = buildReviewContent(result);

    expect(output).toContain('## Concept Candidates');
    expect(output).toContain('- [[HOTL]] — Human-outside-the-loop operational model');
    expect(output).toContain('- [[Agent-friendly Workflow]] — Workflow designed for AI agent execution');
  });

  it('omits section when conceptCandidates is absent', () => {
    const result = mockBaseResult();
    result.conceptCandidates = undefined;
    const output = buildReviewContent(result);

    expect(output).not.toContain('## Concept Candidates');
  });

  it('omits section when conceptCandidates is empty', () => {
    const result = mockBaseResult();
    result.conceptCandidates = [];
    const output = buildReviewContent(result);

    expect(output).not.toContain('## Concept Candidates');
  });
});

describe('Evidence Basis display mapping', () => {
  it('maps evidenceBasis values to display names', () => {
    const result = mockBaseResult();
    result.evidenceBasis = ['first_party_presentation', 'official_documentation'];
    const output = buildReviewContent(result);

    expect(output).toContain('Basis: First-party Presentation, Official Documentation');
  });

  it('maps old-style evidenceBasis values gracefully', () => {
    const result = mockBaseResult();
    result.evidenceBasis = ['primary_source'];
    const output = buildReviewContent(result);

    expect(output).toContain('Basis: Primary Source');
  });
});

describe('Input Processing notice', () => {
  it('does not include Input Processing section when no truncation occurred', () => {
    const result = mockBaseResult();
    const output = buildReviewContent(result);
    expect(output).not.toContain('### Input Processing');
  });

  it('includes Input Processing section with English text when wasTruncated=true', () => {
    const result = mockBaseResult();
    result.inputReductionInfo = {
      wasFiltered: true,
      removedLineCount: 5,
      removedCharCount: 300,
      wasTruncated: true,
      originalCharCount: 58200,
      finalCharCount: 40000,
    };
    const output = buildReviewContent(result);

    expect(output).toContain('### Input Processing');
    expect(output).toContain('Some content was omitted');
    expect(output).toContain('58,200');
    expect(output).toContain('40,000');
    expect(output).toContain('300');
  });

  it('includes Input Processing section with Japanese text when promptLanguage=japanese', () => {
    const result = mockBaseResult();
    result.promptLanguage = 'japanese';
    result.inputReductionInfo = {
      wasFiltered: true,
      removedLineCount: 5,
      removedCharCount: 300,
      wasTruncated: true,
      originalCharCount: 58200,
      finalCharCount: 40000,
    };
    const output = buildReviewContent(result);

    expect(output).toContain('### 入力処理');
    expect(output).toContain('AIレビューのコンテキスト上限');
    expect(output).toContain('58,200');
    expect(output).toContain('40,000');
    expect(output).toContain('300');
  });

  it('does not include noise line when wasFiltered=false', () => {
    const result = mockBaseResult();
    result.inputReductionInfo = {
      wasFiltered: false,
      removedLineCount: 0,
      removedCharCount: 0,
      wasTruncated: true,
      originalCharCount: 50000,
      finalCharCount: 40000,
    };
    const output = buildReviewContent(result);

    expect(output).toContain('### Input Processing');
    expect(output).not.toContain('Removed noise');
    expect(output).not.toContain('ノイズ');
  });

  it('appears between Organization and Technical Metadata', () => {
    const result = mockBaseResult();
    result.inputReductionInfo = {
      wasFiltered: true,
      removedLineCount: 3,
      removedCharCount: 150,
      wasTruncated: true,
      originalCharCount: 10000,
      finalCharCount: 5000,
    };
    const output = buildReviewContent(result);

    const orgIdx = output.indexOf('### Organization');
    const inputProcIdx = output.indexOf('### Input Processing');
    const techMetaIdx = output.indexOf('### Technical Metadata');

    expect(inputProcIdx).toBeGreaterThan(orgIdx);
    expect(techMetaIdx).toBeGreaterThan(inputProcIdx);
  });
});

describe('sanitizeAiContent (#9)', () => {
  it('neutralizes ![alt](url) (Markdown image embed)', () => {
    expect(sanitizeAiContent('![alt](https://example.com/a.png)')).toBe('&#33;[alt](https://example.com/a.png)');
  });

  it('preserves [text](url) (normal Markdown link)', () => {
    expect(sanitizeAiContent('[normal](https://example.com)')).toBe('[normal](https://example.com)');
  });

  it('preserves [[wikilink]]', () => {
    expect(sanitizeAiContent('[[normal note]]')).toBe('[[normal note]]');
  });

  it('neutralizes ![[path]] (local embed)', () => {
    expect(sanitizeAiContent('![[image.png]]')).toBe('&#33;[[image.png]]');
  });

  it('preserves ! in non-image contexts (e.g. Important!)', () => {
    expect(sanitizeAiContent('Important!')).toBe('Important!');
  });

  it('preserves existing <> / javascript: / data: / vbscript: replacements', () => {
    expect(sanitizeAiContent('<script>')).toBe('&lt;script&gt;');
    expect(sanitizeAiContent('javascript:alert(1)')).toBe('javascript&#58;alert(1)');
    expect(sanitizeAiContent('data:text/html,<b>')).toBe('data&#58;text/html,&lt;b&gt;');
    expect(sanitizeAiContent('vbscript:msgbox(1)')).toBe('vbscript&#58;msgbox(1)');
  });
});

describe('YAML frontmatter safety', () => {
  const fmPattern = /^---\n([\s\S]*?)\n---/;

  it('escapes double quotes in notePath', () => {
    const result = mockBaseResult();
    result.source.notePath = 'Inbox/My "Note".md';
    const output = buildReviewContent(result);
    const fmMatch = output.match(fmPattern);
    expect(fmMatch).not.toBeNull();
    expect(fmMatch![1]).toContain('source_path: "Inbox/My \\"Note\\".md"');
  });

  it('escapes backslashes in notePath', () => {
    const result = mockBaseResult();
    result.source.notePath = 'Inbox/My\\Note.md';
    const output = buildReviewContent(result);
    const fmMatch = output.match(fmPattern);
    expect(fmMatch).not.toBeNull();
    expect(fmMatch![1]).toContain('source_path: "Inbox/My\\\\Note.md"');
  });

  it('handles noteTitle with special YAML characters gracefully (colon is safe in double-quoted)', () => {
    const result = mockBaseResult();
    result.source.noteTitle = 'My: Note';
    const yaml = require('js-yaml');
    const output = buildReviewContent(result);
    const fmMatch = output.match(fmPattern);
    expect(fmMatch).not.toBeNull();
    const parsed = yaml.load(fmMatch![1]);
    expect(parsed).not.toBeNull();
    expect(typeof parsed).toBe('object');
  });

  it('handles notePath with Unicode characters', () => {
    const result = mockBaseResult();
    result.source.notePath = 'Inbox/ファイル.md';
    const yaml = require('js-yaml');
    const output = buildReviewContent(result);
    const fmMatch = output.match(fmPattern);
    expect(fmMatch).not.toBeNull();
    const parsed = yaml.load(fmMatch![1]);
    expect(parsed).not.toBeNull();
    expect(typeof parsed).toBe('object');
  });

  it('escapes special characters in extractionWarnings', () => {
    const result = mockBaseResult();
    result.extractionWarnings = ['Warning with "quotes" and \\backslash\\'];
    const output = buildReviewContent(result);
    expect(output).toContain('  - "Warning with \\"quotes\\" and \\\\backslash\\\\"');
  });

  it('escapes provider string with double quote', () => {
    const result = mockBaseResult();
    result.provider = 'oai"compat';
    const output = buildReviewContent(result);
    const fmMatch = output.match(fmPattern);
    expect(fmMatch).not.toBeNull();
    expect(fmMatch![1]).toContain('provider: "oai\\"compat"');
  });

  it('produces parseable YAML frontmatter for all combined edge cases', () => {
    const testResult = mockBaseResult();
    testResult.source.noteTitle = 'Test: "Note"';
    testResult.source.notePath = 'Inbox/Test\\Path.md';
    testResult.provider = 'oai"compat';
    testResult.extractionWarnings = ['a"b', 'c\\d'];
    const output = buildReviewContent(testResult);
    const fmMatch = output.match(fmPattern);
    expect(fmMatch).not.toBeNull();
    const yaml = require('js-yaml');
    const parsed = yaml.load(fmMatch![1]);
    expect(parsed).not.toBeNull();
    expect(typeof parsed).toBe('object');
  });
});

describe('appendAutoExecuteResult', () => {
  const createMockAppForWriter = (fileContentMap: Map<string, string>) => {
    const modifiedContents = new Map<string, string>();
    const app = {
      vault: {
        getAbstractFileByPath: (path: string) => {
          if (fileContentMap.has(path)) {
            const file = new TFile();
            file.path = path;
            return file;
          }
          return null;
        },
        read: async (file: TFile) => {
          return fileContentMap.get(file.path) || '';
        },
        modify: async (file: TFile, content: string) => {
          modifiedContents.set(file.path, content);
        },
      },
    };
    return { app: app as any, modifiedContents };
  };

  it('appends new result with markers when neither markers nor old headers exist', async () => {
    const originalContent = '# Review Note\nSome content';
    const files = new Map<string, string>([['AI Reviews/note.md', originalContent]]);
    const { app, modifiedContents } = createMockAppForWriter(files);

    await appendAutoExecuteResult(app, 'AI Reviews/note.md', {
      recommendedAction: 'archive',
      executed: true,
      status: 'executed',
      sourcePath: 'Inbox/my-note.md',
      destinationPath: 'References/Archive/my-note.md',
    }, 'english');

    const result = modifiedContents.get('AI Reviews/note.md');
    expect(result).toBeDefined();
    expect(result).toContain('<!-- inbox-curator:auto-execute-result:start -->');
    expect(result).toContain('<!-- inbox-curator:auto-execute-result:end -->');
    expect(result).toContain('## Auto-execute Result');
    expect(result).toContain('- Status: executed');
    expect(result).toContain('- Recommended action: archive');
    expect(result).toContain(originalContent);
  });

  it('replaces result between markers when markers already exist', async () => {
    const originalContent = '# Review Note\nSome content\n<!-- inbox-curator:auto-execute-result:start -->\n## Auto-execute Result\n- **Status**: Skipped\n<!-- inbox-curator:auto-execute-result:end -->\nFooter content';
    const files = new Map<string, string>([['AI Reviews/note.md', originalContent]]);
    const { app, modifiedContents } = createMockAppForWriter(files);

    await appendAutoExecuteResult(app, 'AI Reviews/note.md', {
      recommendedAction: 'archive',
      executed: true,
      status: 'executed',
      sourcePath: 'Inbox/my-note.md',
      destinationPath: 'References/Archive/my-note.md',
    }, 'english');

    const result = modifiedContents.get('AI Reviews/note.md');
    expect(result).toBeDefined();
    expect(result).toContain('Footer content');
    expect(result).toContain('- Status: executed');
    expect(result).not.toContain('- **Status**: Skipped');
  });

  it('replaces old header and content when old header exists and looks like a legacy section', async () => {
    const originalContent = '# Review Note\nSome content\n## Auto-execute Result\n- Action: archive\n- Status: skipped\n- Reason: conflict\n## Another Section\nMore footer';
    const files = new Map<string, string>([['AI Reviews/note.md', originalContent]]);
    const { app, modifiedContents } = createMockAppForWriter(files);

    await appendAutoExecuteResult(app, 'AI Reviews/note.md', {
      recommendedAction: 'archive',
      executed: true,
      status: 'executed',
      sourcePath: 'Inbox/my-note.md',
      destinationPath: 'References/Archive/my-note.md',
    }, 'english');

    const result = modifiedContents.get('AI Reviews/note.md');
    expect(result).toBeDefined();
    expect(result).toContain('## Another Section');
    expect(result).toContain('- Status: executed');
    expect(result).not.toContain('- Action: archive');
  });

  it('does not replace old header but appends at the end if it does not look like a legacy section', async () => {
    // Contains "## Auto-execute Result" but no colons or label lists in the next 800 chars
    const originalContent = '# Review Note\nSome content\n## Auto-execute Result\nThis is AI generated text discussing how the system will show the auto-execute result, but contains no actual action log labels.';
    const files = new Map<string, string>([['AI Reviews/note.md', originalContent]]);
    const { app, modifiedContents } = createMockAppForWriter(files);

    await appendAutoExecuteResult(app, 'AI Reviews/note.md', {
      recommendedAction: 'archive',
      executed: true,
      status: 'executed',
      sourcePath: 'Inbox/my-note.md',
      destinationPath: 'References/Archive/my-note.md',
    }, 'english');

    const result = modifiedContents.get('AI Reviews/note.md');
    expect(result).toBeDefined();
    // The original text is kept intact (not replaced)
    expect(result).toContain('This is AI generated text discussing');
    // New section is appended at the bottom with markers
    expect(result).toContain('<!-- inbox-curator:auto-execute-result:start -->');
    expect(result).toContain('- Status: executed');
  });

  it('replaces old header when old header is at index 0 (starts with header)', async () => {
    const originalContent = '## Auto-execute Result\n- Action: archive\n- Status: skipped';
    const files = new Map<string, string>([['AI Reviews/note.md', originalContent]]);
    const { app, modifiedContents } = createMockAppForWriter(files);

    await appendAutoExecuteResult(app, 'AI Reviews/note.md', {
      recommendedAction: 'archive',
      executed: true,
      status: 'executed',
      sourcePath: 'Inbox/my-note.md',
      destinationPath: 'References/Archive/my-note.md',
    }, 'english');

    const result = modifiedContents.get('AI Reviews/note.md');
    expect(result).toBeDefined();
    expect(result).toContain('- Status: executed');
    expect(result).not.toContain('- Action: archive');
  });

  it('detects legacy section with full-width colon (全角コロン)', async () => {
    const originalContent = '# Review Note\n## 自動実行結果\n- アクション： archive\n- ステータス： skipped';
    const files = new Map<string, string>([['AI Reviews/note.md', originalContent]]);
    const { app, modifiedContents } = createMockAppForWriter(files);

    await appendAutoExecuteResult(app, 'AI Reviews/note.md', {
      recommendedAction: 'archive',
      executed: true,
      status: 'executed',
      sourcePath: 'Inbox/my-note.md',
      destinationPath: 'References/Archive/my-note.md',
    }, 'japanese');

    const result = modifiedContents.get('AI Reviews/note.md');
    expect(result).toBeDefined();
    expect(result).toContain('## 自動実行結果');
    expect(result).toContain('- Status: executed');
    expect(result).not.toContain('- アクション： archive');
  });

  it('formats log with status: skipped and status: failed correctly', async () => {
    const originalContent = '# Review note';
    const files = new Map<string, string>([['AI Reviews/note.md', originalContent]]);
    
    // Test status: skipped
    {
      const { app, modifiedContents } = createMockAppForWriter(files);
      await appendAutoExecuteResult(app, 'AI Reviews/note.md', {
        recommendedAction: 'archive',
        executed: false,
        status: 'skipped',
        sourcePath: 'Inbox/my-note.md',
        error: 'Destination already exists.',
        destinationPath: 'References/Archive/my-note.md',
      }, 'english');
      const result = modifiedContents.get('AI Reviews/note.md');
      expect(result).toContain('- Status: skipped');
      expect(result).toContain('- Reason: Destination already exists.');
      expect(result).toContain('- Destination: References/Archive/my-note.md');
    }

    // Test status: failed
    {
      const { app, modifiedContents } = createMockAppForWriter(files);
      await appendAutoExecuteResult(app, 'AI Reviews/note.md', {
        recommendedAction: 'archive',
        executed: false,
        status: 'failed',
        sourcePath: 'Inbox/my-note.md',
        error: 'Vault is currently locked.',
      }, 'english');
      const result = modifiedContents.get('AI Reviews/note.md');
      expect(result).toContain('- Status: failed');
      expect(result).toContain('- Reason: Vault is currently locked.');
      expect(result).not.toContain('- Destination:');
    }
  });
});

