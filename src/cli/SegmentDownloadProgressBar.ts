import cliProgress from "cli-progress";
import {
  SegmentDownloadProgressEvent,
  SegmentDownloadProgressHandler,
  SegmentDownloadSpeed,
} from "../domain/entities/SegmentDownloadProgress.js";

const formatSpeed = (speed: SegmentDownloadSpeed): string => {
  const bps = speed.instantBps > 0 ? speed.instantBps : speed.avgBps;
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(1)} MB/s`;
  if (bps >= 1_000) return `${(bps / 1_000).toFixed(1)} KB/s`;
  return `${Math.round(bps)} B/s`;
};

const truncateLabel = (label: string, maxLen = 48): string => {
  if (label.length <= maxLen) return label.padEnd(maxLen);
  return `${label.slice(0, maxLen - 1)}…`;
};

export const createSegmentDownloadProgressHandler = (
  displayLabel: string,
): SegmentDownloadProgressHandler => {
  let bar: cliProgress.SingleBar | undefined;

  const stopBar = (): void => {
    if (!bar) return;
    bar.stop();
    bar = undefined;
  };

  return (event: SegmentDownloadProgressEvent) => {
    switch (event.type) {
      case "start": {
        stopBar();
        bar = new cliProgress.SingleBar(
          {
            clearOnComplete: true,
            hideCursor: true,
            gracefulExit: true,
            format:
              " {label} |{bar}| {percentage}% | {value}/{total} segments | {speed}",
            barsize: 28,
          },
          cliProgress.Presets.shades_classic,
        );
        bar.start(event.totalSegments, event.downloadedSegments, {
          label: truncateLabel(displayLabel),
          speed: "…",
        });
        break;
      }
      case "segment-complete":
      case "tick": {
        bar?.update(event.downloadedSegments, {
          speed: formatSpeed(event.speed),
        });
        break;
      }
      case "complete": {
        if (bar) {
          bar.update(event.totalSegments, {
            speed: formatSpeed(event.speed),
          });
        }
        stopBar();
        break;
      }
      case "error": {
        stopBar();
        break;
      }
      default:
        break;
    }
  };
};
