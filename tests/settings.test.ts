import { describe, expect, it, vi } from 'vitest';
import InboxCuratorPlugin from '../main.ts';
import { DEFAULT_SETTINGS, getSettingsUiVisibility } from '../src/settings';


describe('getSettingsUiVisibility', () => {
  it('keeps bounded review concurrency conservative by default', () => {
    expect(DEFAULT_SETTINGS.maxConcurrentReviews).toBe(1);
  });

  it('hides automatic watching child settings when automatic watching is off', () => {
    const visibility = getSettingsUiVisibility({
      ...DEFAULT_SETTINGS,
      enableAutomaticWatching: false,
      enablePolling: false,
      extractUrlArticleText: false,
    });

    expect(visibility.showAutomaticWatchingDetails).toBe(false);
    expect(visibility.showPollingDetails).toBe(false);
    expect(visibility.showArticleExtractionDetails).toBe(false);
  });

  it('shows dependent sections when their parent toggles are enabled', () => {
    const visibility = getSettingsUiVisibility({
      ...DEFAULT_SETTINGS,
      enableAutomaticWatching: true,
      enablePolling: true,
      extractUrlArticleText: true,
    });

    expect(visibility.showAutomaticWatchingDetails).toBe(true);
    expect(visibility.showPollingDetails).toBe(true);
    expect(visibility.showArticleExtractionDetails).toBe(true);
  });
});

describe('customReviewPrompt settings defaults', () => {
  it('defaults to an empty string', () => {
    expect(DEFAULT_SETTINGS.customReviewPrompt).toBe('');
  });
});

describe('settings migration behavior', () => {
  it('migrates legacy autoExecuteProposedActions=true correctly', async () => {
    const mockApp: any = {};
    const plugin = new InboxCuratorPlugin(mockApp, {});

    // Mock loadData to return a legacy config where autoExecuteProposedActions is true
    plugin.loadData = vi.fn().mockResolvedValue({
      autoExecuteProposedActions: true,
    });

    await plugin.loadSettings();

    expect(plugin.settings.autoExecuteArchive).toBe(true);
    expect(plugin.settings.autoExecuteReadLater).toBe(false);
    expect(plugin.settings.autoExecuteTask).toBe(false);
    expect(plugin.settings.autoExecuteDeleteCandidate).toBe(false);
  });

  it('keeps all auto-execute settings false if legacy setting is false', async () => {
    const mockApp: any = {};
    const plugin = new InboxCuratorPlugin(mockApp, {});

    plugin.loadData = vi.fn().mockResolvedValue({
      autoExecuteProposedActions: false,
    });

    await plugin.loadSettings();

    expect(plugin.settings.autoExecuteArchive).toBe(false);
    expect(plugin.settings.autoExecuteReadLater).toBe(false);
    expect(plugin.settings.autoExecuteTask).toBe(false);
    expect(plugin.settings.autoExecuteDeleteCandidate).toBe(false);
  });
});
