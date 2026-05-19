import { stat } from "node:fs/promises";
import { PassThrough, Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import pMap from "p-map";
import { gotScraping } from "got-scraping";
import { IndexPlaylist } from "../../domain/entities/Playlist.js";
import { cookiesToHeader, loadCookies } from "../../utils/cookies.js";
import { delay } from "../../utils/index.js";
import { ISegmentPayloadNormalizer } from "./ISegmentPayloadNormalizer.js";
import { logger } from "../../utils/logger.js";
import { SegmentDownloadProgressHandler } from "../../domain/entities/SegmentDownloadProgress.js";
import { SpeedMeter } from "./SpeedMeter.js";
import { FailFastSegmentError } from "./SegmentPayloadNormalizer.js";
import fs from "node:fs/promises";
import { ISegmentDownloader, ShouldContinue } from "./ISegmentDownloader.js";

export class RunWindowExpiredError extends Error {
  constructor() {
    super("Run window expired");
    this.name = "RunWindowExpiredError";
  }
}

export class SegmentDownloader implements ISegmentDownloader {
  private readonly maxSegmentRetries = 8;
  private readonly concurrency = 1;
  private readonly ratelimitDelay = 1_500;
  private readonly keyRequestTimeoutMs = 10_000;
  private readonly segmentResponseTimeoutMs = 30_000;
  private readonly normalizeTimeoutMs = 60_000;

  private keyCache = new Map<string, Buffer>();

  constructor(private readonly segmentNormalizer: ISegmentPayloadNormalizer) {}

  async downloadSegments(
    playlist: IndexPlaylist,
    mediaSlug: string,
    outputDir: string,
    cookiesPath: string,
    onProgress?: SegmentDownloadProgressHandler,
    shouldContinue: ShouldContinue = () => true,
  ): Promise<string> {
    const cookies = await loadCookies(cookiesPath);
    const requestHeaders = cookiesToHeader(cookies);

    const sequences = playlist.segments.map((s) => s.sequence);
    logger.debug(`Downloading ${sequences.length} segments for ${mediaSlug}`);

    const speedMeter = new SpeedMeter(1000);
    let downloadedSegments = 0;
    const totalSegments = sequences.length;

    onProgress?.({
      type: "start",
      mediaSlug,
      totalSegments,
      downloadedSegments,
      timestamp: Date.now(),
    });

    const progressTicker = onProgress
      ? setInterval(() => {
          onProgress({
            type: "tick",
            mediaSlug,
            downloadedSegments,
            totalSegments,
            speed: this.mapSpeed(speedMeter),
            timestamp: Date.now(),
          });
        }, 400)
      : undefined;

    try {
      await pMap(
        sequences,
        async (sequence) => {
          if (!shouldContinue()) {
            throw new RunWindowExpiredError();
          }

          await this.downloadSingle(
            sequence,
            playlist,
            outputDir,
            speedMeter,
            requestHeaders,
          );

          downloadedSegments += 1;
          onProgress?.({
            type: "segment-complete",
            mediaSlug,
            sequence,
            downloadedSegments,
            totalSegments,
            speed: this.mapSpeed(speedMeter),
            timestamp: Date.now(),
          });
        },
        { concurrency: this.concurrency },
      );

      onProgress?.({
        type: "complete",
        mediaSlug,
        downloadedSegments,
        totalSegments,
        speed: this.mapSpeed(speedMeter),
        timestamp: Date.now(),
      });
    } catch (error) {
      onProgress?.({
        type: "error",
        mediaSlug,
        message: (error as Error).message,
        recoverable: false,
        timestamp: Date.now(),
      });

      throw error;
    } finally {
      if (progressTicker) clearInterval(progressTicker);
      speedMeter.resetMeter();
      this.keyCache.clear();
    }

    return outputDir;
  }

  private async downloadSingle(
    sequence: number,
    playlist: IndexPlaylist,
    outputDir: string,
    speedMeter: SpeedMeter,
    requestHeaders: Record<string, string>,
  ): Promise<void> {
    const outputFile = path.join(outputDir, `seg_${sequence}.ts`);

    try {
      const fileStat = await stat(outputFile);
      if (fileStat.size > 0) return;
    } catch {}

    let localRetries = 0;

    while (true) {
      try {
        const segment = playlist.segments.find((s) => s.sequence === sequence);
        if (!segment) {
          throw new Error(`Segment ${sequence} missing from playlist`);
        }

        const keyBuffer = await this.getKeyBuffer(playlist, requestHeaders);
        const downloadStream = gotScraping.stream(segment.url, {
          timeout: { response: this.segmentResponseTimeoutMs, read: 10000 },
          throwHttpErrors: false,
          retry: { limit: 0 },
          headers: requestHeaders,
        });

        const response = await this.awaitResponse(
          downloadStream as unknown as Readable,
        );

        if (response.statusCode === 200) {
          const contentLengthHeader = response.headers?.["content-length"];
          const contentLength = Array.isArray(contentLengthHeader)
            ? Number.parseInt(contentLengthHeader[0] ?? "", 10)
            : Number.parseInt(contentLengthHeader ?? "", 10);

          if (Number.isFinite(contentLength) && contentLength <= 0) {
            throw new Error("Empty segment response body (content-length=0)");
          }

          const tempOutputFile = `${outputFile}.tmp`;

          const meterTap = new Transform({
            transform(chunk, _enc, cb) {
              speedMeter.addBytes(
                Buffer.isBuffer(chunk)
                  ? chunk.length
                  : Buffer.byteLength(chunk),
              );
              cb(null, chunk);
            },
          });

          const bridgedStream = new PassThrough();

          const pumpPromise = pipeline(
            downloadStream as unknown as Readable,
            meterTap,
            bridgedStream,
          );

          try {
            await this.withTimeout(
              Promise.all([
                pumpPromise,
                this.segmentNormalizer.normalizeAndWrite({
                  downloadStream: bridgedStream,
                  tempOutputFile,
                  keyBuffer,
                  keyConf: playlist.keyConf ?? null,
                  sequence,
                  contentEncodingHeader: response.headers?.["content-encoding"],
                }),
              ]).then(() => undefined),
              this.normalizeTimeoutMs,
              () => {
                const timeoutError = new Error(
                  `Segment ${sequence} payload normalization timeout after ${this.normalizeTimeoutMs}ms`,
                );
                downloadStream.destroy(timeoutError);
                meterTap.destroy(timeoutError);
                bridgedStream.destroy(timeoutError);
              },
              `Segment ${sequence} payload normalization timeout after ${this.normalizeTimeoutMs}ms`,
            );

            const tempFileStat = await stat(tempOutputFile);
            if (tempFileStat.size <= 0) {
              throw new Error("Segment payload written as zero bytes");
            }

            await fs.rename(tempOutputFile, outputFile);
            return;
          } catch (error) {
            await this.cleanupTempFile(tempOutputFile);
            throw error;
          }
        }

        downloadStream.destroy();
        throw new Error(`HTTP ${response.statusCode}`);
      } catch (error: any) {
        if (error instanceof FailFastSegmentError) {
          throw error;
        }

        localRetries += 1;
        if (localRetries > this.maxSegmentRetries) {
          throw error;
        }

        logger.warn(
          `Segment ${sequence} failed (Attempt ${localRetries}/${this.maxSegmentRetries}): ${error.message}`,
        );
        await delay(this.ratelimitDelay);
      }
    }
  }

  private async awaitResponse(stream: Readable): Promise<any> {
    return new Promise((resolve, reject) => {
      (stream as any).once("response", resolve);
      stream.once("error", reject);
    });
  }

  private async getKeyBuffer(
    playlist: IndexPlaylist,
    requestHeaders: Record<string, string>,
  ): Promise<Buffer | null> {
    if (!playlist.keyConf?.uri) return null;

    const cached = this.keyCache.get(playlist.keyConf.uri);
    if (cached) return cached;

    const response = await this.withTimeout(
      gotScraping
        .get(playlist.keyConf.uri, {
          retry: { limit: 2 },
          headers: requestHeaders,
        })
        .buffer(),
      this.keyRequestTimeoutMs,
      () => undefined,
      `Key download timed out after ${this.keyRequestTimeoutMs}ms`,
    );

    this.keyCache.set(playlist.keyConf.uri, response as Buffer);
    return response as Buffer;
  }

  private async withTimeout<T>(
    task: Promise<T>,
    timeoutMs: number,
    onTimeout?: () => void,
    timeoutMessage = "Operation timed out",
  ): Promise<T> {
    let timeoutHandle: NodeJS.Timeout | undefined;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        onTimeout?.();
        reject(new Error(timeoutMessage));
      }, timeoutMs);
    });

    return Promise.race([task, timeoutPromise]).finally(() => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }) as Promise<T>;
  }

  private async cleanupTempFile(tempOutputFile: string): Promise<void> {
    await fs.rm(tempOutputFile, { force: true }).catch(() => undefined);
  }

  private mapSpeed(speedMeter: SpeedMeter) {
    const snapshot = speedMeter.snapshot();
    return {
      instantBps: snapshot.instBps,
      avgBps: snapshot.avgBps,
      totalBytes: snapshot.totalBytes,
      elapsedMs: snapshot.elapsedMs,
    };
  }
}
