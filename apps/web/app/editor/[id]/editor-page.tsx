"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";


import {
  type SubtitleSegment,
  type BiliCredentials,
  getJob,
  getSubtitles,
  updateSubtitle,
  approveSubtitle,
  getBiliUser,
  onJobUpdated,
} from "../../../lib/tauri-api";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const cs = Math.floor((s % 1) * 100);
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

function durStr(a: number, b: number) {
  return `${(b - a).toFixed(2)}s`;
}

function parseDurationSecs(dur: string | null): number {
  if (!dur) return 0;
  const parts = dur.split(":").map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return 0;
}

// ── Video Player ──────────────────────────────────────────────────────────────

function VideoPlayer({
  currentTime,
  duration,
  isPlaying,
  activeSub,
  onPlayPause,
  onSeek,
  onSkip,
}: {
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  activeSub: SubtitleSegment | null;
  onPlayPause: () => void;
  onSeek: (t: number) => void;
  onSkip: (d: number) => void;
}) {
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="flex flex-col h-full bg-surface-raised">
      <div
        className="flex-1 bg-surface-base relative overflow-hidden cursor-pointer"
        onClick={onPlayPause}
      >
        <div
          className="absolute inset-0 opacity-[0.04] pointer-events-none"
          style={{
            backgroundImage:
              "repeating-linear-gradient(0deg, oklch(91% 0.005 240), oklch(91% 0.005 240) 1px, transparent 1px, transparent 4px)",
          }}
        />

        {!isPlaying && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-14 h-14 rounded-full bg-surface-elevated flex items-center justify-center hover:bg-surface-border transition-colors">
              <svg
                width="22"
                height="22"
                viewBox="0 0 22 22"
                fill="none"
                className="text-fg ml-1"
              >
                <path d="M7 4l12 7-12 7V4z" fill="currentColor" />
              </svg>
            </div>
          </div>
        )}

        {activeSub && (
          <div className="absolute bottom-5 left-0 right-0 flex flex-col items-center gap-1 pointer-events-none px-8">
            <p className="text-sm text-fg-muted text-center leading-snug max-w-2xl px-3 py-1 bg-surface-base/80 rounded-sm font-sans">
              {activeSub.en}
            </p>
            <p className="text-base text-fg text-center font-medium leading-snug max-w-2xl px-3 py-1 bg-surface-base/90 rounded-sm font-sans">
              {activeSub.zh}
            </p>
          </div>
        )}
      </div>

      <div className="flex-shrink-0 px-5 py-2.5 border-t border-surface-border bg-surface-raised">
        <div
          className="w-full h-[3px] bg-surface-border rounded-full cursor-pointer mb-3 group relative"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            onSeek(((e.clientX - r.left) / r.width) * duration);
          }}
        >
          <div
            className="h-full bg-accent rounded-full"
            style={{ width: `${progress}%` }}
          />
          <div
            className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-fg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
            style={{ left: `${progress}%`, transform: "translate(-50%, -50%)" }}
          />
        </div>

        <div className="flex items-center gap-4">
          <button
            onClick={() => onSkip(-10)}
            className="text-[11px] font-mono tabular-nums text-fg-muted hover:text-fg-subtle transition-colors"
            aria-label="Rewind 10 seconds"
          >
            −10s
          </button>

          <button
            onClick={onPlayPause}
            className="text-fg hover:text-accent transition-colors"
            aria-label={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? (
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <rect x="2" y="1" width="3" height="12" rx="0.5" fill="currentColor" />
                <rect x="9" y="1" width="3" height="12" rx="0.5" fill="currentColor" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M3 1.5l9 5.5-9 5.5V1.5z" fill="currentColor" />
              </svg>
            )}
          </button>

          <button
            onClick={() => onSkip(10)}
            className="text-[11px] font-mono tabular-nums text-fg-muted hover:text-fg-subtle transition-colors"
            aria-label="Forward 10 seconds"
          >
            +10s
          </button>

          <div className="flex-1" />

          <span className="font-mono text-xs text-fg tabular-nums">
            {formatTime(currentTime)}
          </span>
          <span className="text-surface-border text-xs select-none">/</span>
          <span className="font-mono text-xs text-fg-muted tabular-nums">
            {formatTime(duration)}
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Subtitle Row ──────────────────────────────────────────────────────────────

function SubtitleRow({
  seg,
  isActive,
  isEditing,
  onActivate,
  onStartEdit,
  onExitEdit,
  onToggleApprove,
  onZhChange,
}: {
  seg: SubtitleSegment;
  isActive: boolean;
  isEditing: boolean;
  onActivate: () => void;
  onStartEdit: () => void;
  onExitEdit: () => void;
  onToggleApprove: () => void;
  onZhChange: (text: string) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
      const len = textareaRef.current.value.length;
      textareaRef.current.setSelectionRange(len, len);
    }
  }, [isEditing]);

  return (
    <div
      role="row"
      onClick={onActivate}
      className={[
        "flex items-start border-b border-surface-border cursor-pointer transition-colors group",
        isActive ? "bg-surface-raised" : "hover:bg-surface-raised",
      ].join(" ")}
    >
      <div
        className={[
          "flex-shrink-0 w-9 pt-3 pl-3 text-[10px] font-mono tabular-nums select-none leading-none",
          isActive ? "text-accent" : "text-fg-muted",
        ].join(" ")}
      >
        {String(seg.id).padStart(2, "0")}
      </div>

      <div className="flex-shrink-0 w-[116px] pt-2.5 pl-2 pr-2">
        <div
          className={`text-[11px] font-mono tabular-nums leading-tight ${isActive ? "text-accent" : "text-fg-subtle"}`}
        >
          {formatTime(seg.inTime)}
        </div>
        <div className="text-[11px] font-mono tabular-nums text-fg-muted mt-px leading-tight">
          {formatTime(seg.outTime)}
        </div>
        <div className="text-[9px] font-mono tabular-nums text-fg-muted mt-1.5 opacity-50 leading-none">
          {durStr(seg.inTime, seg.outTime)}
        </div>
      </div>

      <div className="flex-1 min-w-0 py-2.5 pl-3 pr-3">
        <p className="text-[11px] text-fg-muted leading-relaxed mb-2 select-text">
          {seg.en}
        </p>

        {isEditing ? (
          <textarea
            ref={textareaRef}
            value={seg.zh}
            onChange={(e) => onZhChange(e.target.value)}
            onBlur={onExitEdit}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onExitEdit();
              }
              if (e.key === "Escape") {
                onExitEdit();
              }
              e.stopPropagation();
            }}
            onClick={(e) => e.stopPropagation()}
            rows={2}
            className="w-full bg-surface-elevated text-sm text-fg leading-relaxed px-2.5 py-1.5 rounded-sm outline-none border border-accent resize-none font-sans transition-colors"
            style={{ caretColor: "oklch(55% 0.21 255)" }}
          />
        ) : (
          <p
            className={`text-sm leading-relaxed ${isActive ? "text-fg font-medium" : "text-fg-subtle"}`}
            onDoubleClick={(e) => {
              e.stopPropagation();
              onStartEdit();
            }}
            title="Double-click to edit"
          >
            {seg.zh || <span className="text-fg-muted italic">No translation</span>}
          </p>
        )}
      </div>

      <div className="flex-shrink-0 w-10 pt-3 flex justify-center">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleApprove();
          }}
          aria-label={seg.approved ? "Unapprove" : "Approve"}
          className={[
            "w-[18px] h-[18px] rounded-sm border transition-colors flex items-center justify-center",
            seg.approved
              ? "border-success bg-success/10 text-success"
              : "border-surface-border text-transparent hover:border-fg-muted",
          ].join(" ")}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path
              d="M1.5 5l2.5 2.5 4.5-5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function EditorPageClient() {
  const params = useParams();
  const router = useRouter();
  const jobId = Array.isArray(params?.id) ? params.id[0] : (params?.id ?? "");

  const [jobTitle, setJobTitle] = useState<string>("Loading…");
  const [duration, setDuration] = useState(0);
  const [subtitles, setSubtitles] = useState<SubtitleSegment[]>([]);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [biliUser, setBiliUser] = useState<BiliCredentials | null | undefined>(undefined); // undefined = loading

  const listRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<Record<number, HTMLDivElement | null>>({});

  // Load Bilibili account info on mount
  useEffect(() => {
    getBiliUser().then(setBiliUser).catch(() => setBiliUser(null));
  }, []);

  // Load job + subtitles on mount
  useEffect(() => {
    if (!jobId) return;

    getJob(jobId).then((job) => {
      if (job) {
        setJobTitle(job.title ?? job.url);
        setDuration(parseDurationSecs(job.duration));
      }
    }).catch(console.error);

    getSubtitles(jobId).then((segs) => {
      setSubtitles(segs);
      if (segs.length > 0) {
        setActiveId(segs[0].id);
        setCurrentTime(segs[0].inTime);
      }
    }).catch(console.error);

    let unlisten: (() => void) | undefined;
    onJobUpdated((job) => {
      if (job.id !== jobId) return;
      setJobTitle(job.title ?? job.url);
      setDuration(parseDurationSecs(job.duration));
    }).then((fn) => { unlisten = fn; });

    return () => unlisten?.();
  }, [jobId]);

  // Playback loop (simulated — real video playback comes with Tauri video player)
  useEffect(() => {
    if (!isPlaying || duration === 0) return;
    const id = setInterval(() => {
      setCurrentTime((t) => {
        if (t + 0.1 >= duration) {
          setIsPlaying(false);
          return duration;
        }
        return t + 0.1;
      });
    }, 100);
    return () => clearInterval(id);
  }, [isPlaying, duration]);

  // Track active subtitle as time advances
  useEffect(() => {
    const match = subtitles.find(
      (s) => currentTime >= s.inTime && currentTime <= s.outTime
    );
    const newId = match?.id ?? null;
    if (newId !== activeId) {
      setActiveId(newId);
      if (newId !== null) {
        const row = rowRefs.current[newId];
        if (row && listRef.current) {
          const list = listRef.current;
          const top = row.offsetTop;
          const bottom = top + row.offsetHeight;
          if (top < list.scrollTop || bottom > list.scrollTop + list.clientHeight) {
            list.scrollTo({ top: top - list.clientHeight / 3, behavior: "smooth" });
          }
        }
      }
    }
  }, [currentTime, subtitles, activeId]);

  const handleSeek = useCallback(
    (t: number) => setCurrentTime(Math.max(0, Math.min(t, duration))),
    [duration]
  );

  const handleSkip = useCallback(
    (delta: number) =>
      setCurrentTime((t) => Math.max(0, Math.min(t + delta, duration))),
    [duration]
  );

  const handleActivate = useCallback((seg: SubtitleSegment) => {
    setActiveId(seg.id);
    setCurrentTime(seg.inTime);
    setEditingId(null);
  }, []);

  const handleToggleApprove = useCallback(
    (id: number) => {
      const seg = subtitles.find((s) => s.id === id);
      if (!seg) return;
      const next = !seg.approved;
      setSubtitles((prev) =>
        prev.map((s) => (s.id === id ? { ...s, approved: next } : s))
      );
      approveSubtitle(jobId, id, next).catch(console.error);
    },
    [jobId, subtitles]
  );

  const handleZhChange = useCallback(
    (id: number, text: string) => {
      setSubtitles((prev) =>
        prev.map((s) => (s.id === id ? { ...s, zh: text, approved: false } : s))
      );
      updateSubtitle(jobId, id, text).catch(console.error);
    },
    [jobId]
  );

  const handlePublish = useCallback(async () => {
    if (publishing) return;
    setPublishing(true);
    try {
      const user = await getBiliUser();
      if (!user) {
        router.push("/settings");
        return;
      }
      // Go to publish confirmation page
      router.push(`/publish/${jobId}`);
    } catch (e) {
      console.error(e);
      setPublishing(false);
    }
  }, [jobId, publishing]);

  const activeSub = subtitles.find((s) => s.id === activeId) ?? null;
  const approvedCount = subtitles.filter((s) => s.approved).length;
  const total = subtitles.length;
  const approvalPct = total > 0 ? (approvedCount / total) * 100 : 0;

  return (
    <div className="h-screen flex flex-col bg-surface-base font-sans overflow-hidden">
      <header className="flex-shrink-0 h-10 flex items-center justify-between px-4 border-b border-surface-border bg-surface-base">
        <div className="flex items-center gap-3 min-w-0">
          <a
            href="/"
            className="flex-shrink-0 text-fg-muted hover:text-fg-subtle transition-colors"
            aria-label="Back to queue"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d="M10 3L5 8l5 5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </a>
          <span className="text-surface-border flex-shrink-0 select-none">|</span>
          <span className="text-sm text-fg font-medium truncate">{jobTitle}</span>
          <span className="flex-shrink-0 text-[10px] font-mono text-fg-muted px-1.5 py-0.5 bg-surface-elevated rounded-sm">
            EN → ZH-CN
          </span>
        </div>

        <div className="flex items-center gap-3 flex-shrink-0 ml-4">
          <span className="text-[11px] font-mono tabular-nums text-fg-muted">
            {approvedCount}/{total}
          </span>
          <div className="w-20 h-[3px] bg-surface-border rounded-full overflow-hidden">
            <div
              className="h-full bg-success rounded-full transition-all duration-300"
              style={{ width: `${approvalPct}%` }}
            />
          </div>
          {biliUser ? (
            // Logged in — show avatar + username + publish button
            <div className="flex items-center gap-2">
              {biliUser.avatarUrl && (
                <img
                  src={biliUser.avatarUrl}
                  alt={biliUser.username}
                  className="w-5 h-5 rounded-full object-cover flex-shrink-0"
                />
              )}
              <span className="text-[11px] text-fg-muted truncate max-w-[80px]">
                {biliUser.username}
              </span>
              <button
                onClick={handlePublish}
                disabled={publishing}
                className="px-3 py-1 text-[11px] bg-accent text-surface-base font-semibold rounded-sm hover:bg-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {publishing ? "发布中…" : "发布到B站"}
              </button>
            </div>
          ) : biliUser === null ? (
            // Not logged in
            <a
              href="/settings"
              className="px-3 py-1 text-[11px] border border-surface-border text-fg-muted rounded-sm hover:border-fg-muted hover:text-fg-subtle transition-colors"
            >
              登录B站后发布
            </a>
          ) : null /* loading */}
        </div>
      </header>

      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-shrink-0" style={{ height: "42%" }}>
          <VideoPlayer
            currentTime={currentTime}
            duration={duration}
            isPlaying={isPlaying}
            activeSub={activeSub}
            onPlayPause={() => setIsPlaying((p) => !p)}
            onSeek={handleSeek}
            onSkip={handleSkip}
          />
        </div>

        <div className="flex-1 flex flex-col overflow-hidden border-t border-surface-border">
          <div className="flex-shrink-0 flex items-center gap-2 px-4 py-2 border-b border-surface-border">
            <span className="text-[10px] font-semibold tracking-[0.12em] uppercase text-fg-muted select-none">
              Subtitles
            </span>
            <div className="flex-1" />
            <span className="text-[10px] font-mono text-fg-muted">{total} segs</span>
            <span className="text-surface-border select-none">·</span>
            <span className="text-[10px] text-fg-muted">Double-click to edit</span>
            <span className="text-surface-border select-none">·</span>
            <span className="text-[10px] text-fg-muted">Enter to confirm</span>
          </div>

          <div className="flex-shrink-0 flex items-center border-b border-surface-border bg-surface-raised">
            <div className="flex-shrink-0 w-9 pl-3 py-1.5 text-[9px] tracking-[0.1em] uppercase font-semibold text-fg-muted">#</div>
            <div className="flex-shrink-0 w-[116px] pl-2 py-1.5 text-[9px] tracking-[0.1em] uppercase font-semibold text-fg-muted">Timecode</div>
            <div className="flex-1 pl-3 py-1.5 text-[9px] tracking-[0.1em] uppercase font-semibold text-fg-muted">EN · ZH</div>
            <div className="flex-shrink-0 w-10 py-1.5 text-center text-[9px] tracking-[0.1em] uppercase font-semibold text-fg-muted">✓</div>
          </div>

          {subtitles.length === 0 ? (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-[11px] text-fg-muted">Loading subtitles…</p>
            </div>
          ) : (
            <div ref={listRef} className="flex-1 overflow-y-auto" role="table">
              {subtitles.map((seg) => (
                <div
                  key={seg.id}
                  ref={(el) => { rowRefs.current[seg.id] = el; }}
                >
                  <SubtitleRow
                    seg={seg}
                    isActive={activeId === seg.id}
                    isEditing={editingId === seg.id}
                    onActivate={() => handleActivate(seg)}
                    onStartEdit={() => setEditingId(seg.id)}
                    onExitEdit={() => setEditingId(null)}
                    onToggleApprove={() => handleToggleApprove(seg.id)}
                    onZhChange={(text) => handleZhChange(seg.id, text)}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
      `}</style>
    </div>
  );
}
