export interface SegmentDownloadSpeed {
  instantBps: number;
  avgBps: number;
  totalBytes: number;
  elapsedMs: number;
}

interface SegmentDownloadProgressBase {
  mediaSlug: string;
  timestamp: number;
}

export type SegmentDownloadProgressEvent =
  | (SegmentDownloadProgressBase & {
      type: "start";
      totalSegments: number;
      downloadedSegments: number;
    })
  | (SegmentDownloadProgressBase & {
      type: "segment-complete";
      sequence: number;
      totalSegments: number;
      downloadedSegments: number;
      speed: SegmentDownloadSpeed;
    })
  | (SegmentDownloadProgressBase & {
      type: "tick";
      totalSegments: number;
      downloadedSegments: number;
      speed: SegmentDownloadSpeed;
    })
  | (SegmentDownloadProgressBase & {
      type: "retry";
      sequence: number;
      attempt: number;
      maxRetries: number;
      reason: string;
    })
  | (SegmentDownloadProgressBase & {
      type: "complete";
      totalSegments: number;
      downloadedSegments: number;
      speed: SegmentDownloadSpeed;
    })
  | (SegmentDownloadProgressBase & {
      type: "error";
      message: string;
      sequence?: number;
      recoverable: boolean;
    });

export type SegmentDownloadProgressHandler = (event: SegmentDownloadProgressEvent) => void;
