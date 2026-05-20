import {
  isVideoResolution,
  VIDEO_RESOLUTIONS,
  type VideoResolution,
} from "../domain/entities/VideoResolution.js";
import {
  DEFAULT_PAUSE_DURATION_MS,
  DEFAULT_RUN_DURATION_MS,
} from "../utils/index.js";

export interface CliArgs {
  inputPath: string;
  outputDir: string;
  concurrency: number;
  headless: boolean;
  playlistTimeoutMs: number;
  lessonTimeoutMs: number;
  resolution?: VideoResolution;
  continuous: boolean;
  runDurationMs: number;
  pauseDurationMs: number;
}

const parseResolution = (value: unknown): VideoResolution | undefined => {
  if (value === undefined || value === true) return undefined;

  const height = Number(value);
  if (!Number.isInteger(height) || !isVideoResolution(height)) {
    throw new Error(
      `Invalid --resolution "${String(value)}". Allowed values: ${VIDEO_RESOLUTIONS.join(", ")}`,
    );
  }

  return height;
};

export function parseArgs(argv: string[]): CliArgs {
  const args: Record<string, string | boolean> = {};

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token?.startsWith("--")) continue;

    const key = token.slice(2);
    const next = argv[i + 1];
    const isFlag = !next || next.startsWith("--");

    args[key] = isFlag ? true : next;
    if (!isFlag) i += 1;
  }

  const inputPath = String(args.input || "./courses.json");
  const outputDir = String(args.output || "./downloads");

  const runDurationMs = Number(
    args["run-duration-ms"] || DEFAULT_RUN_DURATION_MS,
  );
  const pauseDurationMs = Number(
    args["pause-duration-ms"] || DEFAULT_PAUSE_DURATION_MS,
  );

  if (!Number.isFinite(runDurationMs) || runDurationMs <= 0) {
    throw new Error("--run-duration-ms must be a positive number");
  }
  if (!Number.isFinite(pauseDurationMs) || pauseDurationMs <= 0) {
    throw new Error("--pause-duration-ms must be a positive number");
  }

  return {
    inputPath,
    outputDir,
    concurrency: Number(args.concurrency || 2),
    headless: args.headless === true,
    playlistTimeoutMs: Number(args["playlist-timeout-ms"] || 15000),
    lessonTimeoutMs: Number(args["lesson-timeout-ms"] || 30000),
    resolution: parseResolution(args.resolution),
    continuous: args.continuous === true,
    runDurationMs,
    pauseDurationMs,
  };
}
