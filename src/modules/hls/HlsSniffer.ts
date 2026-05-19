import { Page, Response } from "playwright";
import { saveCookies } from "../../utils/cookies.js";
import { logger } from "../../utils/logger.js";

export interface MasterPlaylistCapture {
  url: string;
  body: string;
  cookiesPath: string;
}

export interface HlsSnifferOptions {
  navigationTimeoutMs: number;
  playlistTimeoutMs: number;
  cookiesPath: string;
}

export class HlsSniffer {
  async captureMasterPlaylist(
    page: Page,
    lessonUrl: string,
    options: HlsSnifferOptions
  ): Promise<MasterPlaylistCapture> {
    const playlistPromise = new Promise<MasterPlaylistCapture>((resolve, reject) => {
      const onResponse = async (response: Response) => {
        if (!response.url().includes(".m3u8")) return;

        try {
          const text = await response.text();
          const cookies = await page.context().cookies(response.url());
          await saveCookies(options.cookiesPath, cookies);

          page.off("response", onResponse);
          resolve({
            url: response.url(),
            body: text,
            cookiesPath: options.cookiesPath,
          });
        } catch (err) {
          logger.error(`Error reading playlist body: ${err instanceof Error ? err.message : String(err)}`);
        }
      };

      page.on("response", onResponse);

      setTimeout(() => {
        page.off("response", onResponse);
        reject(new Error(`Timed out waiting for HLS playlist on ${lessonUrl}`));
      }, options.playlistTimeoutMs);
    });

    const [playlistData] = await Promise.all([
      playlistPromise,
      page.goto(lessonUrl, {
        waitUntil: "commit",
        timeout: options.navigationTimeoutMs,
      }),
    ]);

    return playlistData;
  }
}
