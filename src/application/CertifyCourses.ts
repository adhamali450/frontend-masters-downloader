import { CourseBrowser } from "../modules/browser/CourseBrowser.js";
import { CourseScraper } from "../modules/scraper/CourseScraper.js";
import { CourseInput, Lesson } from "../domain/entities/Course.js";
import { delay } from "../utils/index.js";
import { logger } from "../utils/logger.js";
import { Page } from "playwright";

interface CertifyCoursesConfig {
  browser: CourseBrowser;
  scraper: CourseScraper;
  lessonTimeoutMs: number;
}

export class CertifyCourses {
  constructor(private readonly config: CertifyCoursesConfig) {}

  async run(inputs: CourseInput[]): Promise<void> {
    for (const input of inputs) {
      await this.processCourse(input);
    }
  }

  private async processCourse(courseInput: CourseInput): Promise<void> {
    logger.info(`Certify start: ${courseInput.title}`);

    const page = await this.config.browser.newPage();

    try {
      const course = await this.config.scraper.scrapeCourse(
        page,
        courseInput.url,
      );
      const firstLesson = this.getFirstLesson(
        course.chapters.flatMap((chapter) => chapter.lessons),
      );

      if (!firstLesson) {
        logger.warn(`No lessons found to certify for ${course.title}`);
        return;
      }

      await this.openLessonPage(page, firstLesson);
      await this.ensureLessonsMenuOpen(page);
      await this.clickCompleteIcons(page, course.title);

      logger.info(`Certify complete: ${course.title}`);
    } catch (error) {
      logger.error(
        `Certify failed for "${courseInput.title}": ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      await page.close().catch(() => undefined);
    }
  }

  private getFirstLesson(lessons: Lesson[]): Lesson | undefined {
    if (lessons.length === 0) return undefined;
    return lessons.reduce((earliest, lesson) =>
      lesson.index < earliest.index ? lesson : earliest,
    );
  }

  private async openLessonPage(page: Page, lesson: Lesson): Promise<void> {
    await page.goto(lesson.url, {
      waitUntil: "networkidle",
      timeout: this.config.lessonTimeoutMs,
    });
  }

  private async ensureLessonsMenuOpen(page: Page): Promise<void> {
    const leftRibbon = page.locator("div[data-player-mount='LeftRibbon']");
    await leftRibbon.waitFor({ state: "visible", timeout: 30_000 });

    const lessonsButton = leftRibbon.locator("button:nth-child(1)");
    await lessonsButton.waitFor({ state: "visible", timeout: 15_000 });

    const isActive = await lessonsButton
      .evaluate((el) => el.classList.contains("active"))
      .catch(() => false);

    if (isActive) return;

    await lessonsButton.click();

    const handle = await lessonsButton.elementHandle();
    if (!handle) return;

    await page.waitForFunction(
      (el) => el.classList.contains("active"),
      handle,
      { timeout: 15_000 },
    );
  }

  private async clickCompleteIcons(
    page: Page,
    courseTitle: string,
  ): Promise<void> {
    const icons = page.locator("li.lesson div.complete-icon");
    await icons
      .first()
      .waitFor({ state: "attached", timeout: 15_000 })
      .catch(() => undefined);

    const count = await icons.count();
    if (count === 0) {
      logger.warn(`No complete icons found for ${courseTitle}`);
      return;
    }

    for (let i = 0; i < count; i += 1) {
      const icon = icons.nth(i);

      try {
        await icon.scrollIntoViewIfNeeded();
        await icon.click({ timeout: 10_000, force: true });
        await delay(150);
      } catch {
        logger.warn(
          `Failed to click complete icon #${i + 1} for ${courseTitle}, skipping...`,
        );
        continue;
      }
    }
  }
}
