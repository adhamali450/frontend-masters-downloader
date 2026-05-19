import { gotScraping } from "got-scraping";
import { IndexPlaylist, MasterPlaylist, VideoVariant } from "../../domain/entities/Playlist.js";
import { VideoResolution } from "../../domain/entities/VideoResolution.js";
import { PlaylistParser } from "../../domain/services/PlaylistParser.js";
import { cookiesToHeader, loadCookies } from "../../utils/cookies.js";
import { parseResolutionHeight } from "../../utils/index.js";
import { logger } from "../../utils/logger.js";

export class HlsResolver {
  constructor(
    private readonly parser: PlaylistParser,
    private readonly preferredResolution?: VideoResolution
  ) {}

  async resolve(
    masterBody: string,
    masterUrl: string,
    cookiesPath?: string
  ): Promise<IndexPlaylist> {
    const master = this.parser.parseMasterPlaylist(masterBody, masterUrl);
    const variant = this.selectVariant(master);
    const indexUrl = this.buildVariantUrl(masterUrl, variant.url);
    const requestOptions = await this.buildRequestOptions(cookiesPath);

    const indexBody = await gotScraping.get(indexUrl, requestOptions).text();
    return this.parser.parseIndexPlaylist(indexBody, indexUrl);
  }

  private async buildRequestOptions(cookiesPath?: string) {
    if (!cookiesPath) return {};
    const cookies = await loadCookies(cookiesPath);
    return { headers: cookiesToHeader(cookies) };
  }

  private selectVariant(master: MasterPlaylist): VideoVariant {
    if (this.preferredResolution !== undefined) {
      const match = master.variants.find(
        (variant) => parseResolutionHeight(variant.resolution) === this.preferredResolution
      );

      if (match) return match;

      logger.warn(
        `Resolution ${this.preferredResolution}p not found in master playlist; using highest available`
      );
    }

    return this.selectTopVariant(master);
  }

  private selectTopVariant(master: MasterPlaylist): VideoVariant {
    if (master.variants.length === 0) {
      throw new Error("No variants found in master playlist.");
    }

    return [...master.variants].sort((a, b) => {
      if (a.bitrate !== b.bitrate) return b.bitrate - a.bitrate;
      return parseResolutionHeight(b.resolution) - parseResolutionHeight(a.resolution);
    })[0];
  }

  private buildVariantUrl(masterUrl: string, variantUrl: string): string {
    try {
      const base = new URL(masterUrl);
      base.search = "";
      const variant = new URL(variantUrl, masterUrl);
      const variantFile = variant.pathname.split("/").pop();
      if (!variantFile) return variant.href;
      base.pathname = base.pathname.replace(/[^/]+$/, variantFile);
      return base.href;
    } catch {
      return variantUrl;
    }
  }
}
