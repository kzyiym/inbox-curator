import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setLogLevelGetter, LOG_FOLDER } from '../src/utils/logFiles';
import { TFile } from 'obsidian';

// Build a minimal App mock with vault adapter
class MockTFile extends TFile {
  path: string;
  constructor(path: string) {
    super();
    this.path = path;
  }
}

function createMockApp() {
  const files = new Map<string, string>();

  const adapter = {
    exists: vi.fn(async (path: string) => files.has(path)),
    read: vi.fn(async (path: string) => files.get(path) ?? ''),
    write: vi.fn(async (path: string, data: string) => { files.set(path, data); }),
    remove: vi.fn(async (path: string) => { files.delete(path); }),
    list: vi.fn(async (path: string) => {
      const logFiles: string[] = [];
      for (const key of files.keys()) {
        if (key.startsWith(path + '/') || key === path) {
          logFiles.push(key);
        }
      }
      return { files: logFiles, folders: [] };
    }),
    getFullPath: vi.fn((path: string) => path),
  };

  function resolvePath(p: string | { path: string }): string {
    return typeof p === 'string' ? p : p.path;
  }

  const vault = {
    adapter,
    getAbstractFileByPath: vi.fn((path: string) => {
      if (files.has(path)) {
        return new MockTFile(path);
      }
      for (const key of files.keys()) {
        if (key.startsWith(path + '/') || key === path) {
          return new MockTFile(path);
        }
      }
      return null;
    }),
    read: vi.fn(async (file: string | { path: string }) => files.get(resolvePath(file)) ?? ''),
    modify: vi.fn(async (file: string | { path: string }, data: string) => { files.set(resolvePath(file), data); }),
    create: vi.fn(async (path: string, data: string) => { files.set(path, data); }),
    createFolder: vi.fn(async (path: string) => { files.set(path, ''); }),
    process: vi.fn(async (file: string | { path: string }, fn: (data: string) => string) => {
      const p = typeof file === 'string' ? file : file.path;
      const data = files.get(p) ?? '';
      files.set(p, fn(data));
    }),
  };

  return { vault } as any;
}

describe('operationLog', () => {
  const logPrefix = 'operations';

  beforeEach(() => {
    setLogLevelGetter(() => 'operations');
  });

  afterEach(() => {
    setLogLevelGetter(() => 'errors');
  });

  describe('logLevel control', () => {
    it('should not write operation logs when logLevel is off', async () => {
      setLogLevelGetter(() => 'off');
      const app = createMockApp();

      const { logOperation } = await import('../src/utils/operationLog');
      await logOperation(app, {
        timestamp: new Date().toISOString(),
        level: 'INFO',
        event: 'queue_enqueued',
      });

      const { getOperationLogEntryCount } = await import('../src/utils/operationLog');
      const count = await getOperationLogEntryCount(app);
      expect(count).toBe(0);
    });

    it('should not write operation logs when logLevel is errors', async () => {
      setLogLevelGetter(() => 'errors');
      const app = createMockApp();

      const { logOperation } = await import('../src/utils/operationLog');
      await logOperation(app, {
        timestamp: new Date().toISOString(),
        level: 'INFO',
        event: 'queue_enqueued',
      });

      const { getOperationLogEntryCount } = await import('../src/utils/operationLog');
      const count = await getOperationLogEntryCount(app);
      expect(count).toBe(0);
    });

    it('should write operation logs when logLevel is operations', async () => {
      setLogLevelGetter(() => 'operations');
      const app = createMockApp();

      const { logOperation } = await import('../src/utils/operationLog');
      await logOperation(app, {
        timestamp: new Date().toISOString(),
        level: 'INFO',
        event: 'queue_enqueued',
      });

      const { getOperationLogEntryCount } = await import('../src/utils/operationLog');
      const count = await getOperationLogEntryCount(app);
      expect(count).toBe(1);
    });

    it('should suppress errorLog when logLevel is off', async () => {
      setLogLevelGetter(() => 'off');
      const app = createMockApp();

      const { logError } = await import('../src/utils/errorLog');
      await logError(app, 'ERROR', 'test error');

      const { getErrorLogStats } = await import('../src/utils/errorLog');
      const stats = await getErrorLogStats(app);
      expect(stats.totalEntries).toBe(0);
    });

    it('should allow errorLog when logLevel is errors', async () => {
      setLogLevelGetter(() => 'errors');
      const app = createMockApp();

      const { logError } = await import('../src/utils/errorLog');
      await logError(app, 'ERROR', 'test error');

      const { getErrorLogStats } = await import('../src/utils/errorLog');
      const stats = await getErrorLogStats(app);
      expect(stats.totalEntries).toBe(1);
    });

    it('should allow errorLog when logLevel is operations', async () => {
      setLogLevelGetter(() => 'operations');
      const app = createMockApp();

      const { logError } = await import('../src/utils/errorLog');
      await logError(app, 'ERROR', 'test error');

      const { getErrorLogStats } = await import('../src/utils/errorLog');
      const stats = await getErrorLogStats(app);
      expect(stats.totalEntries).toBe(1);
    });
  });

  describe('appendToFile with vault.process', () => {
    it('should create file via vault.create when file does not exist', async () => {
      const app = createMockApp();
      const { appendToFile } = await import('../src/utils/logFiles');
      const path = '.inbox-curator/logs/operations-2026-06-09.log';

      await appendToFile(app, path, '{"event":"first"}\n');
      const content = await app.vault.adapter.read(path);
      expect(content).toBe('{"event":"first"}\n');
    });

    it('should append via vault.process when file already exists', async () => {
      const app = createMockApp();
      const { appendToFile } = await import('../src/utils/logFiles');
      const path = '.inbox-curator/logs/operations-2026-06-09.log';

      const { ensureLogFolder } = await import('../src/utils/logFiles');
      await ensureLogFolder(app);
      await app.vault.adapter.write(path, '{"event":"first"}\n');
      await appendToFile(app, path, '{"event":"second"}\n');

      const content = await app.vault.adapter.read(path);
      const lines = content.trim().split('\n');
      expect(lines.length).toBe(2);
      expect(JSON.parse(lines[0]).event).toBe('first');
      expect(JSON.parse(lines[1]).event).toBe('second');
    });

    it('should handle vault.create race condition via vault.process fallback', async () => {
      const app = createMockApp();
      const { appendToFile } = await import('../src/utils/logFiles');
      const path = '.inbox-curator/logs/operations-2026-06-09.log';
      const { ensureLogFolder } = await import('../src/utils/logFiles');
      await ensureLogFolder(app);

      let createCallCount = 0;
      app.vault.create = vi.fn(async (p: string, data: string) => {
        createCallCount++;
        if (createCallCount > 1) {
          throw new Error('EEXIST: file already exists');
        }
        // Write through adapter so vault methods see the file
        await app.vault.adapter.write(p, data);
      });

      await Promise.all([
        appendToFile(app, path, '{"event":"alpha"}\n'),
        appendToFile(app, path, '{"event":"beta"}\n'),
      ]);

      const content = await app.vault.adapter.read(path);
      const lines = content.trim().split('\n').filter((l: string) => l.length > 0);
      expect(lines.length).toBe(2);
      const events = lines.map((l: string) => JSON.parse(l).event);
      expect(events).toContain('alpha');
      expect(events).toContain('beta');
    });

    it('should throw on vault.create failure when retry also fails', async () => {
      const app = createMockApp();
      const { appendToFile } = await import('../src/utils/logFiles');
      const path = '.inbox-curator/logs/operations-2026-06-09.log';

      app.vault.create = vi.fn(async () => { throw new Error('permission denied'); });

      await expect(appendToFile(app, path, '{"event":"fail"}\n')).rejects.toThrow();
    });

    it('should not leak exception out of logOperation (console.error instead)', async () => {
      const app = createMockApp();
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { logOperation } = await import('../src/utils/operationLog');

      app.vault.create = vi.fn(async () => { throw new Error('disk full'); });

      await expect(logOperation(app, {
        timestamp: new Date().toISOString(),
        level: 'INFO',
        event: 'test_fail',
      })).resolves.toBeUndefined();

      expect(consoleSpy).toHaveBeenCalledWith(
        'Inbox Curator: Failed to write operation log',
        expect.any(Error),
      );
      consoleSpy.mockRestore();
    });
  });

  describe('JSON Lines format', () => {
    it('should write valid JSON Lines for operation logs', async () => {
      const app = createMockApp();
      const { logOperation, buildOperationLogFileName } = await import('../src/utils/operationLog');

      await logOperation(app, {
        timestamp: '2026-06-09T03:00:00.000Z',
        level: 'INFO',
        event: 'queue_enqueued',
        operationId: 'op-test-1',
        notePath: 'Inbox/foo.md',
      });

      const path = buildOperationLogFileName();
      const content = await app.vault.adapter.read(path);
      const lines = content.trim().split('\n');
      expect(lines.length).toBe(1);

      const parsed = JSON.parse(lines[0]);
      expect(parsed.event).toBe('queue_enqueued');
      expect(parsed.operationId).toBe('op-test-1');
      expect(parsed.notePath).toBe('Inbox/foo.md');
      expect(parsed.level).toBe('INFO');
      expect(parsed.timestamp).toBe('2026-06-09T03:00:00.000Z');
    });

    it('should append multiple JSON lines via appendToFile', async () => {
      const app = createMockApp();
      const { ensureLogFolder, appendToFile } = await import('../src/utils/logFiles');
      const { buildOperationLogFileName } = await import('../src/utils/operationLog');
      await ensureLogFolder(app);

      const path = buildOperationLogFileName();
      await appendToFile(app, path, JSON.stringify({ event: 'queue_enqueued', operationId: 'op-1' }) + '\n');
      await appendToFile(app, path, JSON.stringify({ event: 'queue_started', operationId: 'op-1' }) + '\n');
      await appendToFile(app, path, JSON.stringify({ event: 'queue_completed', operationId: 'op-1' }) + '\n');

      const content = await app.vault.adapter.read(path);
      const lines = content.trim().split('\n');
      expect(lines.length).toBe(3);

      const first = JSON.parse(lines[0]);
      expect(first.event).toBe('queue_enqueued');
      const last = JSON.parse(lines[2]);
      expect(last.event).toBe('queue_completed');
    });
  });

  describe('operationId correlation via appendToFile', () => {
    it('should track a sequence of events by operationId', async () => {
      const app = createMockApp();
      const { ensureLogFolder, appendToFile } = await import('../src/utils/logFiles');
      const { buildOperationLogFileName } = await import('../src/utils/operationLog');
      await ensureLogFolder(app);

      const opId = 'op-correlate-123';
      const path = buildOperationLogFileName();
      const events = [
        { timestamp: '2026-06-09T01:00:00.000Z', level: 'INFO', event: 'queue_enqueued', operationId: opId, notePath: 'Inbox/test.md' },
        { timestamp: '2026-06-09T01:01:00.000Z', level: 'INFO', event: 'queue_started', operationId: opId, notePath: 'Inbox/test.md' },
        { timestamp: '2026-06-09T01:02:00.000Z', level: 'INFO', event: 'pipeline_started', operationId: opId, notePath: 'Inbox/test.md', provider: 'openai-compatible' },
        { timestamp: '2026-06-09T01:02:01.000Z', level: 'INFO', event: 'provider_request_succeeded', operationId: opId, provider: 'openai-compatible', model: 'gpt-4', durationMs: 500 },
        { timestamp: '2026-06-09T01:02:02.000Z', level: 'INFO', event: 'pipeline_completed', operationId: opId, notePath: 'Inbox/test.md' },
        { timestamp: '2026-06-09T01:03:00.000Z', level: 'INFO', event: 'queue_completed', operationId: opId, notePath: 'Inbox/test.md' },
      ];

      for (const evt of events) {
        await appendToFile(app, path, JSON.stringify(evt) + '\n');
      }

      const content = await app.vault.adapter.read(path);
      const lines = content.trim().split('\n');
      expect(lines.length).toBe(6);

      for (const line of lines) {
        const parsed = JSON.parse(line);
        expect(parsed.operationId).toBe(opId);
      }

      expect(JSON.parse(lines[0]).event).toBe('queue_enqueued');
      expect(JSON.parse(lines[5]).event).toBe('queue_completed');
    });
  });

  describe('sensitive data protection', () => {
    it('should not contain note body, prompt, response, base64, or API key patterns', async () => {
      const app = createMockApp();
      const { logOperation, buildOperationLogFileName } = await import('../src/utils/operationLog');

      // Simulate a provider request with safe metadata only
      await logOperation(app, {
        timestamp: new Date().toISOString(),
        level: 'INFO',
        event: 'provider_request_succeeded',
        operationId: 'op-test-safe',
        provider: 'openai-compatible',
        model: 'gpt-4o-mini',
        durationMs: 1234,
        statusCode: 200,
      });

      const path = buildOperationLogFileName();
      const content = await app.vault.adapter.read(path);
      const line = content.trim();

      // Should contain allowed metadata
      expect(line).toContain('provider_request_succeeded');
      expect(line).toContain('gpt-4o-mini');
      expect(line).toContain('1234');

      // Should NOT contain sensitive data patterns
      const dangerousPatterns = [
        /"noteContent":/i,
        /"prompt":/i,
        /"response":/i,
        /"responseBody":/i,
        /"requestBody":/i,
        /"messages":/i,
        /base64,/i,
        /data:image/i,
        /apiKey/i,
        /"content":\s*"[^"]{100,}/,
        /secret/i,
      ];

      for (const pattern of dangerousPatterns) {
        expect(line).not.toMatch(pattern);
      }
    });

    it('should not include API key patterns in details', async () => {
      const app = createMockApp();
      const { logOperation, buildOperationLogFileName } = await import('../src/utils/operationLog');

      await logOperation(app, {
        timestamp: new Date().toISOString(),
        level: 'INFO',
        event: 'connection_test_succeeded',
        provider: 'openai-compatible',
        model: 'gpt-4',
        details: { detectedTokenParam: 'max_tokens' },
      });

      const path = buildOperationLogFileName();
      const content = await app.vault.adapter.read(path);
      expect(content).not.toMatch(/sk-/i);
      expect(content).not.toMatch(/api[_-]?key/i);
    });
  });

  describe('operationId correlation', () => {
    it('should track a sequence of events by operationId', async () => {
      const app = createMockApp();
      const { logOperation, buildOperationLogFileName } = await import('../src/utils/operationLog');
      const opId = 'op-correlate-123';

      await logOperation(app, { timestamp: '2026-06-09T01:00:00.000Z', level: 'INFO', event: 'queue_enqueued', operationId: opId, notePath: 'Inbox/test.md' });
      await logOperation(app, { timestamp: '2026-06-09T01:01:00.000Z', level: 'INFO', event: 'queue_started', operationId: opId, notePath: 'Inbox/test.md' });
      await logOperation(app, { timestamp: '2026-06-09T01:02:00.000Z', level: 'INFO', event: 'pipeline_started', operationId: opId, notePath: 'Inbox/test.md', provider: 'openai-compatible' });
      await logOperation(app, { timestamp: '2026-06-09T01:02:01.000Z', level: 'INFO', event: 'provider_request_succeeded', operationId: opId, provider: 'openai-compatible', model: 'gpt-4', durationMs: 500 });
      await logOperation(app, { timestamp: '2026-06-09T01:02:02.000Z', level: 'INFO', event: 'pipeline_completed', operationId: opId, notePath: 'Inbox/test.md' });
      await logOperation(app, { timestamp: '2026-06-09T01:03:00.000Z', level: 'INFO', event: 'queue_completed', operationId: opId, notePath: 'Inbox/test.md' });

      const path = buildOperationLogFileName();
      const content = await app.vault.adapter.read(path);
      const lines = content.trim().split('\n');

      expect(lines.length).toBe(6);
      for (const line of lines) {
        const parsed = JSON.parse(line);
        expect(parsed.operationId).toBe(opId);
      }

      expect(JSON.parse(lines[0]).event).toBe('queue_enqueued');
      expect(JSON.parse(lines[5]).event).toBe('queue_completed');
    });
  });

  describe('retention', () => {
    it('should clean up old operation log files by prefix', async () => {
      const app = createMockApp();
      const adapter = app.vault.adapter;
      const { ensureLogFolder } = await import('../src/utils/logFiles');
      await ensureLogFolder(app);

      const oldDate = new Date('2026-06-01T00:00:00.000Z');
      const recentDate = new Date('2026-06-08T00:00:00.000Z');
      const { buildOperationLogFileName } = await import('../src/utils/operationLog');
      const { removeLogFilesOlderThan, LOG_FOLDER } = await import('../src/utils/logFiles');

      const oldPath = buildOperationLogFileName(oldDate);
      const recentPath = buildOperationLogFileName(recentDate);
      const todayPath = buildOperationLogFileName();

      await adapter.write(oldPath, '{"event":"old"}\n');
      await adapter.write(recentPath, '{"event":"recent"}\n');
      await adapter.write(todayPath, '{"event":"today"}\n');

      expect(await adapter.exists(oldPath)).toBe(true);
      expect(await adapter.exists(recentPath)).toBe(true);
      expect(await adapter.exists(todayPath)).toBe(true);

      const referenceDate = new Date('2026-06-09T12:00:00.000Z');
      await removeLogFilesOlderThan(app, 'operations', 7, referenceDate);

      expect(await adapter.exists(oldPath)).toBe(false);
      expect(await adapter.exists(recentPath)).toBe(true);
      expect(await adapter.exists(todayPath)).toBe(true);
    });
  });

  describe('generateOperationId', () => {
    it('should generate unique operation IDs', async () => {
      const { generateOperationId } = await import('../src/utils/operationLog');
      // Import from job.ts
      const { generateOperationId: jobGenerateOperationId } = await import('../src/queue/job');

      const id1 = jobGenerateOperationId();
      const id2 = jobGenerateOperationId();
      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^op-/);
      expect(id2).toMatch(/^op-/);
    });
  });

  describe('providerClient no notePath dependency', () => {
    it('providerClient events should not contain notePath', async () => {
      const app = createMockApp();
      const { logOperation, buildOperationLogFileName } = await import('../src/utils/operationLog');

      // provider_request events from providerClient should NOT have notePath
      await logOperation(app, {
        timestamp: new Date().toISOString(),
        level: 'INFO',
        event: 'provider_request_succeeded',
        operationId: 'op-no-note-path',
        provider: 'openai-compatible',
        model: 'gpt-4',
        durationMs: 500,
        statusCode: 200,
      });

      const path = buildOperationLogFileName();
      const content = await app.vault.adapter.read(path);
      const parsed = JSON.parse(content.trim());

      expect(parsed.event).toBe('provider_request_succeeded');
      expect(parsed.provider).toBe('openai-compatible');
      expect(parsed).not.toHaveProperty('notePath');
      expect(parsed).toHaveProperty('operationId');
    });
  });
});
