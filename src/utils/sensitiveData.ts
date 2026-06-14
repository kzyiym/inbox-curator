const SENSITIVE_KEY = /^(?:api[-_]?key|authorization|access[-_]?token|refresh[-_]?token|token|secret|password|credential)s?$/i;
const DATA_URL = /(data:[^;,\s]+;base64,)[a-zA-Z0-9+/=]+/g;
const BEARER_TOKEN = /\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi;
const KEY_VALUE_SECRET = /\b(api[-_]?key|access[-_]?token|refresh[-_]?token|secret|password|credential)\b(\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;&]+)/gi;
const URL_SECRET = /([?&](?:key|api_key|apiKey|token|access_token|secret|password)=)[^&#\s]+/gi;

export function sanitizeSensitiveString(value: string): string {
  return value
    .replace(DATA_URL, '$1[OMITTED]')
    .replace(BEARER_TOKEN, '$1[REDACTED]')
    .replace(KEY_VALUE_SECRET, '$1$2[REDACTED]')
    .replace(URL_SECRET, '$1[REDACTED]');
}

export function sanitizeSensitiveData<T>(value: T): T {
  if (typeof value === 'string') {
    const sanitized = sanitizeSensitiveString(value);
    if (sanitized.length > 100 && /^[a-zA-Z0-9+/=]+$/.test(sanitized.trim())) {
      return `${sanitized.slice(0, 30)}...[OMITTED]` as T;
    }
    return sanitized as T;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeSensitiveData(item)) as T;
  }

  if (value && typeof value === 'object') {
    const sanitized: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      sanitized[key] = SENSITIVE_KEY.test(key) ? '[REDACTED]' : sanitizeSensitiveData(item);
    }
    return sanitized as T;
  }

  return value;
}
