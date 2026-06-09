import 'obsidian';

declare module 'obsidian' {
  interface App {
    secretStorage: SecretStorage;
  }

  interface SecretStorage {
    getSecret(id: string): Promise<string | null | undefined>;
    setSecret(id: string, value: string): Promise<void>;
    deleteSecret(id: string): Promise<void>;
  }

  interface RequestUrlParam {
    timeout?: number;
  }
}
