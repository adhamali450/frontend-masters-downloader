import { delay, formatDuration } from "./index.js";
import { logger } from "./logger.js";

export class RunWindow {
  private endsAt: number;

  constructor(private readonly durationMs: number) {
    this.endsAt = Date.now() + durationMs;
  }

  isActive(): boolean {
    return Date.now() < this.endsAt;
  }

  remainingMs(): number {
    return Math.max(0, this.endsAt - Date.now());
  }
}

export async function pauseForRateLimit(pauseDurationMs: number): Promise<void> {
  const resumeAt = new Date(Date.now() + pauseDurationMs);
  logger.info(
    `Rate-limit pause: sleeping for ${formatDuration(pauseDurationMs)} (resumes ~${resumeAt.toLocaleString()})`
  );
  await delay(pauseDurationMs);
  logger.info("Rate-limit pause complete — resuming downloads");
}

export async function runWithRateLimitSchedule<T>(
  runDurationMs: number,
  pauseDurationMs: number,
  runCycle: (shouldContinue: () => boolean) => Promise<T>,
  isDone: (result: T) => boolean
): Promise<void> {
  let cycle = 0;

  while (true) {
    cycle += 1;
    const window = new RunWindow(runDurationMs);
    logger.info(
      `Rate-limit run window ${cycle} started (${formatDuration(runDurationMs)} active window)`
    );

    const result = await runCycle(() => window.isActive());

    if (isDone(result)) {
      return;
    }

    const remaining = window.remainingMs();
    if (remaining > 0) {
      logger.info(
        `Run window ended early with ${formatDuration(remaining)} remaining in the window`
      );
    } else {
      logger.info("Run window ended — starting rate-limit pause");
    }

    await pauseForRateLimit(pauseDurationMs);
  }
}
