const PROMPT_INJECTION_PATTERNS = [
  /ignore\s+(?:all\s+)?(?:previous|prior|above)\s+instructions/i,
  /disregard\s+(?:all\s+)?(?:previous|prior|above)\s+instructions/i,
  /forget\s+(?:all\s+)?(?:previous|prior|above)\s+instructions/i,
  /follow\s+(?:these|the following|new)\s+instructions/i,
  /(?:reveal|print|repeat|show)\s+(?:the\s+)?(?:system prompt|developer message|hidden instructions)/i,
  /system\s+prompt/i,
  /developer\s+message/i,
  /you\s+are\s+now\b/i,
  /\bjailbreak\b/i,
  /recommended action/i,
  /^#\s*action\b/im,
  /^action\s*:/im,
  /^importance\s*:/im,
  /以前の指示を(?:無視|忘れ)/i,
  /前の指示を(?:無視|忘れ)/i,
  /上記の指示を(?:無視|忘れ)/i,
  /(?:この|以下の|新しい)指示に従/i,
  /(?:システムプロンプト|開発者メッセージ|隠された指示).*(?:表示|出力|開示)/i,
  /AI(?:へ|に)指示/i,
  /ChatGPT(?:へ|に)指示/i,
];

export function hasPromptInjectionSignals(input: string): boolean {
  if (!input) return false;
  return PROMPT_INJECTION_PATTERNS.some((pattern) => pattern.test(input));
}
