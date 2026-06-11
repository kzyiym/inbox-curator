export type ReviewAction =
  | "none"
  | "archive"
  | "read_later"
  | "task"
  | "delete_candidate";

export type ReviewParseStatus =
  | "parsed"
  | "partial"
  | "fallback"
  | "failed";

export type ReviewConfidence = "low" | "medium" | "high";

export type AutoSortSkipReason =
  | "safe_mode"
  | "parse_status"
  | "confidence_low"
  | "task_requires_high"
  | "delete_candidate"
  | "setting_disabled"
  | "reliability_low"
  | "prompt_injection"
  | "none_action";

export type ReviewInputTrimResult = {
  text: string;
  truncated: boolean;
  originalLength: number;
  finalLength: number;
};

const JAPANESE_HEADERS: Record<string, string> = {
  "要約": "summary",
  "重要度": "importance",
  "アクション": "action",
  "推奨アクション": "action",
  "理由": "reason",
};

export function normalizeReviewAction(value: string | undefined): ReviewAction {
  if (!value) return "none";
  const clean = value.trim();
  if (!clean) return "none";

  const lower = clean.toLowerCase();
  const stripped = lower.replace(/[\s_-]/g, "");

  if (stripped === "readlater" || stripped === "read" || stripped === "readlater)" || stripped === "read)") {
    return "read_later";
  }
  if (stripped === "archive" || stripped === "archivenote" || stripped === "archived") {
    return "archive";
  }
  if (stripped === "task" || stripped === "turnintotask" || stripped === "tasks") {
    return "task";
  }
  if (stripped === "deletecandidate" || stripped === "delete" || stripped === "deletecandidate)") {
    return "delete_candidate";
  }
  if (stripped === "none" || stripped === "不要") {
    return "none";
  }

  if (stripped === "なし") return "none";
  if (stripped === "アーカイブ") return "archive";
  if (stripped === "あとで読む" || stripped === "後で読む" || stripped === "あとで読") return "read_later";
  if (stripped === "タスク") return "task";
  if (stripped === "削除候補") return "delete_candidate";

  return "none";
}

export interface SimpleReviewParseResult {
  summary: string;
  importance: string;
  action: ReviewAction;
  reason: string;
  parseStatus: ReviewParseStatus;
  rawFallback: string;
}

function matchJapaneseHeaderEntry(trimmed: string): { jp: string; en: string } | undefined {
  for (const [jp, en] of Object.entries(JAPANESE_HEADERS)) {
    if (trimmed.startsWith(jp)) {
      return { jp, en };
    }
  }
  return undefined;
}

export function parseReviewResponse(text: string): SimpleReviewParseResult {
  if (!text || text.trim().length === 0) {
    return { summary: "", importance: "medium", action: "none", reason: "", parseStatus: "failed", rawFallback: "" };
  }

  const rawFallback = text.trim();

  let summary = "";
  let importance = "medium";
  let action: ReviewAction = "none";
  let reason = "";

  const lines = rawFallback.split("\n");
  const sections: Record<string, string[]> = { summary: [], importance: [], action: [], reason: [] };
  let currentSection = "";

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const enHeaderMatch = trimmed.match(/^#+\s*(summary|importance|action|reason)\b/i);
    if (enHeaderMatch) {
      currentSection = enHeaderMatch[1].toLowerCase();
      const rest = trimmed.slice(enHeaderMatch[0].length).trim();
      if (rest) {
        sections[currentSection].push(rest);
      }
      continue;
    }

    const stripped = trimmed.replace(/^#+\s*/, "");
    const jpEntry = matchJapaneseHeaderEntry(stripped);
    if (jpEntry) {
      currentSection = jpEntry.en;
      const rest = stripped.slice(jpEntry.jp.length).trim();
      if (rest) {
        sections[currentSection].push(rest);
      }
      continue;
    }

    if (currentSection) {
      sections[currentSection].push(trimmed);
    }
  }

  summary = sections.summary.join(" ").trim();
  if (sections.importance.length > 0) {
    const raw = sections.importance[0].trim().toLowerCase();
    if (raw === "high" || raw === "medium" || raw === "low") {
      importance = raw;
    }
  }
  action = normalizeReviewAction(sections.action[0]);
  reason = sections.reason.join(" ").trim();

  // Second pass: try colon-based formats (Summary: ..., Action: ..., recommended_action: ...)
  // Strips markdown markers (*, -, #, **) and other noise before matching.
  if (!summary || action === "none" || !reason || importance === "medium") {
    for (const line of lines) {
      let trimmed = line.trim();
      // Strip markdown markers from start and end
      trimmed = trimmed.replace(/^[#*-]\s*/, "").replace(/^\*+\s*/, "");
      trimmed = trimmed.replace(/\*+/g, "").trim();

      if (!summary) {
        const summaryMatch = trimmed.match(/^summary[:\s]+(.+)$/i);
        if (summaryMatch) { summary = summaryMatch[1].trim(); continue; }
      }

      if (action === "none") {
        const actionMatch = trimmed.match(/^(?:recommended[\s_])?action[:\s]+(.+)$/i);
        if (actionMatch) {
          const candidate = normalizeReviewAction(actionMatch[1].trim());
          if (candidate !== "none") { action = candidate; continue; }
        }
      }

      if (importance === "medium") {
        const impMatch = trimmed.match(/^importance[:\s]+(.+)$/i);
        if (impMatch) {
          const raw = impMatch[1].trim().toLowerCase();
          if (raw === "high" || raw === "medium" || raw === "low") { importance = raw; continue; }
        }
      }

      if (!reason) {
        const reasonMatch = trimmed.match(/^reason[:\s]+(.+)$/i);
        if (reasonMatch) { reason = reasonMatch[1].trim(); continue; }
      }
    }
  }

  const hasSummary = summary.length > 0;
  const hasAction = action !== "none" || sections.action.length > 0;

  let parseStatus: ReviewParseStatus;
  if (hasSummary && (hasAction || reason.length > 0)) {
    parseStatus = "parsed";
  } else if (hasSummary || hasAction || reason.length > 0) {
    parseStatus = "partial";
  } else if (rawFallback.length > 0) {
    parseStatus = "fallback";
  } else {
    parseStatus = "failed";
  }

  return { summary, importance, action, reason, parseStatus, rawFallback };
}

const MIN_SUMMARY_LENGTH = 8;
const MIN_REASON_LENGTH = 3;
const MIN_RAW_RESPONSE_LENGTH = 20;
const MAX_FALLBACK_RAW_LENGTH = 3000;

function appearsTruncated(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (t.endsWith(".") || t.endsWith("。") || t.endsWith("!") || t.endsWith("？") || t.endsWith("」") || t.endsWith(")")) return false;
  if (t.endsWith("```") || t.endsWith("---") || t.endsWith("...")) return false;
  const lastLine = t.split("\n").pop()?.trim() || "";
  if (lastLine.length < 1) return false;
  if (/^[#*\-–—•·:]$/.test(lastLine)) return true;
  if (/[.!?。！？]$/.test(lastLine)) return false;
  return lastLine.length > 0 && lastLine.length < 15;
}

export function computeReviewConfidence(params: {
  parseStatus: ReviewParseStatus;
  action: ReviewAction;
  summary?: string;
  reason?: string;
  rawResponse?: string;
  reviewMode: import('./types').ReviewMode;
}): ReviewConfidence {
  if (params.parseStatus === "failed") return "low";
  if (params.parseStatus === "fallback") return "low";

  if (params.reviewMode === "safe") return "low";

  if (params.parseStatus === "partial") {
    if (params.summary && params.summary.length >= MIN_SUMMARY_LENGTH) return "medium";
    return "low";
  }

  if (params.action === "delete_candidate") return "medium";

  if (!params.summary || params.summary.length < MIN_SUMMARY_LENGTH) return "low";
  if (!params.reason || params.reason.length < MIN_REASON_LENGTH) return "medium";
  if (!params.rawResponse || params.rawResponse.length < MIN_RAW_RESPONSE_LENGTH) return "medium";

  if (appearsTruncated(params.rawResponse)) return "medium";

  return "high";
}

export function canAutoExecuteReviewAction(
  action: ReviewAction,
  parseStatus: ReviewParseStatus,
  confidence: ReviewConfidence,
  reviewMode: import('./types').ReviewMode,
  settings: {
    autoExecuteArchive: boolean;
    autoExecuteReadLater: boolean;
    autoExecuteTask: boolean;
  },
): boolean {
  if (reviewMode === "safe") return false;
  if (parseStatus !== "parsed") return false;
  if (action === "none") return false;
  if (action === "delete_candidate") return false;

  if (action === "archive") return confidence !== "low" && settings.autoExecuteArchive;
  if (action === "read_later") return confidence !== "low" && settings.autoExecuteReadLater;
  if (action === "task") return confidence === "high" && settings.autoExecuteTask;

  return false;
}

function buildFallbackDetailedSummary(parsed: SimpleReviewParseResult): string {
  const lang = looksJapanese(parsed.rawFallback) ? "ja" : "en";
  const truncated = parsed.rawFallback.length > MAX_FALLBACK_RAW_LENGTH;
  const raw = truncated ? parsed.rawFallback.slice(0, MAX_FALLBACK_RAW_LENGTH) + "\n\n[...truncated]" : parsed.rawFallback;
  if (lang === "ja") {
    return `## AI Review\n\n> AI応答を完全には解析できませんでした。自動実行はスキップされました。\n\n${raw}`;
  }
  return `## AI Review\n\n> The AI response could not be fully parsed. Auto-execution was skipped.\n\n${raw}`;
}

function looksJapanese(text: string): boolean {
  return /[\u3000-\u9fff\u3040-\u309f\u30a0-\u30ff]/.test(text);
}

export function buildSimpleReviewJson(
  parsed: SimpleReviewParseResult,
  source: {
    noteTitle: string;
    notePath: string;
    outputPath: string;
    generatedAt: string;
    sourceHash: string;
    sourceUrl?: string;
  },
  reviewMode?: import('./types').ReviewMode,
): Record<string, unknown> {
  let readingValueLabel: "high" | "medium" | "low" = "medium";
  let savingValueLabel: "high" | "medium" | "low" = "medium";
  let priority: "high" | "medium" | "low" = "medium";

  if (parsed.importance === "high") {
    readingValueLabel = "high";
    savingValueLabel = "high";
    priority = "high";
  } else if (parsed.importance === "low") {
    readingValueLabel = "low";
    savingValueLabel = "low";
    priority = "low";
  }

  let recommendedAction: string;
  if (reviewMode === "safe") {
    recommendedAction = "keep_as_reference";
  } else {
    switch (parsed.action) {
      case "archive": recommendedAction = "archive"; break;
      case "read_later": recommendedAction = "read_later"; break;
      case "task": recommendedAction = "task"; break;
      case "delete_candidate": recommendedAction = "delete_candidate"; break;
      default: recommendedAction = "archive"; break;
    }
  }

  const confidence = computeReviewConfidence({
    parseStatus: parsed.parseStatus,
    action: parsed.action,
    summary: parsed.summary,
    reason: parsed.reason,
    rawResponse: parsed.rawFallback,
    reviewMode: reviewMode || "simple",
  });

  const reliabilityLabel: "high" | "medium" | "low" =
    confidence === "high" ? "high" : confidence === "medium" ? "medium" : "low";

  const isFallback = parsed.parseStatus === "fallback";
  const summaryList = isFallback
    ? []
    : parsed.summary
      ? [parsed.summary]
      : [];
  const detailedSummary = isFallback
    ? buildFallbackDetailedSummary(parsed)
    : parsed.summary || "";
  const decisionReasonText = isFallback ? undefined : (parsed.reason || undefined);

  return {
    source: {
      noteTitle: source.noteTitle,
      notePath: source.notePath,
      outputPath: source.outputPath,
      generatedAt: source.generatedAt,
      sourceHash: source.sourceHash,
      sourceUrl: source.sourceUrl,
    },
    contentType: "plain_note",
    inputProfile: "unknown",
    fetchStatus: "not_applicable",
    domainProfile: "none",
    provider: "unknown",
    model: "unknown",
    verdict: {
      readingValueLabel,
      savingValueLabel,
      reliabilityLabel,
      recommendedAction,
      priority,
    },
    scores: {
      readingValue: 50,
      savingValue: 50,
      reliability: 50,
      practicality: 50,
    },
    summary: summaryList,
    detailedSummary,
    credibilityReview: "",
    practicalityReview: "",
    decisionReason: decisionReasonText,
    retentionReasons: [],
    evidenceBasis: [],
    strengths: [],
    risksOrGaps: [],
    verificationNeeded: [],
    nextActions: [],
    actionItems: [],
    suggestedTags: [],
    suggestedFolder: undefined,
    flags: {
      needsVerification: false,
      deleteCandidate: parsed.action === "delete_candidate",
    },
  };
}

export function trimContentForMode(
  content: string,
  mode: import('./types').ReviewMode,
  maxChars: number | undefined,
): ReviewInputTrimResult {
  const originalLength = content.length;

  const baseLimit = typeof maxChars === 'number' && maxChars > 0 ? maxChars : originalLength;
  let limit: number;
  switch (mode) {
    case "safe": limit = Math.min(baseLimit, 4000); break;
    case "simple": limit = Math.min(baseLimit, 8000); break;
    default: limit = baseLimit; break;
  }

  if (originalLength <= limit) {
    return { text: content, truncated: false, originalLength, finalLength: originalLength };
  }

  return { text: content.slice(0, limit), truncated: true, originalLength, finalLength: limit };
}
