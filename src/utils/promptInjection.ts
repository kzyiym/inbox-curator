const PROMPT_INJECTION_PATTERNS = [
  /ignore previous instructions/i,
  /ignore all previous instructions/i,
  /disregard previous instructions/i,
  /system prompt/i,
  /developer message/i,
  /recommended action/i,
  /^#\s*action\b/im,
  /^action\s*:/im,
  /^importance\s*:/im,
  /この指示に従/i,
  /前の指示を無視/i,
  /以前の指示を無視/i,
  /AIへ/i,
  /ChatGPTへ/i,
];

export function hasPromptInjectionSignals(input: string): boolean {
  if (!input) return false;
  return PROMPT_INJECTION_PATTERNS.some((pattern) => pattern.test(input));
}
