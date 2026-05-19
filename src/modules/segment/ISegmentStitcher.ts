import { StitchMetadata } from "./SegmentStitcher.js";

export interface ISegmentStitcher {
  stitch(
    segmentPaths: string[],
    outputFilePath: string,
    deleteSegmentsAfterStitching?: boolean,
    metadata?: StitchMetadata
  ): Promise<void>;
}
