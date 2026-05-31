// ── Publisher interface ───────────────────────────────────────────────────────

export interface PublishPayload {
  jobId: string;
  videoPath: string;
  title: string;
  description: string;
  tags: string[];
  coverPath: string | null;
  subtitlePath: string | null;  // SRT file path
}

export interface PublishResult {
  platform: string;
  videoId: string;
  url: string;
  publishedAt: string;          // ISO 8601
}

export interface Publisher {
  readonly platform: string;
  publish(payload: PublishPayload): Promise<PublishResult>;
}

// ── Bilibili types ────────────────────────────────────────────────────────────

export interface BilibiliConfig {
  accessToken: string;
  refreshToken: string;
  mid: number;                  // user ID
}

export interface BilibiliVideoMeta {
  title: string;
  desc: string;
  tag: string;                  // comma-separated
  tid: number;                  // category ID — 17 = gaming, 181 = tech, etc.
  cover: string;                // cover image URL or base64
}
