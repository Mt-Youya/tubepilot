// ── Subtitle types ────────────────────────────────────────────────────────────

export interface SubtitleSegment {
  id: number;
  inTime: number;   // seconds
  outTime: number;  // seconds
  en: string;
  zh: string;
  approved: boolean;
}

export type SubtitleFormat = "srt" | "vtt" | "ass";

// ── Format converters (stubs) ─────────────────────────────────────────────────

export function toSRT(segments: SubtitleSegment[]): string {
  return segments
    .map((seg, i) => {
      const inTime = formatSRTTime(seg.inTime);
      const outTime = formatSRTTime(seg.outTime);
      return `${i + 1}\n${inTime} --> ${outTime}\n${seg.en}\n${seg.zh}`;
    })
    .join("\n\n");
}

export function toVTT(segments: SubtitleSegment[]): string {
  const lines = segments.map((seg) => {
    const inTime = formatVTTTime(seg.inTime);
    const outTime = formatVTTTime(seg.outTime);
    return `${inTime} --> ${outTime}\n${seg.en}\n${seg.zh}`;
  });
  return `WEBVTT\n\n${lines.join("\n\n")}`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatSRTTime(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  const ms = Math.round((secs % 1) * 1000);
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
}

function formatVTTTime(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  const ms = Math.round((secs % 1) * 1000);
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(ms, 3)}`;
}

function pad(n: number, len = 2): string {
  return String(n).padStart(len, "0");
}
