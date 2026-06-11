import { getLanguage } from 'obsidian';
import { en } from './locales/en';
import { ja } from './locales/ja';

export const SUPPORTED_LOCALES = ['en', 'ja'] as const;
export type SupportedLocale = typeof SUPPORTED_LOCALES[number];

export const DEFAULT_LOCALE: SupportedLocale = 'en';

const locales: Record<SupportedLocale, typeof en> = {
  en,
  ja: ja as typeof en, // Ensure types are aligned, fallback handles missing keys
};

export type TranslationKey = keyof typeof en;

export function getLocale(): SupportedLocale {
  // 1. Obsidian language setting via official API
  try {
    const lang = getLanguage();
    const normalized = normalizeLocale(lang);
    if (normalized) {
      return normalized;
    }
  } catch {
    // getLanguage() unavailable
  }

  // 2. Navigator language setting
  const navLang = typeof navigator !== 'undefined' ? navigator.language : null;
  if (navLang) {
    const normalized = normalizeLocale(navLang);
    if (normalized) {
      return normalized;
    }
  }

  // 3. Fallback to default
  return DEFAULT_LOCALE;
}

function normalizeLocale(rawLocale: string): SupportedLocale | null {
  const code = rawLocale.toLowerCase().split(/[-_]/)[0];
  if ((SUPPORTED_LOCALES as readonly string[]).includes(code)) {
    return code as SupportedLocale;
  }
  return null;
}

export function t(key: TranslationKey, params?: Record<string, string | number>): string {
  const locale = getLocale();
  let text: string | undefined = locales[locale]?.[key];

  // Fallback to default locale if key is missing in active locale
  if (text === undefined && locale !== DEFAULT_LOCALE) {
    text = locales[DEFAULT_LOCALE]?.[key];
  }

  // Fallback to the key name itself if still missing
  if (text === undefined) {
    return key;
  }

  // Replace placeholders in {{key}} format
  if (params) {
    let result = text;
    for (const [pKey, pVal] of Object.entries(params)) {
      result = result.replace(new RegExp(`\\{\\{\\s*${pKey}\\s*\\}\\}`, 'g'), String(pVal));
    }
    return result;
  }

  return text;
}
