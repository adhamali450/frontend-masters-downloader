export interface VideoVariant {
  resolution: string;
  bitrate: number;
  url: string;
  codecs?: string;
}

export interface MasterPlaylist {
  variants: VideoVariant[];
}

export interface KeyConfig {
  method: string;
  uri: string;
  iv?: string;
}

export interface IndexPlaylist {
  segments: MediaSegment[];
  keyConf: KeyConfig | null;
  targetDuration: number;
  totalDuration: number;
}

export interface MediaSegment {
  url: string;
  duration: number;
  sequence: number;
}
