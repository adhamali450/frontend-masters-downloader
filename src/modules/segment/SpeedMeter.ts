export class SpeedMeter {
  private readonly startedAt = Date.now();
  private totalBytes = 0;
  private windowBytes = 0;
  private readonly windowMs: number;
  private windowStart = Date.now();

  constructor(windowMs = 1000) {
    this.windowMs = windowMs;
  }

  addBytes(n: number): void {
    this.totalBytes += n;
    this.windowBytes += n;
  }

  snapshot() {
    const now = Date.now();
    const elapsedMs = Math.max(1, now - this.startedAt);
    const windowElapsedMs = Math.max(1, now - this.windowStart);

    const avgBps = (this.totalBytes * 1000) / elapsedMs;
    const instBps = (this.windowBytes * 1000) / windowElapsedMs;

    if (windowElapsedMs >= this.windowMs) {
      this.windowBytes = 0;
      this.windowStart = now;
    }

    return {
      totalBytes: this.totalBytes,
      avgBps,
      instBps,
      elapsedMs,
    };
  }

  resetMeter(): void {
    this.totalBytes = 0;
    this.windowBytes = 0;
    this.windowStart = Date.now();
  }
}
