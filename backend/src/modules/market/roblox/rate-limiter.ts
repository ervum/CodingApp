export class TokenBucketRateLimiter {
  private tokens: number;
  private lastRefillMs: number;
  private queue: Array<() => void> = [];
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly ratePerSec: number,
    private readonly burst = 2,
  ) {
    this.tokens = burst;
    this.lastRefillMs = Date.now();
  }

  async acquire(): Promise<void> {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }

    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
      this.scheduleDrain();
    });
  }

  private refill(): void {
    const now = Date.now();
    const elapsedSec = (now - this.lastRefillMs) / 1000;
    if (elapsedSec > 0) {
      this.tokens = Math.min(this.burst, this.tokens + elapsedSec * this.ratePerSec);
      this.lastRefillMs = now;
    }
  }

  private scheduleDrain(): void {
    if (this.timer) return;
    const waitMs = Math.max(20, Math.ceil(((1 - this.tokens) / this.ratePerSec) * 1000));
    this.timer = setTimeout(() => {
      this.timer = null;
      this.refill();
      while (this.tokens >= 1 && this.queue.length > 0) {
        this.tokens -= 1;
        const next = this.queue.shift()!;
        next();
      }
      if (this.queue.length > 0) {
        this.scheduleDrain();
      }
    }, waitMs);
  }
}
