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

export function getApiKeySecretId(): string {
  return API_KEY_SECRET_ID;
}

export function isMaskedApiKeyValue(value: string): boolean {
  return MASKED_API_KEY_VALUES.includes(value.trim() as (typeof MASKED_API_KEY_VALUES)[number]);
}

export async function getApiKey(app: unknown): Promise<string | null> {
  const storage = getSecretStorage(app);
  const value = await storage.getSecret(API_KEY_SECRET_ID);
  const normalized = value?.trim();
  if (!normalized || isMaskedApiKeyValue(normalized)) {
    return null;
  }
  return normalized;
}

export async function saveApiKey(app: unknown, apiKey: string): Promise<void> {
  const normalized = apiKey.trim();
  if (!normalized || isMaskedApiKeyValue(normalized)) {
    throw new Error('Refusing to save an empty or masked API key value.');
  }

  const storage = getSecretStorage(app);
  await storage.setSecret(API_KEY_SECRET_ID, normalized);
}

export async function deleteApiKey(app: unknown): Promise<void> {
  const storage = getSecretStorage(app);
  await storage.deleteSecret(API_KEY_SECRET_ID);
}

export async function hasApiKey(app: unknown): Promise<boolean> {
  const value = await getApiKey(app);
  return Boolean(value);
}
