import { parseArgs } from "./cli/args.js";
import { loadCourseInputs } from "./cli/loadInput.js";
import { CourseBrowser } from "./modules/browser/CourseBrowser.js";
import { CourseScraper } from "./modules/scraper/CourseScraper.js";
import { HlsSniffer } from "./modules/hls/HlsSniffer.js";
import { HlsResolver } from "./modules/hls/HlsResolver.js";
import { PlaylistParser } from "./domain/services/PlaylistParser.js";
import { SegmentPayloadNormalizer } from "./modules/segment/SegmentPayloadNormalizer.js";
import { SegmentDownloader } from "./modules/segment/SegmentDownloader.js";
import { SegmentStitcher } from "./modules/segment/SegmentStitcher.js";
import { DownloadCourses } from "./application/DownloadCourses.js";
import { logger } from "./utils/logger.js";
import { formatDuration } from "./utils/index.js";
import { runWithRateLimitSchedule } from "./utils/RunWindow.js";
import "dotenv/config";

const args = parseArgs(process.argv.slice(2));
const inputs = await loadCourseInputs(args.inputPath);

const browser = new CourseBrowser({
  headless: args.headless,
  executablePath: args.chromePath,
});

const downloader = new DownloadCourses({
  browser,
  scraper: new CourseScraper(),
  sniffer: new HlsSniffer(),
  resolver: new HlsResolver(new PlaylistParser(), args.resolution),
  segmentDownloader: new SegmentDownloader(new SegmentPayloadNormalizer()),
  segmentStitcher: new SegmentStitcher(),
  outputDir: args.outputDir,
  concurrency: args.concurrency,
  dryRun: args.dryRun,
  lessonTimeoutMs: args.lessonTimeoutMs,
  playlistTimeoutMs: args.playlistTimeoutMs,
});

const runDownloadCycle = async (shouldContinue: () => boolean) => {
  await browser.start();
  try {
    return await downloader.run(inputs, shouldContinue);
  } finally {
    await browser.close();
  }
};

try {
  if (args.continuous) {
    await runDownloadCycle(() => true);
  } else {
    logger.info(
      `Rate-limit schedule enabled: ${formatDuration(args.runDurationMs)} on, ${formatDuration(args.pauseDurationMs)} off (use --continuous to disable)`,
    );

    await runWithRateLimitSchedule(
      args.runDurationMs,
      args.pauseDurationMs,
      runDownloadCycle,
      (result) => !result.stoppedEarly,
    );
  }
} catch (error) {
  logger.error(
    `Run failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
}
