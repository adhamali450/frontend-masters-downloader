import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { CourseBrowser } from "../modules/browser/CourseBrowser.js";
import { CourseScraper } from "../modules/scraper/CourseScraper.js";
import { HlsSniffer } from "../modules/hls/HlsSniffer.js";
import { HlsResolver } from "../modules/hls/HlsResolver.js";
import {
  RunWindowExpiredError,
  SegmentDownloader,
} from "../modules/segment/SegmentDownloader.js";
import {
  SegmentStitcher,
  StitchMetadata,
} from "../modules/segment/SegmentStitcher.js";
import { TempMediaPaths } from "../modules/media/TempMediaPaths.js";
import { CourseInput, Lesson } from "../domain/entities/Course.js";
import {
  isCompleteLessonFile,
  lessonOutputPath,
  removeIncompleteLessonFile,
  toFileSlug,
} from "../utils/index.js";
import { createSegmentDownloadProgressHandler } from "../cli/SegmentDownloadProgressBar.js";
import { logger } from "../utils/logger.js";

export type ShouldContinue = () => boolean;

export interface DownloadRunResult {
  stoppedEarly: boolean;
}

interface DownloadCoursesConfig {
  browser: CourseBrowser;
  scraper: CourseScraper;
  sniffer: HlsSniffer;
  resolver: HlsResolver;
  segmentDownloader: SegmentDownloader;
  segmentStitcher: SegmentStitcher;
  outputDir: string;
  concurrency: number;
  playlistTimeoutMs: number;
  lessonTimeoutMs: number;
}

export class DownloadCourses {
  constructor(private readonly config: DownloadCoursesConfig) {}

  async run(
    inputs: CourseInput[],
    shouldContinue: ShouldContinue = () => true,
  ): Promise<DownloadRunResult> {
    await mkdir(this.config.outputDir, { recursive: true });

    for (const input of inputs) {
      if (!shouldContinue()) {
        logger.info("Run window ended — pausing before next course");
        return { stoppedEarly: true };
      }

      try {
        const stoppedEarly = await this.processCourse(input, shouldContinue);
        if (stoppedEarly) return { stoppedEarly: true };
      } catch (err) {
        if (err instanceof RunWindowExpiredError) {
          return { stoppedEarly: true };
        }

        logger.error(
          `Error processing course "${input.title}": ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return { stoppedEarly: false };
  }

  private async processCourse(
    courseInput: CourseInput,
    shouldContinue: ShouldContinue,
  ): Promise<boolean> {
    logger.info(`Course start: ${courseInput.title}`);

    const page = await this.config.browser.newPage();
    const course = await this.config.scraper.scrapeCourse(
      page,
      courseInput.url,
    );
    await page.close();

    const courseSlug = toFileSlug(course.title || courseInput.title);
    const courseDir = path.join(this.config.outputDir, courseSlug);
    await mkdir(courseDir, { recursive: true });

    await writeFile(
      path.join(courseDir, "course.json"),
      JSON.stringify(course, null, 2),
      "utf-8",
    );

    const lessons = course.chapters.flatMap((chapter) => chapter.lessons);
    if (lessons.length === 0) {
      logger.warn(`No lessons found for ${course.title}`);
      return false;
    }

    const completedLessons = await Promise.all(
      lessons.map((lesson) =>
        isCompleteLessonFile(
          lessonOutputPath(courseDir, lesson.index, lesson.title),
        ),
      ),
    );
    const downloadedCount = completedLessons.filter(Boolean).length;
    if (downloadedCount > 0) {
      logger.info(
        `Resuming course: ${downloadedCount}/${lessons.length} lessons already downloaded`,
      );
    }

    for (const lesson of lessons) {
      if (!shouldContinue()) {
        logger.info("Run window ended — pausing before next lesson");
        return true;
      }

      await this.processLesson(
        courseSlug,
        course.title,
        lesson,
        courseDir,
        shouldContinue,
      );
    }

    return false;
  }

  private async processLesson(
    courseSlug: string,
    courseTitle: string,
    lesson: Lesson,
    courseDir: string,
    shouldContinue: ShouldContinue,
  ): Promise<void> {
    const lessonSlug = toFileSlug(`${lesson.index + 1}-${lesson.title}`);
    const outputPath = lessonOutputPath(courseDir, lesson.index, lesson.title);

    if (await isCompleteLessonFile(outputPath)) {
      logger.info(`Lesson skipped (already downloaded): ${lesson.title}`);
      return;
    }

    await removeIncompleteLessonFile(outputPath);

    logger.info(`Lesson start: ${lesson.title}`);

    const tempPaths = TempMediaPaths.forLesson(`${courseSlug}-${lessonSlug}`);
    await tempPaths.init();

    const page = await this.config.browser.newPage();

    try {
      const master = await this.config.sniffer.captureMasterPlaylist(
        page,
        lesson.url,
        {
          navigationTimeoutMs: this.config.lessonTimeoutMs,
          playlistTimeoutMs: this.config.playlistTimeoutMs,
          cookiesPath: tempPaths.cookiesPath(),
        },
      );

      const playlist = await this.config.resolver.resolve(
        master.body,
        master.url,
        master.cookiesPath,
      );

      const mediaSlug = `${courseSlug}/${lessonSlug}`;

      await this.config.segmentDownloader.downloadSegments(
        playlist,
        mediaSlug,
        tempPaths.segmentsDir(),
        master.cookiesPath,
        createSegmentDownloadProgressHandler(lesson.title),
        shouldContinue,
      );

      const orderedSegmentPaths = await tempPaths.listOrderedSegments();
      const metadata: StitchMetadata = {
        title: lesson.title,
        description: lesson.description,
        courseTitle,
      };

      await this.config.segmentStitcher.stitch(
        orderedSegmentPaths,
        outputPath,
        true,
        metadata,
      );

      logger.info(`Lesson complete: ${lesson.title}`);
    } catch (err) {
      if (err instanceof RunWindowExpiredError) {
        logger.info(`Run window ended during lesson: ${lesson.title}`);
        throw err;
      }

      logger.error(
        `Error processing lesson "${lesson.title}": ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      await page.close().catch(() => undefined);
      await tempPaths.cleanup();
    }
  }
}
