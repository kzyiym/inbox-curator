export type ContextBudgetPreset = 'small' | 'standard' | 'large' | 'custom';

export interface ReviewContextBudget {
  maxContextTokens: number;
  maxInputContentTokens: number;
  maxOutputTokens: number;
  safetyMarginTokens: number;
  estimatedCharsPerToken: number;
  maxInputContentChars: number;
}

type PresetDefinition = Omit<ReviewContextBudget, 'estimatedCharsPerToken' | 'maxInputContentChars'>;

const PRESET_BUDGETS: Record<'small' | 'standard' | 'large', PresetDefinition> = {
  small: {
    maxContextTokens: 8192,
    maxInputContentTokens: 5000,
    maxOutputTokens: 1024,
    safetyMarginTokens: 1000,
  },
  standard: {
    maxContextTokens: 32000,
    maxInputContentTokens: 20000,
    maxOutputTokens: 4096,
    safetyMarginTokens: 3000,
  },
  large: {
    maxContextTokens: 64000,
    maxInputContentTokens: 40000,
    maxOutputTokens: 4096,
    safetyMarginTokens: 6000,
  },
};

export const REVIEW_CONTEXT_BUDGET: ReviewContextBudget = {
  ...PRESET_BUDGETS.standard,
  estimatedCharsPerToken: 2,
  maxInputContentChars: PRESET_BUDGETS.standard.maxInputContentTokens * 2,
};

export function resolveReviewContextBudget(
  preset: ContextBudgetPreset,
  custom?: { maxContextTokens: number; maxInputContentTokens: number; maxOutputTokens: number; safetyMarginTokens: number },
): ReviewContextBudget {
  let base: PresetDefinition;

  if (preset === 'custom') {
    if (!custom) {
      base = PRESET_BUDGETS.standard;
    } else {
      const maxContextTokens = Math.max(4096, Math.min(1000000, Math.round(custom.maxContextTokens)));
      const maxOutputTokens = Math.max(256, Math.min(65536, Math.round(custom.maxOutputTokens)));
      const safetyMarginTokens = Math.max(0, Math.min(100000, Math.round(custom.safetyMarginTokens)));
      const availableForInput = maxContextTokens - maxOutputTokens - safetyMarginTokens;
      const maxInputContentTokens = Math.max(1000, Math.min(
        Math.round(custom.maxInputContentTokens),
        availableForInput,
      ));
      base = { maxContextTokens, maxInputContentTokens, maxOutputTokens, safetyMarginTokens };
    }
  } else {
    base = PRESET_BUDGETS[preset];
  }

  return {
    ...base,
    estimatedCharsPerToken: 2,
    maxInputContentChars: base.maxInputContentTokens * 2,
  };
}

export interface ContentFilterResult {
  content: string;
  removedLineCount: number;
  removedCharCount: number;
  wasFiltered: boolean;
}

export interface InputContentReductionInfo {
  wasFiltered: boolean;
  removedLineCount: number;
  removedCharCount: number;
  wasTruncated: boolean;
  originalCharCount: number;
  finalCharCount: number;
}

const HTML_TAG_OPEN_PATTERNS = [
  '<iframe\\b',
  '<script\\b',
  '<style\\b',
];

const HTML_TAG_CLOSE_PATTERNS = [
  '</iframe>',
  '</script>',
  '</style>',
];

const AD_DOMAIN_PATTERNS = [
  'safeframe',
  'doubleclick.net',
  'googlesyndication.com',
  'googletagmanager.com',
  'googleads.g.doubleclick.net',
  'adservice.google',
  'platform.twitter.com/widgets',
  'gmossp',
  'reemo-ad',
];

const AD_LABEL_EXACT = [
  'advertisement',
  'sponsored',
  'sponsored link',
  'スポンサー',
  'スポンサーリンク',
  'スポンサードリンク',
];

function isHtmlTagLine(trimmed: string): boolean {
  for (const pattern of HTML_TAG_OPEN_PATTERNS) {
    if (new RegExp(pattern, 'i').test(trimmed)) return true;
  }
  for (const pattern of HTML_TAG_CLOSE_PATTERNS) {
    if (trimmed.includes(pattern)) return true;
  }
  return false;
}

function containsAdDomain(trimmed: string): boolean {
  for (const domain of AD_DOMAIN_PATTERNS) {
    if (trimmed.includes(domain)) return true;
  }
  return false;
}

function isAdLabelLine(trimmed: string): boolean {
  if (AD_LABEL_EXACT.includes(trimmed)) return true;
  if (/^(?:[#\s\-*]*)(?:advertisement|広告|sponsored|スポンサーリンク|スポンサードリンク|iframe)(?:[#\s\-*]*)$/i.test(trimmed)) return true;
  return false;
}

export function isAdOrIframeLine(line: string): boolean {
  const trimmed = line.trim().toLowerCase();
  if (!trimmed) return false;
  if (isHtmlTagLine(trimmed)) return true;
  if (containsAdDomain(trimmed)) return true;
  if (isAdLabelLine(trimmed)) return true;
  return false;
}

export function filterAiReviewInputContent(content: string): ContentFilterResult {
  const lines = content.split('\n');
  let removedLineCount = 0;
  let removedCharCount = 0;
  const filtered: string[] = [];

  for (const line of lines) {
    if (isAdOrIframeLine(line)) {
      removedLineCount += 1;
      removedCharCount += line.length + 1;
    } else {
      filtered.push(line);
    }
  }

  const result = filtered.join('\n');
  return {
    content: result,
    removedLineCount,
    removedCharCount,
    wasFiltered: removedLineCount > 0,
  };
}

export function truncateContent(
  content: string,
  maxChars: number,
): { content: string; wasTruncated: boolean; truncatedCharCount: number } {
  if (content.length <= maxChars) {
    return { content, wasTruncated: false, truncatedCharCount: 0 };
  }

  const truncated = content.slice(0, maxChars);
  const lastNewline = truncated.lastIndexOf('\n');
  const lastPeriod = truncated.lastIndexOf('。');
  const lastDot = truncated.lastIndexOf('.');

  let breakPoint = -1;
  if (lastNewline > maxChars * 0.8) {
    breakPoint = lastNewline;
  } else if (lastPeriod > maxChars * 0.8) {
    breakPoint = lastPeriod + 1;
  } else if (lastDot > maxChars * 0.8) {
    breakPoint = lastDot + 1;
  }

  const actualBreak = breakPoint > 0 ? breakPoint : maxChars;
  const finalContent = content.slice(0, actualBreak).trimEnd();
  const truncatedCharCount = content.length - finalContent.length;

  return {
    content: finalContent,
    wasTruncated: true,
    truncatedCharCount,
  };
}
