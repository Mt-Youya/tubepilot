"use client";

import { useState, useEffect, useCallback, useMemo, useRef, Fragment } from "react";
import { useRouter } from "next/navigation";
import {
  type Job,
  type JobStatus,
  type PipelineStage,
  getJobs,
  submitJob,
  cancelJob,
  retryJob,
  deleteJob,
  onJobUpdated,
  onJobDeleted,
} from "../lib/tauri-api";
import { useT, useSettings } from "../lib/settings-context";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@tubepilot/ui";

// ── Display helpers ───────────────────────────────────────────────────────────

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  if (h < 48) return "yesterday";
  return `${Math.floor(h / 24)} days ago`;
}

function formatElapsed(secs: number | null): string | undefined {
  if (secs == null) return undefined;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return [
    String(h).padStart(2, "0"),
    String(m).padStart(2, "0"),
    String(s).padStart(2, "0"),
  ].join(":");
}

// ── Date grouping helpers ─────────────────────────────────────────────────────

type DateGroup = "today" | "week" | "month" | "earlier";

function getDateGroup(isoString: string): DateGroup {
  const days = (Date.now() - new Date(isoString).getTime()) / 86_400_000;
  if (days < 1) return "today";
  if (days < 7) return "week";
  if (days < 30) return "month";
  return "earlier";
}

const DATE_GROUP_ORDER: DateGroup[] = ["today", "week", "month", "earlier"];

// ── Highlight helper ──────────────────────────────────────────────────────────

function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-transparent text-accent font-medium not-italic">
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </>
  );
}

// ── Step track ────────────────────────────────────────────────────────────────

const STAGE_PCT: Record<number, number> = { 0: 8, 1: 28, 2: 52, 3: 74, 4: 90 };

function StepTrack({
  stage,
  status,
  statusNote,
  errorNote,
  videoDownloadPct,
}: {
  stage: PipelineStage;
  status: JobStatus;
  statusNote?: string | null;
  errorNote?: string | null;
  videoDownloadPct?: number | null;
}) {
  const t = useT();
  const isDone      = status === "done";
  const isError     = status === "error";
  const isProcessing = status === "processing";
  const pct = isDone ? 100 : (STAGE_PCT[stage] ?? 8);

  return (
    <div className="w-full">
      {/* Node row */}
      <div className="flex items-start">
        {([0, 1, 2, 3, 4] as PipelineStage[]).map((i) => {
          const isComplete  = isDone || i < stage;
          const isCurrent   = !isDone && i === stage;
          const isErrorNode = isError && isCurrent;
          const isFuture    = !isDone && i > stage;

          // Connector after each node except last
          const lineComplete = isDone || i + 1 <= stage;
          const lineCurrent  = i + 1 === stage;

          return (
            <Fragment key={i}>
              {/* Step node */}
              <div className="flex flex-col items-center gap-[5px] flex-shrink-0">
                {/* Circle */}
                <div
                  className={[
                    "w-[18px] h-[18px] rounded-full flex items-center justify-center transition-colors",
                    isComplete
                      ? "bg-success"
                      : isErrorNode
                        ? "bg-error"
                        : isCurrent
                          ? "bg-accent"
                          : "border border-surface-border bg-transparent",
                  ].join(" ")}
                >
                  {isComplete && (
                    <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
                      <path d="M1.5 4.5l2 2 4-4" stroke="white" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                  {isErrorNode && (
                    <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                      <path d="M2 2l4 4M6 2L2 6" stroke="white" strokeWidth="1.4" strokeLinecap="round" />
                    </svg>
                  )}
                  {isCurrent && !isErrorNode && (
                    <span
                      className="block rounded-full bg-white"
                      style={{ width: 6, height: 6, animation: "pulse 1.6s ease-in-out infinite" }}
                    />
                  )}
                </div>

                {/* Label */}
                <span
                  className={[
                    "text-[10px] font-medium leading-none whitespace-nowrap",
                    isComplete ? "text-success" :
                    isErrorNode ? "text-error" :
                    isCurrent ? "text-accent" :
                    "text-fg-muted",
                  ].join(" ")}
                >
                  {t.stages.labels[i]}
                </span>
              </div>

              {/* Connector */}
              {i < 4 && (
                <div className="flex-1 mt-[8px] mx-[3px]">
                  <div
                    className={[
                      "h-[1.5px] w-full rounded-full transition-colors",
                      lineComplete ? "bg-success" :
                      lineCurrent ? "bg-accent" :
                      "bg-surface-border",
                    ].join(" ")}
                  />
                </div>
              )}
            </Fragment>
          );
        })}
      </div>

      {/* Status + progress (only when actively processing) */}
      {isProcessing && (
        <div className="mt-2.5">
          <div className="flex items-baseline justify-between mb-1">
            <span className="text-[11px] text-fg-subtle truncate pr-4">
              {statusNote ?? t.stages.verbs[stage]}
            </span>
            <span className="text-[11px] font-mono tabular-nums text-fg-muted flex-shrink-0">
              {pct}%
            </span>
          </div>
          <div className="h-[3px] w-full rounded-full bg-surface-border overflow-hidden">
            <div
              className="h-full rounded-full bg-accent transition-all duration-700"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}

      {/* Error detail */}
      {isError && errorNote && (
        <p className="mt-1.5 text-[11px] text-error leading-relaxed">{errorNote}</p>
      )}

      {/* Background video download indicator */}
      {videoDownloadPct != null && videoDownloadPct < 100 && !isError && (
        <div className="mt-2 flex items-center gap-2">
          <div className="flex-1 h-[2px] rounded-full bg-surface-border overflow-hidden">
            <div
              className="h-full rounded-full bg-pipe-done transition-all duration-500"
              style={{ width: `${videoDownloadPct}%` }}
            />
          </div>
          <span className="text-[10px] font-mono text-fg-muted tabular-nums flex-shrink-0">
            视频 {videoDownloadPct}%
          </span>
        </div>
      )}
    </div>
  );
}

// ── Thumbnail placeholder ─────────────────────────────────────────────────────

function Thumb({ status }: { status: JobStatus }) {
  return (
    <div
      className="flex-shrink-0 rounded-sm bg-surface-raised relative overflow-hidden"
      style={{ width: 64, height: 36 }}
    >
      <div
        className="absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(0deg, var(--color-fg), var(--color-fg) 1px, transparent 1px, transparent 3px)",
        }}
      />
      {status === "processing" && (
        <span
          className="absolute bottom-1.5 right-1.5 block rounded-full bg-accent"
          style={{ width: 5, height: 5, animation: "pulse 2s ease-out infinite" }}
        />
      )}
    </div>
  );
}

// ── Stage / status label ──────────────────────────────────────────────────────

function StageLabel({
  status,
  stage,
  elapsed,
  addedAt,
  statusNote,
  errorNote,
}: {
  status: JobStatus;
  stage: PipelineStage;
  elapsed?: string;
  addedAt: string;
  statusNote?: string | null;
  errorNote?: string | null;
}) {
  const t = useT();

  if (status === "ready") {
    return (
      <span className="text-xs font-medium text-accent">
        {t.status.readyForReview}
      </span>
    );
  }
  if (status === "error") {
    const truncated = errorNote && errorNote.length > 50;
    const detail = errorNote
      ? (truncated ? errorNote.slice(0, 50) + "…" : errorNote)
      : t.stages.labels[stage].toLowerCase();
    const label = <span className="text-xs text-error cursor-help">{detail}</span>;
    return truncated && errorNote ? (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger render={<span />}>{label}</TooltipTrigger>
          <TooltipContent>{errorNote}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    ) : label;
  }
  if (status === "done") {
    return (
      <span className="text-xs text-fg-muted">
        {t.status.published}{" "}
        <span className="font-mono">&middot; {formatRelativeTime(addedAt)}</span>
      </span>
    );
  }
  return (
    <span className="text-xs text-fg-subtle">
      {statusNote ?? t.stages.verbs[stage]}
      {elapsed && (
        <span className="font-mono text-fg-muted ml-2 tabular-nums">
          {elapsed}
        </span>
      )}
    </span>
  );
}

// ── Action button ─────────────────────────────────────────────────────────────

function JobAction({
  job,
  onCancel,
  onRetry,
  onReview,
}: {
  job: Job;
  onCancel: () => void;
  onRetry: () => void;
  onReview: () => void;
}) {
  const t = useT();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const base =
    "text-[11px] font-medium rounded-sm px-2.5 py-1 transition-all cursor-pointer";

  useEffect(() => {
    if (!confirmCancel) return;
    const timer = setTimeout(() => setConfirmCancel(false), 3000);
    return () => clearTimeout(timer);
  }, [confirmCancel]);

  if (job.status === "ready") {
    return (
      <button
        onClick={(e) => { e.stopPropagation(); onReview(); }}
        className={`${base} bg-accent text-surface-base hover:bg-accent-hover`}
      >
        {t.actions.review}
      </button>
    );
  }
  if (job.status === "processing") {
    return (
      <button
        onClick={(e) => {
          e.stopPropagation();
          if (confirmCancel) { onCancel(); setConfirmCancel(false); }
          else setConfirmCancel(true);
        }}
        className={[
          base,
          confirmCancel
            ? "text-error border border-error"
            : "text-fg-muted hover:text-fg-subtle border border-surface-border hover:border-fg-muted",
        ].join(" ")}
        title={confirmCancel ? t.actions.confirmCancel : undefined}
      >
        {confirmCancel ? t.actions.confirmCancel : t.actions.cancel}
      </button>
    );
  }
  if (job.status === "error") {
    return (
      <button
        onClick={(e) => { e.stopPropagation(); onRetry(); }}
        className={`${base} text-fg-muted hover:text-fg-subtle border border-surface-border hover:border-fg-muted`}
      >
        {t.actions.retry}
      </button>
    );
  }
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onRetry(); }}
      className={`${base} text-fg-muted hover:text-fg-subtle opacity-30 group-hover:opacity-100`}
      title={t.actions.reRun}
    >
      {t.actions.reRun}
    </button>
  );
}

// ── Job row ───────────────────────────────────────────────────────────────────

function JobRow({
  job,
  onCancel,
  onRetry,
  onDelete,
  searchQuery = "",
}: {
  job: Job;
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
  onDelete?: (id: string) => void;
  searchQuery?: string;
}) {
  const t = useT();
  const router = useRouter();
  const isReady = job.status === "ready";

  const handleReview = useCallback(() => {
    router.push(`/editor/${job.id}`);
  }, [job.id, router]);

  return (
    <div
      role="row"
      className={[
        "group border-b border-surface-border cursor-pointer transition-colors",
        "hover:bg-surface-raised",
        isReady ? "bg-surface-raised" : "",
      ].join(" ")}
      onClick={isReady ? handleReview : undefined}
    >
      {/* ── Header row ── */}
      <div className="flex items-start gap-4 pt-2.5 pb-1 px-4">
        <div className="flex-shrink-0 mt-0.5">
          <Thumb status={job.status} />
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm text-fg font-medium truncate leading-snug">
            {highlightMatch(job.title ?? job.url, searchQuery)}
          </p>
          <div className="flex items-center gap-2 mt-0.5">
            {job.channel && (
              <>
                <span className="text-[11px] text-fg-muted truncate max-w-[120px]">
                  {job.channel}
                </span>
                <span className="text-surface-border">·</span>
              </>
            )}
            {job.duration && (
              <span className="text-[11px] font-mono text-fg-muted tabular-nums">
                {job.duration}
              </span>
            )}
            {/* For done/cancelled/ready — show compact status badge */}
            {(job.status === "done" || job.status === "cancelled" || job.status === "ready") && (
              <>
                {job.duration && <span className="text-surface-border">·</span>}
                <StageLabel
                  status={job.status}
                  stage={job.stage}
                  elapsed={formatElapsed(job.elapsedSecs)}
                  addedAt={job.addedAt}
                  statusNote={job.statusNote}
                  errorNote={job.errorNote}
                />
              </>
            )}
          </div>
        </div>

        <div className="flex-shrink-0 flex items-center gap-2 mt-0.5">
          <JobAction
            job={job}
            onCancel={() => onCancel(job.id)}
            onRetry={() => onRetry(job.id)}
            onReview={handleReview}
          />
          {onDelete ? (
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(job.id); }}
              aria-label="删除记录"
              className="text-fg-muted opacity-0 group-hover:opacity-60 hover:!opacity-100 hover:text-error transition-opacity"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M2 2l8 8M10 2L2 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          ) : (
            <div className="text-fg-muted opacity-20 group-hover:opacity-60 transition-opacity" aria-hidden>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          )}
        </div>
      </div>

      {/* ── Step track ── */}
      <div className="px-4 pb-3" style={{ paddingLeft: "calc(1rem + 64px + 1rem)" }}>
        <StepTrack
          stage={job.stage}
          status={job.status}
          statusNote={job.statusNote}
          errorNote={job.errorNote}
          videoDownloadPct={job.videoDownloadPct}
        />
      </div>
    </div>
  );
}

// ── Section header ────────────────────────────────────────────────────────────

function SectionHeader({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-center gap-3 px-4 mb-0.5">
      <span className="text-[10px] font-semibold tracking-[0.12em] uppercase text-fg-muted select-none">
        {label}
      </span>
      <div className="flex-1 h-px bg-surface-border" />
      <span className="text-[10px] font-mono text-fg-muted">{count}</span>
    </div>
  );
}

// ── Filter dropdown ───────────────────────────────────────────────────────────

function FilterDropdown({
  value,
  options,
  onChange,
}: {
  value: string;
  options: { label: string; value: string }[];
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  const selected = options.find((o) => o.value === value);
  const isDefault = value === options[0]?.value;

  return (
    <div ref={ref} className="relative flex-shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className={[
          "flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-sm border transition-colors",
          isDefault
            ? "border-surface-border text-fg-muted hover:text-fg-subtle hover:border-fg-muted"
            : "border-accent text-accent",
        ].join(" ")}
      >
        {selected?.label}
        <svg
          width="8"
          height="8"
          viewBox="0 0 8 8"
          fill="none"
          className={`transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden
        >
          <path
            d="M1 2.5l3 3 3-3"
            stroke="currentColor"
            strokeWidth="1.25"
            strokeLinecap="round"
          />
        </svg>
      </button>
      {open && (
        <div className="absolute top-full mt-1 left-0 z-20 bg-surface-elevated border border-surface-border rounded-sm overflow-hidden min-w-[120px]">
          {options.map((opt) => (
            <button
              key={opt.value}
              onClick={() => { onChange(opt.value); setOpen(false); }}
              className={[
                "w-full text-left px-3 py-1.5 text-[11px] transition-colors hover:bg-surface-raised",
                value === opt.value ? "text-accent" : "text-fg-subtle",
              ].join(" ")}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── History section ───────────────────────────────────────────────────────────

type HistoryStatusFilter = "all" | "done" | "error" | "cancelled";
type HistoryDateFilter = "all" | "today" | "week" | "month";

interface HistoryFilters {
  status: HistoryStatusFilter;
  date: HistoryDateFilter;
  channel: string;
  search: string;
}

const DEFAULT_FILTERS: HistoryFilters = {
  status: "all",
  date: "all",
  channel: "",
  search: "",
};

function HistorySection({
  history,
  onCancel,
  onRetry,
  onDelete,
  onRetryAll,
}: {
  history: Job[];
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
  onDelete: (id: string) => void;
  onRetryAll: () => void;
}) {
  const t = useT();
  const [filters, setFilters] = useState<HistoryFilters>(DEFAULT_FILTERS);

  const statusOptions = useMemo(
    () => [
      { label: t.filter.allStatus, value: "all" },
      { label: t.filter.done, value: "done" },
      { label: t.filter.error, value: "error" },
      { label: t.filter.cancelled, value: "cancelled" },
    ],
    [t]
  );

  const dateOptions = useMemo(
    () => [
      { label: t.filter.allTime, value: "all" },
      { label: t.filter.today, value: "today" },
      { label: t.filter.thisWeek, value: "week" },
      { label: t.filter.thisMonth, value: "month" },
    ],
    [t]
  );

  const channels = useMemo(() => {
    const seen = new Set<string>();
    for (const j of history) if (j.channel) seen.add(j.channel);
    return Array.from(seen).sort();
  }, [history]);

  const channelOptions = useMemo(
    () => [
      { label: t.filter.allChannels, value: "" },
      ...channels.map((c) => ({ label: c, value: c })),
    ],
    [t, channels]
  );

  const filtered = useMemo(() => {
    return history.filter((job) => {
      if (filters.status !== "all" && job.status !== filters.status) return false;
      if (filters.channel && job.channel !== filters.channel) return false;
      if (filters.date !== "all") {
        const g = getDateGroup(job.addedAt);
        if (filters.date === "today" && g !== "today") return false;
        if (filters.date === "week" && g !== "today" && g !== "week") return false;
        if (filters.date === "month" && g === "earlier") return false;
      }
      if (filters.search.trim()) {
        const q = filters.search.toLowerCase();
        return (
          (job.title ?? job.url).toLowerCase().includes(q) ||
          (job.channel ?? "").toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [history, filters]);

  const grouped = useMemo(() => {
    const g: Partial<Record<DateGroup, Job[]>> = {};
    for (const job of filtered) {
      const key = getDateGroup(job.addedAt);
      if (!g[key]) g[key] = [];
      g[key]!.push(job);
    }
    return g;
  }, [filtered]);

  const hasActiveFilters =
    filters.status !== "all" ||
    filters.date !== "all" ||
    filters.channel !== "" ||
    filters.search !== "";

  type Chip = { label: string; clear: () => void };
  const activeChips: Chip[] = [];
  if (filters.status !== "all")
    activeChips.push({
      label: statusOptions.find((o) => o.value === filters.status)?.label ?? filters.status,
      clear: () => setFilters((f) => ({ ...f, status: "all" })),
    });
  if (filters.date !== "all")
    activeChips.push({
      label:
        filters.date === "today"
          ? t.filter.chipToday
          : filters.date === "week"
            ? t.filter.chipThisWeek
            : t.filter.chipThisMonth,
      clear: () => setFilters((f) => ({ ...f, date: "all" })),
    });
  if (filters.channel)
    activeChips.push({
      label: filters.channel,
      clear: () => setFilters((f) => ({ ...f, channel: "" })),
    });

  const errorCount = history.filter((j) => j.status === "error").length;

  const groupLabel: Record<DateGroup, string> = {
    today: t.dateGroups.today,
    week: t.dateGroups.week,
    month: t.dateGroups.month,
    earlier: t.dateGroups.earlier,
  };

  return (
    <section aria-label={t.sections.history}>
      <div className="flex items-center gap-3 px-4 mb-2">
        <span className="text-[10px] font-semibold tracking-[0.12em] uppercase text-fg-muted select-none">
          {t.sections.history}
        </span>
        <div className="flex-1 h-px bg-surface-border" />
        <span className="text-[10px] font-mono text-fg-muted">{history.length}</span>
      </div>

      <div className="border border-surface-border rounded-sm">
        {/* Filter bar */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-surface-border bg-surface-raised">
          <FilterDropdown
            value={filters.status}
            options={statusOptions}
            onChange={(v) =>
              setFilters((f) => ({ ...f, status: v as HistoryStatusFilter }))
            }
          />
          <FilterDropdown
            value={filters.date}
            options={dateOptions}
            onChange={(v) =>
              setFilters((f) => ({ ...f, date: v as HistoryDateFilter }))
            }
          />
          <FilterDropdown
            value={filters.channel}
            options={channelOptions}
            onChange={(v) => setFilters((f) => ({ ...f, channel: v }))}
          />

          {/* Search */}
          <div className="flex-1 flex items-center gap-1.5 bg-surface-elevated rounded-sm px-2 py-1">
            <svg
              width="11"
              height="11"
              viewBox="0 0 11 11"
              fill="none"
              className="text-fg-muted flex-shrink-0"
              aria-hidden
            >
              <circle cx="4.5" cy="4.5" r="3" stroke="currentColor" strokeWidth="1.2" />
              <path d="M7 7l2 2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
            <input
              type="text"
              value={filters.search}
              onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
              placeholder={t.filter.searchPlaceholder}
              aria-label={t.filter.searchPlaceholder}
              className="flex-1 bg-transparent text-[11px] text-fg placeholder:text-fg-muted outline-none font-sans min-w-0"
            />
            {filters.search && (
              <button
                onClick={() => setFilters((f) => ({ ...f, search: "" }))}
                className="text-fg-muted hover:text-fg-subtle transition-colors flex-shrink-0"
                aria-label={t.filter.clearSearch}
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
                  <path
                    d="M2 2l6 6M8 2L2 8"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            )}
          </div>

          {filters.status === "error" && errorCount > 0 && (
            <button
              onClick={onRetryAll}
              className="flex-shrink-0 text-[11px] font-medium text-accent hover:text-accent-hover transition-colors"
            >
              {t.actions.retryAll}
            </button>
          )}
        </div>

        {/* Active filter chips */}
        {activeChips.length > 0 && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-surface-border bg-surface-base flex-wrap">
            {activeChips.map((chip) => (
              <span
                key={chip.label}
                className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] text-fg-subtle border border-surface-border rounded-full"
              >
                {chip.label}
                <button
                  onClick={chip.clear}
                  className="text-fg-muted hover:text-fg-subtle transition-colors"
                  aria-label={t.filter.removeFilter(chip.label)}
                >
                  <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden>
                    <path
                      d="M1.5 1.5l5 5M6.5 1.5l-5 5"
                      stroke="currentColor"
                      strokeWidth="1.25"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              </span>
            ))}
            <button
              onClick={() => setFilters(DEFAULT_FILTERS)}
              className="text-[11px] text-fg-muted hover:text-fg-subtle transition-colors ml-0.5"
            >
              {t.filter.clearAll}
            </button>
          </div>
        )}

        {/* Content */}
        {filtered.length === 0 ? (
          <p className="px-4 py-6 text-[11px] text-fg-muted text-center">
            {hasActiveFilters ? (
              <>
                {t.empty.noMatch}{" "}
                <button
                  onClick={() => setFilters(DEFAULT_FILTERS)}
                  className="text-accent hover:text-accent-hover transition-colors"
                >
                  {t.empty.clearFilters}
                </button>
              </>
            ) : (
              t.empty.noHistory
            )}
          </p>
        ) : (
          <div role="table" className="max-h-[72vh] overflow-y-auto">
            {DATE_GROUP_ORDER.filter((g) => grouped[g]?.length).map((group) => (
              <div key={group}>
                <div className="sticky top-0 z-10 flex items-center gap-2 px-4 py-1.5 bg-surface-base border-b border-surface-border">
                  <span className="text-[10px] font-semibold tracking-[0.1em] font-mono text-fg-muted select-none">
                    {groupLabel[group]}
                  </span>
                  <div className="flex-1 h-px bg-surface-border" />
                  <span className="text-[10px] font-mono text-fg-muted">
                    {grouped[group]!.length}
                  </span>
                </div>
                {grouped[group]!.map((job) => (
                  <JobRow
                    key={job.id}
                    job={job}
                    onCancel={onCancel}
                    onRetry={onRetry}
                    onDelete={onDelete}
                    searchQuery={filters.search}
                  />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

// ── URL input ─────────────────────────────────────────────────────────────────

function UrlInputBar({ onSubmit }: { onSubmit: (url: string) => Promise<void> }) {
  const t = useT();
  const [url, setUrl] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const isYouTube = (v: string) =>
    v.includes("youtube.com/watch") || v.includes("youtu.be/");

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setUrl(val);
    setExpanded(isYouTube(val));
  };

  const handleClear = () => {
    setUrl("");
    setExpanded(false);
  };

  const handleStart = async () => {
    if (!url || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit(url);
      setUrl("");
      setExpanded(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="rounded-sm border border-surface-border overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-2.5 bg-surface-elevated">
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          className="text-fg-muted flex-shrink-0"
          aria-hidden
        >
          <path
            d="M5.5 8.5L8.5 5.5M6 3.5 7.5 2a2.121 2.121 0 0 1 3 3L9 6.5M8 10.5 6.5 12a2.121 2.121 0 0 1-3-3L5 7.5"
            stroke="currentColor"
            strokeWidth="1.25"
            strokeLinecap="round"
          />
        </svg>

        <input
          type="url"
          value={url}
          onChange={handleChange}
          onKeyDown={(e) => { if (e.key === "Enter" && expanded) handleStart(); }}
          placeholder={t.urlInput.placeholder}
          aria-label={t.urlInput.placeholder}
          className="flex-1 bg-transparent text-sm text-fg placeholder:text-fg-muted outline-none font-sans"
          style={{ caretColor: "var(--color-accent)" }}
          spellCheck={false}
        />

        {url ? (
          <button
            onClick={handleClear}
            aria-label={t.urlInput.clearUrl}
            className="text-fg-muted hover:text-fg-subtle transition-colors p-0.5"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
              <path
                d="M2 2l8 8M10 2L2 10"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        ) : (
          <kbd
            className="text-[10px] text-fg-muted border border-surface-border rounded px-1 py-0.5 font-mono select-none"
            aria-label="⌘V"
          >
            ⌘V
          </kbd>
        )}
      </div>

      {expanded && (
        <div className="border-t border-surface-border bg-surface-raised px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-[11px] text-fg-muted">
              <span className="font-mono">EN</span>
              <span className="text-surface-border">→</span>
              <span className="font-mono">ZH-CN</span>
              <span className="text-surface-border mx-1">·</span>
              <span>{t.urlInput.model}</span>
            </div>
            <button
              onClick={handleStart}
              disabled={submitting}
              className="px-4 py-1.5 text-[11px] bg-accent text-surface-base font-semibold rounded-sm hover:bg-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? t.urlInput.starting : t.urlInput.startProcessing}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Header ────────────────────────────────────────────────────────────────────

function Header({ activeCount }: { activeCount: number }) {
  const t = useT();
  const { lang, theme, toggleLang, toggleTheme } = useSettings();

  return (
    <header className="h-10 flex items-center justify-between px-6 border-b border-surface-border bg-surface-base">
      <div className="flex items-center gap-2">
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden
          className="text-accent"
        >
          <path
            d="M8 1L14.928 5v6L8 15 1.072 11V5L8 1z"
            stroke="currentColor"
            strokeWidth="1.25"
            fill="none"
          />
          <path
            d="M5.5 6.5l2.5 3 2.5-3"
            stroke="currentColor"
            strokeWidth="1.25"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="text-sm font-semibold text-fg tracking-tight">
          TubePilot
        </span>
      </div>

      <div className="flex items-center gap-3">
        {/* Active indicator */}
        {activeCount > 0 && (
          <div className="flex items-center gap-2">
            <span
              className="inline-block rounded-full bg-success"
              style={{ width: 6, height: 6 }}
              aria-hidden
            />
            <span className="text-[11px] text-fg-muted font-mono">
              {t.header.active(activeCount)}
            </span>
          </div>
        )}

        <div className="flex items-center gap-1 ml-1">
          {/* Language toggle */}
          <button
            onClick={toggleLang}
            aria-label={lang === "en" ? t.aria.switchToChinese : t.aria.switchToEnglish}
            className="flex items-center justify-center w-7 h-7 rounded-sm text-fg-muted hover:text-fg-subtle hover:bg-surface-raised transition-colors"
          >
            <span className="text-[11px] font-mono font-medium leading-none">
              {lang === "en" ? "EN" : "中"}
            </span>
          </button>

          {/* Settings */}
          <a
            href="/settings"
            aria-label="设置"
            className="flex items-center justify-center w-7 h-7 rounded-sm text-fg-muted hover:text-fg-subtle hover:bg-surface-raised transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
              {/* Gear / cog icon */}
              <path
                d="M6 1h2l.3 1.5a4.5 4.5 0 0 1 1.4.8l1.4-.5 1 1.7-1.1 1.1c.1.3.1.6.1.9s0 .6-.1.9L12.1 8.4l-1 1.7-1.4-.5a4.5 4.5 0 0 1-1.4.8L8 12H6l-.3-1.6a4.5 4.5 0 0 1-1.4-.8l-1.4.5-1-1.7 1.1-1.1A4.5 4.5 0 0 1 2.9 7c0-.3 0-.6.1-.9L1.9 5 2.9 3.3l1.4.5a4.5 4.5 0 0 1 1.4-.8L6 1z"
                stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round"
              />
              <circle cx="7" cy="7" r="1.8" stroke="currentColor" strokeWidth="1.1"/>
            </svg>
          </a>

          {/* Theme toggle */}
          <button
            onClick={toggleTheme}
            aria-label={theme === "dark" ? t.aria.switchToLight : t.aria.switchToDark}
            className="flex items-center justify-center w-7 h-7 rounded-sm text-fg-muted hover:text-fg-subtle hover:bg-surface-raised transition-colors"
          >
            <span key={theme} className="theme-icon-enter block">
              {theme === "dark" ? (
                // Moon — currently dark, click to go light
                <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
                  <path
                    d="M11 8A5.5 5.5 0 0 1 5 2a5.5 5.5 0 1 0 6 6z"
                    fill="currentColor"
                  />
                </svg>
              ) : (
                // Sun — currently light, click to go dark
                <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
                  <circle cx="6.5" cy="6.5" r="2.3" fill="currentColor" />
                  <path
                    d="M6.5 1v1.4M6.5 10.6V12M1 6.5h1.4M10.6 6.5H12M2.9 2.9l1 1M9.1 9.1l1 1M9.1 3.9l1-1M2.9 10.1l1-1"
                    stroke="currentColor"
                    strokeWidth="1.2"
                    strokeLinecap="round"
                  />
                </svg>
              )}
            </span>
          </button>
        </div>
      </div>
    </header>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const t = useT();
  const [jobs, setJobs] = useState<Job[]>([]);

  useEffect(() => {
    getJobs().then(setJobs).catch(console.error);

    let unlistenUpdated: (() => void) | undefined;
    let unlistenDeleted: (() => void) | undefined;

    onJobUpdated((updated) => {
      setJobs((prev) => {
        const idx = prev.findIndex((j) => j.id === updated.id);
        if (idx === -1) return [updated, ...prev];
        const next = [...prev];
        next[idx] = updated;
        return next;
      });
    }).then((fn) => { unlistenUpdated = fn; });

    onJobDeleted((id) => {
      setJobs((prev) => prev.filter((j) => j.id !== id));
    }).then((fn) => { unlistenDeleted = fn; });

    return () => { unlistenUpdated?.(); unlistenDeleted?.(); };
  }, []);

  const active = jobs.filter(
    (j) => j.status === "processing" || j.status === "ready"
  );
  const history = jobs.filter(
    (j) => j.status === "done" || j.status === "error" || j.status === "cancelled"
  );

  const handleSubmit = useCallback(async (url: string) => {
    await submitJob(url);
  }, []);

  const handleCancel = useCallback((id: string) => {
    cancelJob(id).catch(console.error);
  }, []);

  const handleRetry = useCallback((id: string) => {
    retryJob(id).catch(console.error);
  }, []);

  const handleDelete = useCallback((id: string) => {
    deleteJob(id).catch(console.error);
  }, []);

  const handleRetryAll = useCallback(() => {
    history
      .filter((j) => j.status === "error")
      .forEach((j) => retryJob(j.id).catch(console.error));
  }, [history]);

  return (
    <div className="min-h-screen bg-surface-base font-sans">
      <Header activeCount={active.length} />

      <main className="max-w-[1080px] mx-auto px-6 py-8">
        <div className="mb-10">
          <UrlInputBar onSubmit={handleSubmit} />
        </div>

        {active.length === 0 && history.length === 0 && (
          <div className="mt-2 mb-10 flex items-start gap-6">
            {t.onboarding.map(({ label, desc }, i) => (
              <div key={i} className="flex-1 min-w-0">
                <div className="text-[10px] font-mono text-fg-muted mb-1.5 select-none">
                  {i + 1}
                </div>
                <p className="text-sm font-medium text-fg-subtle leading-snug mb-1">
                  {label}
                </p>
                <p className="text-[11px] text-fg-muted leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        )}

        {active.length > 0 && (
          <section className="mb-8" aria-label={t.sections.inProgress}>
            <SectionHeader label={t.sections.inProgress} count={active.length} />
            <div
              role="table"
              className="border border-surface-border rounded-sm overflow-hidden"
            >
              {active.map((job) => (
                <JobRow
                  key={job.id}
                  job={job}
                  onCancel={handleCancel}
                  onRetry={handleRetry}
                />
              ))}
            </div>
          </section>
        )}

        <HistorySection
          history={history}
          onCancel={handleCancel}
          onRetry={handleRetry}
          onDelete={handleDelete}
          onRetryAll={handleRetryAll}
        />
      </main>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}
