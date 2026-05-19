import path from "node:path";
import { mkdir, readdir, rm } from "node:fs/promises";
import * as os from "node:os";

export interface TempMediaRef {
  kind: "lesson";
  slug: string;
}

export class TempMediaPaths {
  readonly rootDir: string;

  constructor(public readonly media: TempMediaRef) {
    const workspaceName = [media.kind, this.sanitize(media.slug)].join("-");
    this.rootDir = path.join(this.getTempDir(), "temp", workspaceName);
  }

  static forLesson(lessonSlug: string): TempMediaPaths {
    return new TempMediaPaths({
      kind: "lesson",
      slug: lessonSlug,
    });
  }

  segmentsDir(): string {
    return path.join(this.rootDir, "segments");
  }

  cookiesPath(): string {
    return path.join(this.rootDir, "cookies.json");
  }

  segmentPath(sequence: number): string {
    return path.join(this.segmentsDir(), `seg_${sequence}.ts`);
  }

  async listOrderedSegments(): Promise<string[]> {
    const files = await readdir(this.segmentsDir());

    return files
      .filter((fileName) => /^seg_\d+\.ts$/i.test(fileName))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .map((fileName) => path.join(this.segmentsDir(), fileName));
  }

  async init(): Promise<void> {
    await mkdir(this.segmentsDir(), { recursive: true });
  }

  async cleanup(): Promise<void> {
    await rm(this.rootDir, { recursive: true, force: true });
  }

  private sanitize(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9._-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
  }

  private getTempDir(): string {
    if (process.env.NODE_ENV === "production") {
      return os.tmpdir();
    }
    return process.cwd();
  }
}
