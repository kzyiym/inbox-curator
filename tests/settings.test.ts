import { describe, expect, it } from 'vitest';
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
