"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";


import {
  type BiliCredentials,
  getJob,
  getBiliUser,
  startPublishJob,
} from "../../../lib/tauri-api";

const CATEGORIES = [
  { id: 208, name: "科技·计算机技术" },
  { id: 231, name: "科技·软件应用" },
  { id: 188, name: "科技" },
  { id: 201, name: "知识·科学科普" },
  { id: 95,  name: "知识·野生技术协会" },
  { id: 36,  name: "知识" },
  { id: 124, name: "知识·社科·人文" },
  { id: 160, name: "生活·日常" },
  { id: 5,   name: "娱乐·综合" },
  { id: 182, name: "影视·影视杂谈" },
];

export default function PublishPageClient() {
  const params = useParams();
  const router = useRouter();
  const jobId = Array.isArray(params?.id) ? params.id[0] : (params?.id ?? "");

  const [biliUser, setBiliUser]   = useState<BiliCredentials | null>(null);
  const [title, setTitle]         = useState("");
  const [desc, setDesc]           = useState("");
  const [tid, setTid]             = useState(208);
  const [tags, setTags]           = useState("");   // comma-separated
  const [thumbnail, setThumbnail] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading]     = useState(true);

  useEffect(() => {
    if (!jobId) return;
    Promise.all([
      getBiliUser(),
      getJob(jobId),
    ]).then(([user, job]) => {
      setBiliUser(user);
      if (job) {
        setTitle(job.title ?? "");
        setDesc(`来源：${job.url}`);
        setThumbnail(job.thumbnailUrl);
      }
    }).catch(console.error).finally(() => setLoading(false));
  }, [jobId]);

  async function handlePublish() {
    if (submitting) return;
    setSubmitting(true);
    try {
      await startPublishJob(jobId, {
        title,
        desc,
        tid,
        tags: tags.split(",").map(t => t.trim()).filter(Boolean),
      });
      router.push("/");
    } catch (e) {
      alert(`发布失败：${e}`);
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-surface-base">
        <p className="text-sm text-fg-muted">加载中…</p>
      </div>
    );
  }

  if (!biliUser) {
    return (
      <div className="h-screen flex flex-col items-center justify-center gap-4 bg-surface-base">
        <p className="text-sm text-fg-muted">请先登录B站账号</p>
        <a href="/settings" className="px-4 py-1.5 text-sm bg-accent text-surface-base font-semibold rounded-sm hover:bg-accent-hover transition-colors">
          去登录
        </a>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-surface-base font-sans">
      {/* Header */}
      <header className="flex-shrink-0 h-10 flex items-center px-4 border-b border-surface-border bg-surface-base gap-3">
        <a href={`/editor/${jobId}`} className="text-fg-muted hover:text-fg-subtle transition-colors" aria-label="返回">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </a>
        <span className="text-surface-border select-none">|</span>
        <span className="text-sm text-fg font-medium">发布到B站</span>
        <div className="flex-1"/>
        {/* Account indicator */}
        <div className="flex items-center gap-2">
          {biliUser.avatarUrl && (
            <img src={biliUser.avatarUrl} alt={biliUser.username} className="w-5 h-5 rounded-full object-cover"/>
          )}
          <span className="text-[11px] text-fg-muted">{biliUser.username}</span>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-6 py-6 flex flex-col gap-5">

          {/* Cover preview */}
          {thumbnail && (
            <div className="w-full aspect-video bg-surface-elevated rounded-sm overflow-hidden">
              <img src={thumbnail} alt="封面" className="w-full h-full object-cover"/>
            </div>
          )}

          {/* Title */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-semibold tracking-[0.1em] uppercase text-fg-muted">
              标题
            </label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              maxLength={80}
              className="bg-surface-elevated border border-surface-border rounded-sm px-3 py-2 text-sm text-fg outline-none focus:border-accent transition-colors"
            />
            <span className="text-[10px] text-fg-muted text-right">{title.length}/80</span>
          </div>

          {/* Category */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-semibold tracking-[0.1em] uppercase text-fg-muted">
              分区
            </label>
            <div className="relative">
              <select
                value={tid}
                onChange={e => setTid(Number(e.target.value))}
                className="w-full bg-surface-elevated border border-surface-border rounded-sm px-3 py-2 pr-8 text-sm text-fg outline-none focus:border-accent transition-colors appearance-none cursor-pointer"
              >
                {CATEGORIES.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              {/* custom dropdown arrow */}
              <svg className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-fg-muted" width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M2.5 4.5L6 8l3.5-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
          </div>

          {/* Tags */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-semibold tracking-[0.1em] uppercase text-fg-muted">
              标签 <span className="font-normal normal-case tracking-normal">（逗号分隔，最多10个）</span>
            </label>
            <input
              type="text"
              value={tags}
              onChange={e => setTags(e.target.value)}
              placeholder="AI,科技,教程"
              className="bg-surface-elevated border border-surface-border rounded-sm px-3 py-2 text-sm text-fg outline-none focus:border-accent transition-colors placeholder:text-fg-muted"
            />
          </div>

          {/* Description */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-semibold tracking-[0.1em] uppercase text-fg-muted">
              简介
            </label>
            <textarea
              value={desc}
              onChange={e => setDesc(e.target.value)}
              rows={4}
              maxLength={2000}
              className="bg-surface-elevated border border-surface-border rounded-sm px-3 py-2 text-sm text-fg outline-none focus:border-accent transition-colors resize-none"
            />
            <span className="text-[10px] text-fg-muted text-right">{desc.length}/2000</span>
          </div>

          {/* Submit */}
          <button
            onClick={handlePublish}
            disabled={submitting || !title.trim()}
            className="w-full py-2.5 text-sm bg-accent text-surface-base font-semibold rounded-sm hover:bg-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? "提交中，视频下载+上传需要几分钟…" : "确认发布到B站"}
          </button>

          <p className="text-[11px] text-fg-muted text-center">
            视频将以「转载」类型发布，字幕已内嵌在简介中
          </p>
        </div>
      </div>
    </div>
  );
}
