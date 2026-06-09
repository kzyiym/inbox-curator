import { App } from 'obsidian';

const API_KEY_SECRET_ID = 'inbox-curator-api-key';

export const SAVED_API_KEY_MASK = '•••••••• saved';
const MASKED_API_KEY_VALUES = [SAVED_API_KEY_MASK, '******** saved'] as const;

const sessionApiKeys = new Map<string, string>();

export function isSecretStorageAvailable(app: App): boolean {
  return Boolean(
    app.secretStorage &&
    typeof app.secretStorage.getSecret === 'function' &&
    typeof app.secretStorage.setSecret === 'function' &&
    typeof app.secretStorage.deleteSecret === 'function'
  );
}

export function clearSessionApiKeys(): void {
  sessionApiKeys.clear();
}

export function getApiKeySecretId(provider: string): string {
  if (provider === 'gemini-native') {
    return 'inbox-curator-api-key-gemini';
  }
  if (provider === 'anthropic-native') {
    return 'inbox-curator-api-key-anthropic';
  }
  return 'inbox-curator-api-key-openai';
}

export function buildApiKeyMask(key: string): string {
  const trimmed = key.trim();
  if (trimmed.length <= 8) {
    return '••••••••';
  }
  const prefix = trimmed.slice(0, 4);
  const suffix = trimmed.slice(-4);
  return `${prefix}••••••••${suffix}`;
}

export function isMaskedApiKeyValue(value: string): boolean {
  const trimmed = value.trim();
  if (MASKED_API_KEY_VALUES.includes(trimmed as (typeof MASKED_API_KEY_VALUES)[number])) {
    return true;
  }
  return /(?:•{4,}|\*{4,})/.test(trimmed);
}

export async function getApiKey(app: App, provider: string): Promise<string | null> {
  const secretId = getApiKeySecretId(provider);
  if (!isSecretStorageAvailable(app)) {
    return sessionApiKeys.get(secretId) ?? null;
  }

  const storage = app.secretStorage;
  let value = await storage.getSecret(secretId);

  // Fallback for OpenAI legacy key
  if (provider === 'openai-compatible') {
    const trimmed = value?.trim();
    if (!trimmed || isMaskedApiKeyValue(trimmed)) {
      const legacyValue = await storage.getSecret(API_KEY_SECRET_ID);
      const normalizedLegacy = legacyValue?.trim();
      if (normalizedLegacy && !isMaskedApiKeyValue(normalizedLegacy)) {
        return normalizedLegacy;
      }
    }
  }

  const normalized = value?.trim();
  if (!normalized || isMaskedApiKeyValue(normalized)) {
    return null;
  }
  return normalized;
}

export async function saveApiKey(app: App, provider: string, apiKey: string): Promise<void> {
  const normalized = apiKey.trim();
  if (!normalized || isMaskedApiKeyValue(normalized)) {
    throw new Error('Refusing to save an empty or masked API key value.');
  }

  const secretId = getApiKeySecretId(provider);
  if (!isSecretStorageAvailable(app)) {
    sessionApiKeys.set(secretId, normalized);
    return;
  }

  const storage = app.secretStorage;
  await storage.setSecret(secretId, normalized);
}

export async function deleteApiKey(app: App, provider: string): Promise<void> {
  const secretId = getApiKeySecretId(provider);
  if (!isSecretStorageAvailable(app)) {
    sessionApiKeys.delete(secretId);
    return;
  }

  const storage = app.secretStorage;
  await storage.deleteSecret(secretId);
}

export async function hasApiKey(app: App, provider: string): Promise<boolean> {
  const value = await getApiKey(app, provider);
  return Boolean(value);
}
