const API_KEY_SECRET_ID = 'inbox-curator-api-key';

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

export async function saveApiKey(app: unknown, apiKey: string): Promise<void> {
  const storage = getSecretStorage(app);
  await storage.setSecret(API_KEY_SECRET_ID, apiKey);
}

export async function deleteApiKey(app: unknown): Promise<void> {
  const storage = getSecretStorage(app);
  await storage.deleteSecret(API_KEY_SECRET_ID);
}

export async function hasApiKey(app: unknown): Promise<boolean> {
  const storage = getSecretStorage(app);
  const value = await storage.getSecret(API_KEY_SECRET_ID);
  return Boolean(value && value.trim().length > 0);
}
