# TubePilot ✈️

> YouTube → Bilibili 全自动内容搬运流水线：抓取 · 字幕 · 翻译 · 审校 · 发布

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![pnpm](https://img.shields.io/badge/pnpm-monorepo-orange)](https://pnpm.io)
[![Tauri](https://img.shields.io/badge/Tauri-v2-purple)](https://tauri.app)
[![Rust](https://img.shields.io/badge/Rust-1.77+-orange)](https://www.rust-lang.org)

---

## 简介

TubePilot 是面向中文内容创作者的桌面工具，输入一条 YouTube 链接，自动完成：

1. **抓取** — yt-dlp 获取视频元数据 + 封面
2. **字幕** — 优先拉取 YouTube 自动翻译的中文字幕；没有则下载英文字幕
3. **翻译** — 英文字幕 → 中文（Tencent TMT / Bing Translate，Rust 原生调用）
4. **视频下载** — 流水线启动后立即在后台并行下载（4 线程，不阻塞字幕步骤）
5. **审校** — 内置双语字幕编辑器，逐句确认
6. **发布** — 扫码登录 B 站，自动翻译标题/简介，一键投稿

---

## 功能现状

### 已实现

| 功能 | 说明 |
|------|------|
| YouTube 元数据抓取 | yt-dlp，自动读取系统浏览器 Cookie（Safari / Firefox / Chrome）|
| 中文字幕优先获取 | YouTube timedtext API 直接拉取 zh-Hans，节省翻译成本 |
| 英文字幕回退 | yt-dlp 下载 en 字幕；均无时 Whisper 语音转录 |
| 翻译（Rust 原生） | Tencent TMT（TC3-HMAC-SHA256 签名） / Bing Translate，并发执行，4 req/s 限速 |
| 后台并行视频下载 | 抓取元数据后立即开始，yt-dlp 4 线程，不阻塞字幕流程 |
| 自定义下载位置 | 设置页选择文件夹，下次发布直接复用，无需重复下载 |
| 双语字幕编辑器 | 英/中对照，双击逐句编辑，勾选确认，进度条显示审校比例 |
| B 站 QR 扫码登录 | 调 B 站标准扫码 API，凭证持久化到本地，重启自动恢复 |
| 发布确认页 | 预填标题/分区/标签/简介，标题/简介非中文自动翻译 |
| B 站投稿 | biliup，转载类型，封面自动上传，4-核 UA 修复 412 拦截 |
| 实时进度展示 | 5 步节点追踪器（步骤图标 + 连接线 + 百分比进度条）|
| 错误提示 | 每步独立错误信息，截断文字 hover tooltip（Base UI）|
| 历史记录管理 | 筛选/搜索/删除，状态标签 |

### 计划中

- [ ] 批量队列（无人值守处理多个视频）
- [ ] 字幕时间轴可视化编辑
- [ ] 自定义翻译词汇表
- [ ] 本地 Whisper.cpp（离线转录）
- [ ] Douyin / 小红书发布适配

---

## 技术架构

### 职责分工

```
┌─────────────────────────────────────────────────────────┐
│  Rust / Tauri v2 (src-tauri)                            │
│  • Job 状态机 & 事件推送 (job:updated)                  │
│  • 翻译：Tencent TMT + Bing（reqwest，TC3 签名）        │
│  • B 站 QR 登录 & 凭证存储（reqwest）                  │
│  • 设置持久化（download_dir 等）                        │
│  • 后台视频下载任务调度（tokio::spawn）                  │
│  • 发布确认 → 传递给 Python sidecar                     │
└──────────────┬──────────────────────────────────────────┘
               │ tokio::process::Command (stdout 流式 JSON)
               ▼
┌─────────────────────────────────────────────────────────┐
│  Python sidecar (sidecar/main.py)                       │
│  • fetch-metadata  — yt-dlp 获取视频信息                │
│  • transcribe      — yt-dlp 下载字幕 / Whisper 回退     │
│  • download        — yt-dlp 下载视频（4 线程）           │
│  • publish         — biliup 上传到 B 站                 │
└─────────────────────────────────────────────────────────┘
```

> **设计原则**：Python sidecar 只做 Rust 无法替代的事（yt-dlp、Whisper、biliup 均为 Python 专属库）。翻译等纯 HTTP 调用全部在 Rust 中原生实现。

### 流水线时序

```
输入 YouTube URL
       │
       ▼
  [FETCH] yt-dlp 获取元数据 (~2s)
       │
       ├──────────────────────────────────┐
       │                                  │ tokio::spawn (后台)
       ▼                                  ▼
  [TRANSCRIBE] 获取字幕                [DOWNLOAD] yt-dlp 下载视频
  优先 zh-Hans → 回退 en → Whisper    4 线程，与字幕步骤并行
       │
       ▼ (zh 不可用时)
  [TRANSLATE] Rust 原生翻译
  Tencent / Bing，并发批量
       │
       ▼
  [REVIEW] 用户审校字幕编辑器
       │
       ▼
  [PUBLISH] 发布确认 → biliup 上传
  （视频已下载完毕，跳过重复下载）
       │
       ▼
   B 站投稿成功 ✅
```

### 项目结构

```
tubepilot/
├── apps/
│   ├── web/                        # Next.js 15 前端
│   │   ├── app/
│   │   │   ├── page.tsx            # 主面板（任务队列 + 历史）
│   │   │   ├── editor/[id]/        # 双语字幕编辑器
│   │   │   ├── publish/[id]/       # 发布确认页
│   │   │   └── settings/           # 设置（B 站登录 + 下载位置）
│   │   └── lib/
│   │       ├── tauri-api.ts        # Rust 命令桥接层（类型安全）
│   │       └── settings-context.tsx # 主题 / 语言
│   │
│   └── desktop/
│       └── src-tauri/
│           ├── src/lib.rs          # Rust 后端核心
│           └── sidecar/main.py     # Python sidecar
│
└── packages/
    └── ui/                         # 共享组件库
        ├── src/components/
        │   └── tooltip.tsx         # Base UI Tooltip
        ├── src/lib/utils.ts        # cn() 工具函数
        └── components.json         # shadcn 配置
```

---

## 快速开始

### 环境要求

```
Node.js  >= 20
pnpm     >= 9
Python   >= 3.11
Rust     >= 1.77
ffmpeg   (in PATH，视频合流需要)
```

### 安装 Python 依赖

```bash
pip install yt-dlp biliup openai-whisper  # whisper 仅 Whisper 回退时需要
```

### 配置翻译服务

在项目根目录创建 `.env.local`：

```bash
# 二选一，优先使用腾讯翻译（国内效果更好）
TENCENT_SECRET_ID=your_secret_id
TENCENT_SECRET_KEY=your_secret_key

# 或 Bing
BING_TRANSLATE_KEY=your_bing_key

# 可选：指定 YouTube Cookie 来源（auto / safari / firefox / chrome / none）
YTDLP_COOKIES_BROWSER=auto
```

> `.env.local` 已在 `.gitignore` 中，不会提交到仓库。

### 开发

```bash
pnpm install
pnpm dev:desktop    # 启动 Tauri 桌面应用（同时启动 Next.js dev server）
```

### 构建

```bash
pnpm --filter @tubepilot/desktop tauri build   # 打包桌面安装包
```

---

## Rust 命令一览

| 命令 | 说明 |
|------|------|
| `submit_job(url)` | 提交任务，启动流水线 |
| `get_jobs()` | 获取所有任务列表 |
| `cancel_job(id)` | 取消处理中的任务 |
| `retry_job(id)` | 重试失败的任务 |
| `delete_job(id)` | 删除历史记录 |
| `get_subtitles(jobId)` | 获取字幕段落 |
| `update_subtitle(...)` | 更新单条字幕中文 |
| `approve_subtitle(...)` | 标记字幕已确认 |
| `start_publish_job(...)` | 开始发布流程 |
| `get_bilibili_user()` | 获取已登录的 B 站账号 |
| `bilibili_qrcode_generate()` | 生成扫码登录二维码（SVG）|
| `bilibili_qrcode_poll(key)` | 轮询扫码状态 |
| `bilibili_logout()` | 退出 B 站登录 |
| `get_settings()` | 获取应用设置 |
| `save_settings(...)` | 保存应用设置 |
| `select_download_dir()` | 打开系统文件夹选择对话框 |

---

## Python Sidecar 命令

| 命令 | 说明 |
|------|------|
| `fetch-metadata <url>` | yt-dlp 获取视频标题/频道/时长/封面 |
| `transcribe <job_id> <url>` | yt-dlp 下载字幕（zh-Hans → en → Whisper）|
| `download <job_id> <url> <dir>` | yt-dlp 下载视频，4 线程，实时进度 |
| `publish <job_id> <meta_file>` | biliup 上传到 B 站 |

> `translate` 命令已从 Python sidecar 移除，翻译由 Rust 原生实现。

---

## License

MIT © TubePilot Contributors
