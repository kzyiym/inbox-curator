const API_KEY_SECRET_ID = 'inbox-curator-api-key';

export const SAVED_API_KEY_MASK = '•••••••• saved';
const MASKED_API_KEY_VALUES = [SAVED_API_KEY_MASK, '******** saved'] as const;

type SecretStorageLike = {
  getSecret(id: string): Promise<string | null | undefined>;
  setSecret(id: string, value: string): Promise<void>;
  deleteSecret(id: string): Promise<void>;
};

function getSecretStorage(app: unknown): SecretStorageLike {
  const storage = (app as { secretStorage?: SecretStorageLike }).secretStorage;
  if (!storage) {
    throw new Error('SecretStorage is not available in this Obsidian runtime.');
  }
  return storage;
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

export function isMaskedApiKeyValue(value: string): boolean {
  return MASKED_API_KEY_VALUES.includes(value.trim() as (typeof MASKED_API_KEY_VALUES)[number]);
}

export async function getApiKey(app: unknown, provider: string): Promise<string | null> {
  const storage = getSecretStorage(app);
  const secretId = getApiKeySecretId(provider);
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

export async function saveApiKey(app: unknown, provider: string, apiKey: string): Promise<void> {
  const normalized = apiKey.trim();
  if (!normalized || isMaskedApiKeyValue(normalized)) {
    throw new Error('Refusing to save an empty or masked API key value.');
  }

  const storage = getSecretStorage(app);
  const secretId = getApiKeySecretId(provider);
  await storage.setSecret(secretId, normalized);
}

export async function deleteApiKey(app: unknown, provider: string): Promise<void> {
  const storage = getSecretStorage(app);
  const secretId = getApiKeySecretId(provider);
  await storage.deleteSecret(secretId);
}

export async function hasApiKey(app: unknown, provider: string): Promise<boolean> {
  const value = await getApiKey(app, provider);
  return Boolean(value);
}
