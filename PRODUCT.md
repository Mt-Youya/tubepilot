# Product

## Register

product

## Users

技术熟练的中文内容创作者和字幕译者，主要将 YouTube 内容搬运至 Bilibili 等中文平台。他们每周定期处理多个视频，熟悉 yt-dlp、ffmpeg 等工具，对低效的手动字幕同步和重复上传流程深感不满。工作场景以桌面为主，显示器通常较大，喜欢高密度信息展示，不需要手把手引导。

## Product Purpose

从 YouTube URL 到双语字幕发布的自动化流水线：抓取视频与元数据、Whisper 转录英文、LLM 翻译为中文、时间轴字幕编辑器人工校对、一键发布至 Bilibili。让每周浪费在手动字幕同步和分平台上传上的数小时变成几次点击。

## Brand Personality

克制、精准、专注。像工具应有的样子，而不是想被注意到的样子。

视觉参考：Raycast、Linear、Zed editor。专业工具美学，高密度，对专家友好，零多余装饰。

## Anti-references

- 消费类 App 渐变配色和玻璃拟态卡片
- 企业仪表盘过度装饰（大量图标、彩色 badge、全局阴影）
- 通用 shadcn 起步模板的默认视觉——白底、圆润、无个性
- SaaS 登陆页的英雄大数字 + 渐变 accent 模板
- 任何让界面看起来像在卖东西而不是在做事情的设计

## Design Principles

1. **流水线可见性优先**：用户在任何时刻都应知道任务在哪一步、进度如何、是否需要介入。状态不该靠刷新去发现。

2. **密度是礼貌**：对于熟练用户，空白不等于高级。每个屏幕应该承载足够的信息密度，让用户无需频繁翻页或展开。

3. **技术值值得认真对待**：时间码、文件路径、模型名称等技术信息用等宽字体精确呈现，绝不用截断或模糊处理来"简化"界面。

4. **零仪式感**：没有欢迎屏幕，没有引导 tour，没有空状态插图。打开即工作，直接进入任务。

5. **界面退后，内容前进**：视频、字幕、元数据才是主角。UI 是背景板，不是舞台。

## Accessibility & Inclusion

WCAG AA 级别。优先保障键盘可操作性（字幕编辑器的时间轴操作尤为重要）和足够的前景/背景对比度。深色主题下注意避免对比度不足。减少动效模式（prefers-reduced-motion）应有对应响应。


## What is this product?
TubePilot is a desktop + web tool that automates the full pipeline
from YouTube video acquisition to multi-platform publishing.

Core pipeline:
1. Fetch video + metadata from YouTube (yt-dlp)
2. Auto-generate bilingual subtitles (English + Simplified Chinese)
   via Whisper / AI transcription
3. Edit subtitles in a built-in timeline editor
4. Publish to target platforms (Bilibili, etc.) with one click

## Surface type
Product surface — design serves the workflow, not the brand.
This is a power tool, not a marketing site.

## Who is this for?
Chinese content creators and translators who regularly repurpose
YouTube content for Bilibili. They are technically comfortable,
work on desktop, and value speed and batch processing over
visual flair. They lose time to manual subtitle sync and
platform-specific upload flows.

## Tech stack (for AI context)
- Framework: Next.js 15 (App Router) + Tauri v2 (desktop shell)
- Monorepo: pnpm workspaces + Turborepo
- Language: TypeScript (strict)
- UI: shadcn/ui built on Base UI primitives, Tailwind CSS v4
- Backend: Node.js / Python bridge for yt-dlp + Whisper
- State: Zustand / TanStack Query

## Brand voice
Precise · Automated · Understated

## Visual references
- Raycast (command-driven, keyboard-first)
- Linear (dense information, confident typography)
- Whisper Web UI (functional, no decoration)

## Anti-references
- Colorful consumer apps (TikTok-style gradients)
- Enterprise dashboards (bloated sidebars, too many panels)
- Generic shadcn starter templates without personality