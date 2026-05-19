import { createWriteStream } from "node:fs";
import { spawn } from "node:child_process";
import { createBrotliDecompress, createGunzip } from "node:zlib";
import { Readable, Transform, PassThrough, Duplex } from "node:stream";
import type { TransformCallback } from "node:stream";
import { pipeline } from "node:stream/promises";
import crypto from "node:crypto";
import { ISegmentPayloadNormalizer, NormalizeSegmentPayloadInput } from "./ISegmentPayloadNormalizer.js";

type SegmentFormat = "zstd" | "gzip" | "brotli" | "trojan-header" | "mpeg-ts" | "adts-aac";

export class FailFastSegmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FailFastSegmentError";
  }
}

class TrojanHeaderStripperTransform extends Transform {
  private readonly maxProbeBytes = 8192;
  private probeBuffer = Buffer.alloc(0);
  private stripped = false;

  private isAdtsSyncAt(buffer: Buffer, index: number): boolean {
    if (index + 1 >= buffer.length) return false;
    const b0 = buffer[index];
    const b1 = buffer[index + 1];
    return b0 === 0xff && (b1 & 0xf0) === 0xf0;
  }

  private findPayloadOffset(buffer: Buffer): number {
    for (let i = 0; i < buffer.length; i += 1) {
      if (buffer[i] === 0x47) {
        const secondPacketOffset = i + 188;
        if (secondPacketOffset < buffer.length && buffer[secondPacketOffset] !== 0x47) continue;
        return i;
      }

      if (this.isAdtsSyncAt(buffer, i)) {
        return i;
      }
    }

    return -1;
  }

  _transform(chunk: Buffer | string, _encoding: BufferEncoding, callback: TransformCallback): void {
    if (this.stripped) {
      this.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      callback();
      return;
    }

    const chunkBuffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    this.probeBuffer = Buffer.concat([this.probeBuffer, chunkBuffer]);

    const payloadOffset = this.findPayloadOffset(this.probeBuffer);
    if (payloadOffset >= 0) {
      this.stripped = true;
      this.push(this.probeBuffer.subarray(payloadOffset));
      this.probeBuffer = Buffer.alloc(0);
      callback();
      return;
    }

    if (this.probeBuffer.length > this.maxProbeBytes) {
      callback(new FailFastSegmentError("Trojan header strip failed: payload sync not found in probe window."));
      return;
    }

    callback();
  }

  _flush(callback: TransformCallback): void {
    if (this.stripped) {
      callback();
      return;
    }

    const payloadOffset = this.findPayloadOffset(this.probeBuffer);
    if (payloadOffset >= 0) {
      this.push(this.probeBuffer.subarray(payloadOffset));
      callback();
      return;
    }

    callback(new FailFastSegmentError("Trojan header strip failed: stream ended before payload sync was found."));
  }
}

export class SegmentPayloadNormalizer implements ISegmentPayloadNormalizer {
  async normalizeAndWrite(input: NormalizeSegmentPayloadInput): Promise<void> {
    const { downloadStream, tempOutputFile, keyBuffer, keyConf, sequence, contentEncodingHeader } = input;

    let source: Readable = downloadStream;

    if (keyBuffer && keyConf?.method === "AES-128") {
      const ivBuffer = this.getIvBuffer(keyConf.iv, sequence);
      const decipher = crypto.createDecipheriv("aes-128-cbc", keyBuffer, ivBuffer);
      source = source.pipe(decipher);
    }

    const { head, stream } = await this.peekReadable(source, 8);
    const format = this.detectSegmentFormat(head, contentEncodingHeader);
    const normalizedStream = this.routeNormalizedStream(stream, format);

    const writeStream = createWriteStream(tempOutputFile);
    await pipeline(normalizedStream, writeStream);
  }

  private async peekReadable(input: Readable, bytesToPeek: number): Promise<{ head: Buffer; stream: Readable }> {
    const iterator = input[Symbol.asyncIterator]();
    const bufferedChunks: Buffer[] = [];
    let bufferedLength = 0;

    while (bufferedLength < bytesToPeek) {
      const next = await iterator.next();
      if (next.done) break;
      const chunk = Buffer.isBuffer(next.value) ? next.value : Buffer.from(next.value);
      bufferedChunks.push(chunk);
      bufferedLength += chunk.length;
    }

    const concatenated = bufferedChunks.length > 0 ? Buffer.concat(bufferedChunks) : Buffer.alloc(0);
    const head = concatenated.subarray(0, Math.min(bytesToPeek, concatenated.length));

    const stream = Readable.from(
      (async function* () {
        for (const chunk of bufferedChunks) {
          yield chunk;
        }

        while (true) {
          const next = await iterator.next();
          if (next.done) return;
          yield Buffer.isBuffer(next.value) ? next.value : Buffer.from(next.value);
        }
      })()
    );

    return { head, stream };
  }

  private detectSegmentFormat(head: Buffer, contentEncodingHeader: string | string[] | undefined): SegmentFormat {
    if (head.length === 0) {
      throw new Error("Empty segment payload");
    }

    const b0 = head[0];
    const b1 = head[1];

    if (b0 === 0x28 && b1 === 0xb5) return "zstd";
    if (b0 === 0x1f && b1 === 0x8b) return "gzip";
    if (b0 === 0x89 && b1 === 0x50) return "trojan-header";
    if (b0 === 0xff && b1 === 0xd8) return "trojan-header";
    if (b0 === 0x47) return "mpeg-ts";
    if (b0 === 0xff && (b1 & 0xf0) === 0xf0) return "adts-aac";

    const contentEncoding = Array.isArray(contentEncodingHeader)
      ? contentEncodingHeader.join(",").toLowerCase()
      : (contentEncodingHeader ?? "").toLowerCase();

    if (contentEncoding.includes("br")) return "brotli";

    throw new FailFastSegmentError(
      `Unknown segment payload format. First bytes: ${head.subarray(0, 8).toString("hex") || "empty"}`
    );
  }

  private routeNormalizedStream(stream: Readable, format: SegmentFormat): Readable {
    if (format === "zstd") return stream.pipe(this.createZstdDecompressStream());
    if (format === "gzip") return stream.pipe(createGunzip());
    if (format === "brotli") return stream.pipe(createBrotliDecompress());
    if (format === "trojan-header") return stream.pipe(new TrojanHeaderStripperTransform());
    return stream;
  }

  private createZstdDecompressStream(): Duplex {
    const input = new PassThrough();
    const output = new PassThrough();

    const proc = spawn("zstd", ["-d", "-c"], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stderr = "";

    proc.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    proc.on("error", (error) => {
      output.destroy(new FailFastSegmentError(`Failed to start zstd process: ${error.message}`));
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        output.destroy(
          new FailFastSegmentError(`zstd decompression failed with exit code ${code}. ${stderr.trim()}`.trim())
        );
      }
    });

    pipeline(input, proc.stdin!).catch((error) => output.destroy(error));
    pipeline(proc.stdout!, output).catch((error) => output.destroy(error));

    return Duplex.from({
      writable: input,
      readable: output,
    } as any);
  }

  private getIvBuffer(ivHex: string | undefined, sequence: number): Buffer {
    if (ivHex) {
      const hexStr = ivHex.startsWith("0x") ? ivHex.slice(2) : ivHex;
      return Buffer.from(hexStr, "hex");
    }

    const iv = Buffer.alloc(16, 0);
    iv.writeUInt32BE(sequence, 12);
    return iv;
  }
}
