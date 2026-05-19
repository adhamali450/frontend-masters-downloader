import { getAbsoluteUrl } from "../../utils/index.js";
import { IndexPlaylist, MasterPlaylist, VideoVariant } from "../entities/Playlist.js";

export class PlaylistParser {
  public parseIndexPlaylist(playlistContent: string, baseUrl: string): IndexPlaylist {
    const lines = playlistContent.split("\n");
    const segments: IndexPlaylist["segments"] = [];

    let currentDuration = 0;
    let sequence = 0;
    let targetDuration = 0;
    let totalDuration = 0;
    let keyConfig: IndexPlaylist["keyConf"] = null;

    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed.startsWith("#EXTINF:")) {
        const durationMatch = trimmed.match(/#EXTINF:([\d.]+)/);
        currentDuration = durationMatch ? parseFloat(durationMatch[1]) : 0;
      } else if (trimmed.startsWith("#EXT-X-TARGETDURATION:")) {
        const tdMatch = trimmed.match(/#EXT-X-TARGETDURATION:(\d+)/);
        targetDuration = tdMatch ? parseInt(tdMatch[1], 10) : 0;
      } else if (trimmed.startsWith("#EXT-X-KEY:")) {
        const methodMatch = trimmed.match(/METHOD=([^,]+)/);
        const uriMatch = trimmed.match(/URI=\"([^\"]+)\"/);
        const ivMatch = trimmed.match(/IV=([^,]+)/);

        if (methodMatch && methodMatch[1] !== "NONE") {
          keyConfig = {
            method: methodMatch[1],
            uri: uriMatch ? getAbsoluteUrl(uriMatch[1], baseUrl) : "",
          };

          if (ivMatch) {
            keyConfig.iv = ivMatch[1];
          }
        }
      } else if (trimmed.length > 0 && !trimmed.startsWith("#")) {
        const absoluteUrl = getAbsoluteUrl(trimmed, baseUrl);

        segments.push({
          url: absoluteUrl,
          duration: currentDuration,
          sequence: sequence++,
        });

        totalDuration += currentDuration;
        currentDuration = 0;
      }
    }

    return {
      segments,
      keyConf: keyConfig,
      targetDuration,
      totalDuration,
    };
  }

  public parseMasterPlaylist(playlistContent: string, baseUrl: string): MasterPlaylist {
    const lines = playlistContent.split("\n");
    const variants: VideoVariant[] = [];

    let pendingMetadata: Partial<VideoVariant> | null = null;

    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed.startsWith("#EXT-X-STREAM-INF:")) {
        const resMatch = trimmed.match(/RESOLUTION=([\d+x\d+]+)/);
        const bwMatch = trimmed.match(/BANDWIDTH=(\d+)/);
        const codecMatch = trimmed.match(/CODECS=\"([^\"]+)\"/);

        pendingMetadata = {
          resolution: resMatch ? resMatch[1] : "unknown",
          bitrate: bwMatch ? parseInt(bwMatch[1], 10) : 0,
          codecs: codecMatch ? codecMatch[1] : undefined,
        };
      } else if (trimmed.length > 0 && !trimmed.startsWith("#")) {
        if (pendingMetadata) {
          variants.push({
            ...(pendingMetadata as VideoVariant),
            url: getAbsoluteUrl(trimmed, baseUrl),
          });

          pendingMetadata = null;
        }
      }
    }

    return { variants };
  }
}
