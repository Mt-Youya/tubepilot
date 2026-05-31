"use client";

import { useState, useEffect, useRef } from "react";
import {
  type BiliCredentials,
  type AppSettings,
  getBiliUser,
  biliQrcodeGenerate,
  biliQrcodePoll,
  biliLogout,
  getSettings,
  saveSettings,
  selectDownloadDir,
} from "../../lib/tauri-api";

type LoginState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "qr"; qrcodeKey: string; qrSvg: string; hint: string }
  | { phase: "done"; user: BiliCredentials };

export default function SettingsPage() {
  const [loginState, setLoginState] = useState<LoginState>({ phase: "idle" });
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    getSettings().then(setSettings).catch(console.error);
  }, []);

  async function handleSelectDir() {
    const dir = await selectDownloadDir();
    if (!dir || !settings) return;
    const next = { ...settings, downloadDir: dir };
    setSettings(next);
    await saveSettings(next).catch(console.error);
  }

  // Load current user on mount
  useEffect(() => {
    getBiliUser()
      .then((u) => {
        if (u) setLoginState({ phase: "done", user: u });
      })
      .catch(console.error);
  }, []);

  function stopPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  useEffect(() => () => stopPolling(), []);

  async function startLogin() {
    stopPolling();
    setLoginState({ phase: "loading" });
    try {
      const { qrcodeKey, qrSvg } = await biliQrcodeGenerate();
      setLoginState({ phase: "qr", qrcodeKey, qrSvg, hint: "请用B站APP扫描二维码" });
      beginPolling(qrcodeKey, qrSvg);
    } catch (e) {
      setLoginState({ phase: "idle" });
      alert(`生成二维码失败：${e}`);
    }
  }

  function beginPolling(qrcodeKey: string, qrSvg: string) {
    pollRef.current = setInterval(async () => {
      try {
        const result = await biliQrcodePoll(qrcodeKey);
        if (result.status === "scanned") {
          setLoginState({ phase: "qr", qrcodeKey, qrSvg, hint: "扫码成功，请在手机上确认" });
        } else if (result.status === "confirmed" && result.user) {
          stopPolling();
          setLoginState({ phase: "done", user: result.user });
        } else if (result.status === "expired") {
          stopPolling();
          // Auto-refresh
          await startLogin();
        }
      } catch {
        // Ignore transient errors
      }
    }, 2000);
  }

  async function handleLogout() {
    try {
      await biliLogout();
      setLoginState({ phase: "idle" });
    } catch (e) {
      alert(`注销失败：${e}`);
    }
  }

  return (
    <div className="h-screen flex flex-col bg-surface-base font-sans">
      {/* Header */}
      <header className="flex-shrink-0 h-10 flex items-center px-4 border-b border-surface-border bg-surface-base gap-3">
        <a
          href="/"
          className="text-fg-muted hover:text-fg-subtle transition-colors"
          aria-label="返回"
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
        <span className="text-surface-border select-none">|</span>
        <span className="text-sm text-fg font-medium">设置</span>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-8 max-w-xl mx-auto w-full">

        {/* Section: Bilibili Account */}
        <section>
          <h2 className="text-[11px] font-semibold tracking-[0.12em] uppercase text-fg-muted mb-4">
            B站账号
          </h2>

          <div className="bg-surface-raised border border-surface-border rounded-sm p-5">
            {loginState.phase === "done" ? (
              /* Logged in */
              <div className="flex items-center gap-4">
                {loginState.user.avatarUrl ? (
                  <img
                    src={loginState.user.avatarUrl}
                    alt="avatar"
                    className="w-12 h-12 rounded-full object-cover flex-shrink-0"
                  />
                ) : (
                  <div className="w-12 h-12 rounded-full bg-surface-elevated flex items-center justify-center flex-shrink-0">
                    <span className="text-lg text-fg-muted select-none">
                      {loginState.user.username.charAt(0)}
                    </span>
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-fg truncate">
                    {loginState.user.username}
                  </p>
                  <p className="text-xs text-fg-muted mt-0.5">UID {loginState.user.uid}</p>
                </div>
                <button
                  onClick={handleLogout}
                  className="flex-shrink-0 text-xs text-fg-muted hover:text-fg-subtle border border-surface-border hover:border-fg-muted px-3 py-1 rounded-sm transition-colors"
                >
                  退出登录
                </button>
              </div>
            ) : loginState.phase === "loading" ? (
              /* Loading QR */
              <div className="flex items-center justify-center py-10 gap-3">
                <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                <span className="text-sm text-fg-muted">正在生成二维码…</span>
              </div>
            ) : loginState.phase === "qr" ? (
              /* Show QR code */
              <div className="flex flex-col items-center gap-4">
                <div
                  className="w-[200px] h-[200px] bg-white rounded-sm overflow-hidden flex items-center justify-center p-2"
                  dangerouslySetInnerHTML={{ __html: loginState.qrSvg }}
                  style={{ colorScheme: "light" }}
                />
                <p className="text-sm text-fg-muted text-center">{loginState.hint}</p>
                <button
                  onClick={startLogin}
                  className="text-xs text-fg-muted hover:text-fg-subtle underline underline-offset-2 transition-colors"
                >
                  刷新二维码
                </button>
              </div>
            ) : (
              /* Idle */
              <div className="flex flex-col items-center gap-3 py-4">
                <p className="text-sm text-fg-muted text-center">
                  登录B站账号后可一键发布视频
                </p>
                <button
                  onClick={startLogin}
                  className="px-4 py-1.5 text-sm bg-accent text-surface-base font-semibold rounded-sm hover:bg-accent-hover transition-colors"
                >
                  连接B站账号
                </button>
              </div>
            )}
          </div>
        </section>

        {/* Section: Download Location */}
        <section className="mt-8">
          <h2 className="text-[11px] font-semibold tracking-[0.12em] uppercase text-fg-muted mb-4">
            视频下载位置
          </h2>
          <div className="bg-surface-raised border border-surface-border rounded-sm p-4">
            <p className="text-[11px] text-fg-muted mb-3 leading-relaxed">
              视频在任务提交后立即开始下载，完成后发布到B站时无需重新下载。
            </p>
            <div className="flex items-center gap-3">
              <div
                className="flex-1 min-w-0 px-3 py-1.5 bg-surface-elevated border border-surface-border rounded-sm text-[11px] font-mono text-fg-subtle truncate"
                title={settings?.downloadDir}
              >
                {settings?.downloadDir ?? "加载中…"}
              </div>
              <button
                onClick={handleSelectDir}
                disabled={!settings}
                className="flex-shrink-0 px-3 py-1.5 text-xs border border-surface-border text-fg-muted hover:border-fg-muted hover:text-fg-subtle rounded-sm transition-colors disabled:opacity-40"
              >
                选择文件夹
              </button>
            </div>
          </div>
        </section>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        .animate-spin { animation: spin 0.8s linear infinite; }
      `}</style>
    </div>
  );
}
