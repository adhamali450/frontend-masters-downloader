import { Course, Chapter, Lesson } from "../../domain/entities/Course.js";
import { getAbsoluteUrl } from "../../utils/index.js";
import { Page } from "playwright";

export class CourseScraper {
  async scrapeCourse(page: Page, courseUrl: string): Promise<Course> {
    await page.goto(courseUrl, { waitUntil: "networkidle" });

    let titleText = await page.locator("header.Course-Header h1.FM-Heading-2").textContent().catch(() => null);
    if (!titleText) {
      titleText = await page.title().catch(() => null);
    }
    const title = titleText?.trim() || "Untitled Course";

    const chapterHeaderLocators = await page.locator("div.Course-Lesson-Group").all();
    const chapterLessonsLocators = await page.locator("ul.Course-Lesson-List").all();

    if (chapterHeaderLocators.length === 0 || chapterHeaderLocators.length !== chapterLessonsLocators.length) {
      throw new Error("Course structure has changed. Update CourseScraper selectors.");
    }

    const chapters: Chapter[] = [];

    let lessonIndex = 0;
    for (let chapterIndex = 0; chapterIndex < chapterHeaderLocators.length; chapterIndex++) {
      const headerLocator = chapterHeaderLocators[chapterIndex];
      const lessonsLocator = chapterLessonsLocators[chapterIndex];
      
      const chapterTitleText = await headerLocator.locator("h3.FM-Heading-3").textContent().catch(() => null);
      const chapterTitle = chapterTitleText?.trim() || `Chapter ${chapterIndex + 1}`;

      const individualLessons = await lessonsLocator.locator("li.Course-Lesson-List-Item").all();
      const lessons: Lesson[] = [];

      for (let i = 0; i < individualLessons.length; i++) {
        const lessonLocator = individualLessons[i];
        const linkLocator = lessonLocator.locator("h3.title a");
        
        if (await linkLocator.count() === 0) continue;

        const lessonTitleText = await linkLocator.textContent().catch(() => null);
        const href = await linkLocator.getAttribute("href").catch(() => null);
        
        const descLocator = lessonLocator.locator(".description");
        const descriptionText = await descLocator.count() > 0 ? await descLocator.textContent().catch(() => null) : null;

        if (lessonTitleText && href) {
          lessons.push({
            title: lessonTitleText.trim() || `Lesson ${lessonIndex + 1}`,
            url: getAbsoluteUrl(href, courseUrl),
            index: lessonIndex++,
            description: descriptionText?.trim() || undefined,
            chapterTitle,
          });
        }
      }

      chapters.push({
        title: chapterTitle,
        index: chapterIndex,
        lessons,
      });
    }

    if (chapters.length === 0 || chapters.every((chapter) => chapter.lessons.length === 0)) {
      throw new Error("Could not detect course structure. Update CourseScraper selectors.");
    }

    return {
      title,
      url: courseUrl,
      chapters,
    };
  }
}
