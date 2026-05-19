import { readFile } from "node:fs/promises";
import { CourseInput } from "../domain/entities/Course.js";

export async function loadCourseInputs(filePath: string): Promise<CourseInput[]> {
  const raw = await readFile(filePath, "utf-8");
  const data = JSON.parse(raw);

  if (!Array.isArray(data)) {
    throw new Error("Input JSON must be an array of courses.");
  }

  return data.map((item, index) => {
    if (!item || typeof item !== "object") {
      throw new Error(`Invalid course entry at index ${index}.`);
    }

    const title = String(item.title || "").trim();
    const url = String(item.url || "").trim();

    if (!title || !url) {
      throw new Error(`Course entry at index ${index} must include title and url.`);
    }

    return { title, url } satisfies CourseInput;
  });
}
