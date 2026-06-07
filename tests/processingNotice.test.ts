import { describe, expect, it, vi } from 'vitest';

const { MockNotice, noticeInstances } = vi.hoisted(() => {
  const created: MockNotice[] = [];

  class MockNotice {
    static reset() {
      created.length = 0;
    }

    message: string;
    duration: number | undefined;
    hidden = false;

    constructor(message: string, duration?: number) {
      this.message = message;
      this.duration = duration;
      created.push(this);
    }

    setMessage(message: string) {
      this.message = message;
      return this;
    }

    hide() {
      this.hidden = true;
    }
  }

  return { MockNotice, noticeInstances: created };
});

vi.mock('obsidian', async () => {
  const actual = await vi.importActual('../tests/support/obsidian-shim');
  return {
    ...actual,
    Notice: MockNotice,
  };
});

import { ProcessingNoticeManager } from '../src/processingNotice';

describe('ProcessingNoticeManager', () => {
  it('creates one persistent notice and updates it in place', () => {
    MockNotice.reset();
    const manager = new ProcessingNoticeManager();

    manager.show('Inbox Curator: Processing watched folder...');
    manager.update('Inbox Curator: Reviewing 2/5...');

    expect(noticeInstances).toHaveLength(1);
    expect(noticeInstances[0]?.duration).toBe(0);
    expect(noticeInstances[0]?.message).toBe('Inbox Curator: Reviewing 2/5...');
  });

  it('hides the active notice when cleared', () => {
    MockNotice.reset();
    const manager = new ProcessingNoticeManager();

    manager.show('Inbox Curator: Reviewing current note...');
    manager.clear();

    expect(noticeInstances).toHaveLength(1);
    expect(noticeInstances[0]?.hidden).toBe(true);
  });
});
