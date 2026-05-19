import { Readable } from "node:stream";
import { KeyConfig } from "../../domain/entities/Playlist.js";

export interface NormalizeSegmentPayloadInput {
  downloadStream: Readable;
  tempOutputFile: string;
  keyBuffer: Buffer | null;
  keyConf: KeyConfig | null;
  sequence: number;
  contentEncodingHeader: string | string[] | undefined;
}

export interface ISegmentPayloadNormalizer {
  normalizeAndWrite(input: NormalizeSegmentPayloadInput): Promise<void>;
}
