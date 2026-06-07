import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      obsidian: path.resolve(rootDir, 'tests/support/obsidian-shim.ts'),
    },
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.ts'],
    globals: true,
    clearMocks: true,
  },
});
