import { IndexPlaylist } from "../../domain/entities/Playlist.js";
import { SegmentDownloadProgressHandler } from "../../domain/entities/SegmentDownloadProgress.js";

export type ShouldContinue = () => boolean;

export interface ISegmentDownloader {
  downloadSegments(
    playlist: IndexPlaylist,
    mediaSlug: string,
    outputDir: string,
    cookiesPath: string,
    onProgress?: SegmentDownloadProgressHandler,
    shouldContinue?: ShouldContinue
  ): Promise<string>;
}
