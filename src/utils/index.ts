import { stat, unlink } from "node:fs/promises";
import path from "node:path";
import slugify from "@sindresorhus/slugify";

const MIN_LESSON_MP4_BYTES = 100 * 1024;

export const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const formatDuration = (ms: number): string => {
  const totalSec = Math.ceil(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;

  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
};

const HOUR_MS = 60 * 60 * 1000;

export const DEFAULT_RUN_DURATION_MS = HOUR_MS;
export const DEFAULT_PAUSE_DURATION_MS = HOUR_MS;

export const getAbsoluteUrl = (path: string, baseUrl: string): string => {
  try {
    return new URL(path, baseUrl).href;
  } catch {
    return path;
  }
};

export const toFileSlug = (value: string): string => {
  const slug = slugify(value, { separator: "-" });
  return slug.length > 0 ? slug : "untitled";
};

export const parseResolutionHeight = (resolution: string): number => {
  const match = resolution.match(/(\d+)x(\d+)/);
  if (!match) return 0;
  return Number(match[2]);
};

export const lessonOutputPath = (
  courseDir: string,
  lessonIndex: number,
  lessonTitle: string
): string => {
  const lessonSlug = toFileSlug(`${lessonIndex + 1}-${lessonTitle}`);
  return path.join(courseDir, `${lessonSlug}.mp4`);
};

export const isCompleteLessonFile = async (filePath: string): Promise<boolean> => {
  try {
    const fileStat = await stat(filePath);
    return fileStat.isFile() && fileStat.size >= MIN_LESSON_MP4_BYTES;
  } catch {
    return false;
  }
};

export const removeIncompleteLessonFile = async (filePath: string): Promise<void> => {
  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile() || fileStat.size >= MIN_LESSON_MP4_BYTES) return;
    await unlink(filePath);
  } catch {
    // File does not exist or cannot be removed; download flow will handle it.
  }
};

