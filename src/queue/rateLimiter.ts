function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export class ReviewRateLimiter {
  private nextAllowedAt = 0;

  async wait(requiredGapMs: number): Promise<number> {
    const normalizedGapMs = Math.max(0, Math.round(requiredGapMs));
    const now = Date.now();
    const waitMs = Math.max(0, this.nextAllowedAt - now, normalizedGapMs);

    if (waitMs > 0) {
      await sleep(waitMs);
    }

    this.nextAllowedAt = Date.now() + normalizedGapMs;
    return waitMs;
  }

  reset(): void {
    this.nextAllowedAt = 0;
  }
}
