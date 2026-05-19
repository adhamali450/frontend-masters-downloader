import { createReadStream, createWriteStream } from "node:fs";
import { unlink } from "node:fs/promises";
import path from "node:path";
import ffmpeg from "fluent-ffmpeg";
import { ISegmentStitcher } from "./ISegmentStitcher.js";
import { logger } from "../../utils/logger.js";

export interface StitchMetadata {
  title?: string;
  description?: string;
  courseTitle?: string;
}

export class SegmentStitcher implements ISegmentStitcher {
  async stitch(
    segmentPaths: string[],
    outputPath: string,
    deleteSegmentsAfterStitching?: boolean,
    metadata?: StitchMetadata
  ): Promise<void> {
    logger.info(`Stitching ${segmentPaths.length} segments -> ${path.basename(outputPath)}`);

    const binaryStitchPath = outputPath.replace(path.extname(outputPath), ".temp.ts");
    await this.binaryStitch(segmentPaths, binaryStitchPath);

    try {
      await this.normalizeWithFfmpeg(binaryStitchPath, outputPath, metadata);
      logger.info(`Stitch complete: ${path.basename(outputPath)}`);
      if (deleteSegmentsAfterStitching) {
        await Promise.all(segmentPaths.map((p) => unlink(p).catch(() => undefined)));
      }
    } catch (err) {
      logger.error(
        `Stitching failed for ${path.basename(outputPath)}: ${err instanceof Error ? err.message : String(err)}`
      );
      throw err;
    } finally {
      await unlink(binaryStitchPath).catch(() => undefined);
    }
  }

  private binaryStitch(segmentPaths: string[], outputPath: string): Promise<void> {
    const outputStream = createWriteStream(outputPath);

    return new Promise((resolve, reject) => {
      outputStream.on("error", reject);
      outputStream.on("finish", resolve);

      const appendNext = (index: number) => {
        if (index === segmentPaths.length) {
          outputStream.end();
          return;
        }

        const inputStream = createReadStream(segmentPaths[index]);
        inputStream.pipe(outputStream, { end: false });

        inputStream.on("end", () => {
          appendNext(index + 1);
        });

        inputStream.on("error", (err) => {
          outputStream.destroy();
          reject(err);
        });
      };

      appendNext(0);
    });
  }

  private async normalizeWithFfmpeg(
    inputPath: string,
    outputPath: string,
    metadata?: StitchMetadata
  ): Promise<void> {
    await new Promise((resolve, reject) => {
      const command = ffmpeg(inputPath)
        .inputOptions("-loglevel", "error")
        .outputOptions([
          "-map 0:v?",
          "-map 0:a?",
          "-c:v",
          "copy",
          "-c:a",
          "aac",
          "-b:a",
          "256k",
          "-fflags",
          "+genpts",
          "-async",
          "1",
          "-movflags",
          "+faststart",
          "-ignore_unknown",
        ]);

      if (metadata?.title) command.outputOptions("-metadata", `title=${metadata.title}`);
      if (metadata?.description) command.outputOptions("-metadata", `comment=${metadata.description}`);
      if (metadata?.courseTitle) command.outputOptions("-metadata", `album=${metadata.courseTitle}`);

      command
        .on("end", () => resolve(outputPath))
        .on("error", (err) => reject(new Error(`normalization failed: ${err.message}`)))
        .save(outputPath);
    });
  }
}
