/**
 * Tauri API bridge — typed wrappers around invoke/listen.
 *
 * Uses window.__TAURI_INTERNALS__ directly so this file compiles without
 * @tauri-apps/api installed. The package is used at runtime only (installed
 * before `pnpm tauri:dev`).
 */

// ── Types (mirror Rust structs in src-tauri/src/lib.rs) ─────────────────────

export type PipelineStage = 0 | 1 | 2 | 3 | 4;

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
  addedAt: string;
  elapsedSecs: number | null;
  statusNote: string | null;
  errorNote: string | null;
  videoPath: string | null;
  videoDownloadPct: number | null;  // 0-100 while downloading, null = not started
}

export interface SubtitleSegment {
  id: number;
  inTime: number;
  outTime: number;
  en: string;
  zh: string;
  approved: boolean;
}

// ── Tauri v2 detection ────────────────────────────────────────────────────────

function isTauri(): boolean {
  return typeof window !== "undefined" &&
    "__TAURI_INTERNALS__" in window;
}

type UnlistenFn = () => void;

async function invoke<T>(
  command: string,
  args?: Record<string, unknown>
): Promise<T> {
  if (!isTauri()) throw new Error(`invoke("${command}") called outside Tauri`);
  const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
  return tauriInvoke<T>(command, args);
}

async function listen<T>(
  event: string,
  handler: (payload: T) => void
): Promise<UnlistenFn> {
  if (!isTauri()) return () => {};
  const { listen: tauriListen } = await import("@tauri-apps/api/event");
  return tauriListen<T>(event, (e) => handler(e.payload));
}

// ── Job commands ─────────────────────────────────────────────────────────────

export const isInsideTauri = isTauri;

export function submitJob(url: string): Promise<string> {
  return invoke<string>("submit_job", { url });
}

export function getJobs(): Promise<Job[]> {
  return invoke<Job[]>("get_jobs");
}

export function getJob(id: string): Promise<Job | null> {
  return invoke<Job | null>("get_job", { id });
}

export function cancelJob(id: string): Promise<void> {
  return invoke<void>("cancel_job", { id });
}

export function retryJob(id: string): Promise<void> {
  return invoke<void>("retry_job", { id });
}

export function deleteJob(id: string): Promise<void> {
  return invoke<void>("delete_job", { id });
}

export function publishJob(jobId: string): Promise<void> {
  return invoke<void>("publish_job", { jobId });
}

// ── Bilibili auth ─────────────────────────────────────────────────────────────

export interface BiliCredentials {
  uid: string;
  sessdata: string;
  biliJct: string;
  username: string;
  avatarUrl: string;
}

export interface BiliQrcodeInfo {
  qrcodeKey: string;
  qrSvg: string;
}

export interface BiliPollResult {
  status: "waiting" | "scanned" | "confirmed" | "expired";
  user?: BiliCredentials;
}

export function getBiliUser(): Promise<BiliCredentials | null> {
  return invoke<BiliCredentials | null>("get_bilibili_user");
}

export function biliQrcodeGenerate(): Promise<BiliQrcodeInfo> {
  return invoke<BiliQrcodeInfo>("bilibili_qrcode_generate");
}

export function biliQrcodePoll(qrcodeKey: string): Promise<BiliPollResult> {
  return invoke<BiliPollResult>("bilibili_qrcode_poll", { qrcodeKey });
}

export function biliLogout(): Promise<void> {
  return invoke<void>("bilibili_logout");
}

export interface PublishMeta {
  title: string;
  desc: string;
  tid: number;
  tags: string[];
}

export function startPublishJob(jobId: string, meta: PublishMeta): Promise<void> {
  return invoke<void>("start_publish_job", {
    jobId,
    title: meta.title,
    desc: meta.desc,
    tid: meta.tid,
    tags: meta.tags,
  });
}

// ── Subtitle commands ─────────────────────────────────────────────────────────

export function getSubtitles(jobId: string): Promise<SubtitleSegment[]> {
  return invoke<SubtitleSegment[]>("get_subtitles", { jobId });
}

export function updateSubtitle(
  jobId: string,
  segId: number,
  zh: string
): Promise<void> {
  return invoke<void>("update_subtitle", { jobId, segId, zh });
}

export function approveSubtitle(
  jobId: string,
  segId: number,
  approved: boolean
): Promise<void> {
  return invoke<void>("approve_subtitle", { jobId, segId, approved });
}

// ── Events ────────────────────────────────────────────────────────────────────

export function onJobUpdated(handler: (job: Job) => void): Promise<UnlistenFn> {
  return listen<Job>("job:updated", handler);
}

export function onJobDeleted(handler: (id: string) => void): Promise<UnlistenFn> {
  return listen<string>("job:deleted", handler);
}

// ── Settings ──────────────────────────────────────────────────────────────────

export interface AppSettings {
  downloadDir: string;
}

export function getSettings(): Promise<AppSettings> {
  return invoke<AppSettings>("get_settings");
}

export function saveSettings(settings: AppSettings): Promise<void> {
  return invoke<void>("save_settings", { settings });
}

export function selectDownloadDir(): Promise<string | null> {
  return invoke<string | null>("select_download_dir");
}
