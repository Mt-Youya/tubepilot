// ── Job types ─────────────────────────────────────────────────────────────────
// Mirror of Rust structs in apps/desktop/src-tauri/src/lib.rs

export type PipelineStage = 0 | 1 | 2 | 3 | 4;

export const PIPELINE_STAGE = {
  FETCH: 0,
  TRANSCRIBE: 1,
  TRANSLATE: 2,
  REVIEW: 3,
  PUBLISH: 4,
} as const satisfies Record<string, PipelineStage>;

export const PIPELINE_STAGE_LABELS: Record<PipelineStage, string> = {
  0: "Fetch",
  1: "Transcribe",
  2: "Translate",
  3: "Review",
  4: "Publish",
};

export type JobStatus = "processing" | "ready" | "done" | "error" | "cancelled";

export interface Job {
  id: string;
  url: string;
  title: string | null;
  channel: string | null;
  duration: string | null;
  thumbnailUrl: string | null;
  stage: PipelineStage;
  status: JobStatus;
  addedAt: string;        // ISO 8601
  elapsedSecs: number | null;
  errorNote: string | null;
}

export interface VideoMetadata {
  title: string;
  channel: string;
  duration: string;       // "HH:MM:SS" or "MM:SS"
  thumbnailUrl: string | null;
}
