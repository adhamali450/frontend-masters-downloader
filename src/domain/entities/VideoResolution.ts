export const VIDEO_RESOLUTIONS = [1080, 720, 480, 360] as const;

export type VideoResolution = (typeof VIDEO_RESOLUTIONS)[number];

export const isVideoResolution = (value: number): value is VideoResolution =>
  (VIDEO_RESOLUTIONS as readonly number[]).includes(value);
