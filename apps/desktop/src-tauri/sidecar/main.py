#!/usr/bin/env python3
"""
TubePilot pipeline sidecar.

Usage:
  python3 main.py fetch-metadata <youtube_url>
  python3 main.py transcribe <job_id> <youtube_url>
  python3 main.py translate <job_id> <segments_json>

Subtitle strategy (transcribe):
  1. Try YouTube auto-translated zh-Hans captions  → zh_available=true
  2. Try YouTube en captions (manual > auto-gen)   → zh_available=false
  3. Fallback: Whisper transcription               → zh_available=false

Translation provider (translate, only when zh_available=false):
  TRANSLATE_PROVIDER=bing (default) → BING_TRANSLATE_KEY=<key>
  TRANSLATE_PROVIDER=tencent        → TENCENT_SECRET_ID + TENCENT_SECRET_KEY

Dependencies:
  pip install yt-dlp requests
  pip install openai-whisper          # only for Whisper fallback
  pip install tencentcloud-sdk-python-tmt  # only for Tencent
"""

from __future__ import annotations

import re
import sys
import json
import os
import tempfile
import threading
import time
from pathlib import Path

# ── Global rate limiter for Tencent API (max 4 req/s) ────────────────────────
# Simple approach: semaphore of 4 + each slot locked for 1 second
# guarantees at most 4 concurrent requests at any time,
# and each slot can only be reused after 1 second passes.
_tencent_sem = threading.Semaphore(4)

def _tencent_acquire() -> None:
    """Acquire a rate-limit slot; hold it for 1s (released by caller implicitly).
    Uses a simpler per-request sleep to guarantee ≤ 4 req/s.
    """
    _tencent_sem.acquire()

def _tencent_release() -> None:
    """Release the rate-limit slot after 1s (called in a background thread)."""
    def _release():
        time.sleep(1.0)
        _tencent_sem.release()
    threading.Thread(target=_release, daemon=True).start()


# ── Node.js helper ───────────────────────────────────────────────────────────

def _find_node() -> str | None:
    """Find node binary: PATH first, then common fnm/nvm/brew stable locations."""
    import shutil as _shutil
    node = _shutil.which("node")
    if node:
        return node
    # fnm stores versions at stable paths not in Tauri's PATH
    candidates = [
        # fnm (Linux/macOS)
        *sorted(Path(os.path.expanduser(
            "~/.local/share/fnm/node-versions"
        )).glob("*/installation/bin/node"), reverse=True),
        # nvm
        *sorted(Path(os.path.expanduser(
            "~/.nvm/versions/node"
        )).glob("*/bin/node"), reverse=True),
        # Homebrew
        Path("/opt/homebrew/bin/node"),
        Path("/usr/local/bin/node"),
    ]
    for p in candidates:
        if Path(p).exists():
            return str(p)
    return None


# ── YouTube cookie helper ─────────────────────────────────────────────────────

def _cookie_opts() -> dict:
    """Return yt-dlp cookie options based on YTDLP_COOKIES_BROWSER env var.

    Set YTDLP_COOKIES_BROWSER=chrome/safari/firefox/edge/none to override.
    Default 'auto': detects the best available browser per platform.

    Platform defaults:
      macOS   — Safari > Firefox > Chrome  (Chrome cookie decryption unreliable)
      Windows — Chrome > Edge > Firefox
      Linux   — Chrome/Chromium > Firefox
    """
    import shutil
    import platform as _platform

    browser = os.environ.get("YTDLP_COOKIES_BROWSER", "auto").lower()
    if browser == "none":
        return {}
    if browser != "auto":
        return {"cookiesfrombrowser": (browser,)}

    system = _platform.system()
    candidates: list[str] = []

    if system == "Darwin":  # macOS
        # Chrome first — most likely to have an active YouTube session
        if Path(os.path.expanduser(
            "~/Library/Application Support/Google/Chrome"
        )).exists():
            candidates.append("chrome")
        if shutil.which("firefox") or Path(
            os.path.expanduser("~/Library/Application Support/Firefox")
        ).exists():
            candidates.append("firefox")
        # Safari cookies are sandbox-protected; probe with an actual read
        safari_cookies = Path(os.path.expanduser(
            "~/Library/Containers/com.apple.Safari/Data/Library/Cookies/Cookies.binarycookies"
        ))
        if safari_cookies.exists():
            try:
                with open(safari_cookies, "rb") as _f:
                    _f.read(1)
                candidates.append("safari")
            except OSError:
                pass  # sandbox or permission denied — skip safari

    elif system == "Windows":
        local = os.environ.get("LOCALAPPDATA", "")
        appdata = os.environ.get("APPDATA", "")
        if local and Path(local, "Google", "Chrome", "User Data").exists():
            candidates.append("chrome")
        if local and Path(local, "Microsoft", "Edge", "User Data").exists():
            candidates.append("edge")
        if appdata and Path(appdata, "Mozilla", "Firefox", "Profiles").exists():
            candidates.append("firefox")

    else:  # Linux and others
        if Path(os.path.expanduser("~/.config/google-chrome")).exists():
            candidates.append("chrome")
        elif shutil.which("google-chrome") or shutil.which("chromium-browser") or shutil.which("chromium"):
            candidates.append("chrome")
        if Path(os.path.expanduser("~/.mozilla/firefox")).exists():
            candidates.append("firefox")

    if candidates:
        return {"cookiesfrombrowser": (candidates[0],)}
    return {}


# ── Proxy helper ──────────────────────────────────────────────────────────────

def _proxy_opts() -> dict:
    """Return yt-dlp proxy option.

    Priority:
      1. YTDLP_PROXY env var (explicit override)
      2. Standard HTTPS_PROXY / HTTP_PROXY / ALL_PROXY env vars
      3. macOS system proxy settings (read via urllib, covers Surge/ClashX/etc.)
    """
    explicit = os.environ.get("YTDLP_PROXY", "").strip()
    if explicit:
        return {"proxy": explicit}

    # Standard env vars (GUI apps often don't inherit shell exports)
    for var in ("HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"):
        val = os.environ.get(var, "").strip()
        if val:
            return {"proxy": val}

    # Read macOS system proxy (works even without env vars)
    try:
        from urllib.request import getproxies
        proxies = getproxies()
        proxy = proxies.get("https") or proxies.get("http")
        if proxy:
            return {"proxy": proxy}
    except Exception:
        pass

    return {}


def main() -> None:
    if len(sys.argv) < 2:
        fatal("No command specified")
    cmd = sys.argv[1]
    if cmd == "fetch-metadata":
        if len(sys.argv) < 3:
            fatal("Missing URL argument")
        fetch_metadata(sys.argv[2])
    elif cmd == "transcribe":
        if len(sys.argv) < 4:
            fatal("Missing job_id or url")
        transcribe(sys.argv[2], sys.argv[3])
    elif cmd == "download":
        if len(sys.argv) < 5:
            fatal("Missing job_id, url, or output_dir")
        download_video_cmd(sys.argv[2], sys.argv[3], sys.argv[4])
    elif cmd == "publish":
        if len(sys.argv) < 4:
            fatal("Missing job_id or meta file")
        publish(sys.argv[2], sys.argv[3])
    else:
        fatal(f"Unknown command: {cmd}")


def fatal(msg: str) -> None:
    print(json.dumps({"type": "error", "message": msg}), file=sys.stderr)
    sys.exit(1)


def progress(stage: str, step: str, percent: int) -> None:
    print(
        json.dumps({"type": "progress", "stage": stage, "step": step, "percent": percent}),
        flush=True,
    )


# ── fetch-metadata ────────────────────────────────────────────────────────────

def fetch_metadata(url: str) -> None:
    try:
        import yt_dlp
    except ImportError:
        fatal("yt-dlp not installed — run: pip install yt-dlp")

    _node = _find_node()
    cookie_opts = _cookie_opts()
    proxy_opts = _proxy_opts()
    info = None
    last_err = None

    # Build retry configs: try cookies first, fall back on specific errors
    configs: list = [(True, False), (True, True)]
    if cookie_opts:
        configs += [(False, False), (False, True)]  # cookie error fallback

    for use_cookies, noverify in configs:
        c_opts = cookie_opts if use_cookies else {}
        base_opts = {"quiet": True, "no_warnings": True, "skip_download": True,
                     **c_opts, **proxy_opts,
                     **(_node and {"js_runtimes": {"node": {"path": _node}}} or {})}
        extra = {"nocheckcertificate": True} if noverify else {}

        for attempt in range(3):
            try:
                with yt_dlp.YoutubeDL({**base_opts, **extra}) as ydl:
                    info = ydl.extract_info(url, download=False)
                break
            except Exception as e:
                last_err = e
                err_str = str(e).lower()
                if "reload" in err_str and attempt < 2:
                    time.sleep(3)
                    continue
                break  # try next config
        if info is not None:
            break

    if info is None:
        fatal(f"yt-dlp metadata error: {last_err}")

    print(json.dumps({
        "title": info.get("title", "Unknown"),
        "channel": info.get("uploader") or info.get("channel", "Unknown"),
        "duration": _fmt_duration(info.get("duration", 0)),
        "thumbnail_url": info.get("thumbnail"),
    }))


# ── transcribe ────────────────────────────────────────────────────────────────

_ZH_LANGS = ["zh-Hans", "zh-CN", "zh-Hant", "zh"]
_EN_LANGS  = ["en", "en-US", "en-GB", "en-orig"]

def transcribe(job_id: str, url: str) -> None:
    try:
        import yt_dlp
    except ImportError:
        fatal("yt-dlp not installed — run: pip install yt-dlp")

    work_dir = Path(tempfile.gettempdir()) / "tubepilot" / job_id
    work_dir.mkdir(parents=True, exist_ok=True)

    video_id = _extract_video_id(url)

    # 1. timedtext API for zh-Hans (fast direct HTTP, no yt-dlp overhead)
    progress("transcribe", "check_zh", 10)
    if video_id:
        sub_content = _fetch_timedtext(video_id, tlang="zh-Hans")
        if sub_content:
            segments = _parse_subtitle(sub_content, lang_field="zh")
            if segments:
                progress("transcribe", "done", 100)
                print(json.dumps({"segments": segments, "zh_available": True}), flush=True)
                return

    # 2. One yt-dlp call for zh + en together.
    #    ignoreerrors=True means zh 429 won't abort — en will still download.
    progress("transcribe", "check_en", 20)
    subs = _download_subtitles_multi(url, _ZH_LANGS[:1] + _EN_LANGS[:2], work_dir)

    # Prefer zh
    for lang in _ZH_LANGS[:1]:
        if lang in subs:
            segments = _parse_subtitle(subs[lang], lang_field="zh")
            if segments:
                progress("transcribe", "done", 100)
                print(json.dumps({"segments": segments, "zh_available": True}), flush=True)
                return

    # Fall back to en
    for lang in _EN_LANGS[:2]:
        if lang in subs:
            segments = _parse_subtitle(subs[lang], lang_field="en")
            if segments:
                progress("transcribe", "done", 100)
                print(json.dumps({"segments": segments, "zh_available": False}), flush=True)
                return

    # 3. Fallback: Whisper ───────────────────────────────────────────────────────
    progress("transcribe", "whisper_fallback", 25)
    # Anaconda Python has a known OpenMP DLL conflict with PyTorch
    os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")
    try:
        import whisper
    except ImportError:
        fatal("No subtitles found and openai-whisper not installed. "
              "Run: pip install openai-whisper  (or ensure the video has captions)")

    _node = _find_node()
    proxy_opts = _proxy_opts()
    last_audio_err = None

    for use_cookies in (True, False):
        cookie_opts = _cookie_opts() if use_cookies else {}
        ydl_audio_opts = {
            "format": "bestaudio/best",
            "postprocessors": [{"key": "FFmpegExtractAudio", "preferredcodec": "mp3", "preferredquality": "128"}],
            "outtmpl": str(work_dir / "audio.%(ext)s"),
            "quiet": True,
            "no_warnings": True,
            **cookie_opts, **proxy_opts,
            **(_node and {"js_runtimes": {"node": {"path": _node}}} or {}),
        }
        try:
            with yt_dlp.YoutubeDL(ydl_audio_opts) as ydl:
                ydl.download([url])
            break
        except Exception as e:
            last_audio_err = e
    else:
        fatal(f"Audio download error: {last_audio_err}")

    audio_path = work_dir / "audio.mp3"
    if not audio_path.exists():
        fatal(f"Audio file not found: {audio_path}")

    progress("transcribe", "whisper_load", 40)
    try:
        model = whisper.load_model("medium")
        progress("transcribe", "whisper_run", 50)
        result = model.transcribe(str(audio_path), language="en", verbose=False)
    except Exception as e:
        fatal(f"Whisper error: {e}")

    segments = [
        {"id": i, "inTime": round(s["start"], 2), "outTime": round(s["end"], 2),
         "en": s["text"].strip(), "zh": "", "approved": False}
        for i, s in enumerate(result["segments"], start=1)
    ]
    progress("transcribe", "done", 100)
    print(json.dumps({"segments": segments, "zh_available": False}), flush=True)


def _extract_video_id(url: str) -> str | None:
    """Extract YouTube video ID from URL."""
    import re
    patterns = [
        r"(?:v=|youtu\.be/|embed/|shorts/)([A-Za-z0-9_-]{11})",
    ]
    for pat in patterns:
        m = re.search(pat, url)
        if m:
            return m.group(1)
    return None


def _fetch_timedtext(video_id: str, tlang: str | None) -> str | None:
    """Fetch subtitles via YouTube's timedtext API.

    For auto-translated Chinese:
      tlang="zh-Hans" → ?v=ID&lang=en&fmt=vtt&kind=asr&tlang=zh-Hans
    For plain English ASR:
      tlang=None      → ?v=ID&lang=en&fmt=vtt&kind=asr
    """
    try:
        import requests
    except ImportError:
        return None

    params: dict = {"v": video_id, "lang": "en", "fmt": "vtt", "kind": "asr"}
    if tlang:
        params["tlang"] = tlang

    proxy = _proxy_opts().get("proxy")
    for attempt in range(3):
        try:
            resp = requests.get(
                "https://www.youtube.com/api/timedtext",
                params=params,
                timeout=20,
                headers={"User-Agent": "Mozilla/5.0"},
                proxies={"https": proxy, "http": proxy} if proxy else None,
            )
            if resp.status_code == 200 and "WEBVTT" in resp.text:
                return resp.text
        except Exception:
            if attempt < 2:
                time.sleep(2)
    return None


def _download_subtitles_multi(url: str, langs: list[str], work_dir: Path) -> dict[str, str]:
    """Download multiple subtitle languages in ONE yt-dlp call.
    Returns {lang: content} for every language that was successfully downloaded.
    """
    import yt_dlp, shutil

    node_path = _find_node()
    proxy_opts = _proxy_opts()

    for use_cookies in (True, False):
        cookie_opts = _cookie_opts() if use_cookies else {}
        for f in work_dir.glob("sub.*.*"):
            try: f.unlink()
            except Exception: pass

        opts = {
            "quiet": True,
            "no_warnings": True,
            "skip_download": True,
            "writesubtitles": True,
            "writeautomaticsub": True,
            "subtitleslangs": langs,
            "subtitlesformat": "vtt",
            "outtmpl": str(work_dir / "sub.%(ext)s"),
            "ignoreerrors": True,
            **cookie_opts, **proxy_opts,
            **({"js_runtimes": {"node": {"path": node_path}}} if node_path else {}),
        }
        try:
            with yt_dlp.YoutubeDL(opts) as ydl:
                ydl.download([url])
        except Exception:
            pass

        result = {}
        for lang in langs:
            for ext in ["vtt", "srt"]:
                p = work_dir / f"sub.{lang}.{ext}"
                if p.exists():
                    try:
                        content = p.read_text(encoding="utf-8")
                        if content.strip():
                            result[lang] = content
                            break
                    except Exception:
                        pass
        if result:
            return result
    return {}


def _download_subtitle(url: str, lang_candidates: list[str], work_dir: Path) -> str | None:
    """Try each language candidate; return first subtitle content found.
    No retries on 429 — pointless to retry a rate limit, just move on.
    """
    import yt_dlp, shutil

    node_path = _find_node()
    base_opts = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "writesubtitles": True,
        "writeautomaticsub": True,
        "subtitlesformat": "vtt",
        "outtmpl": str(work_dir / "sub.%(ext)s"),
        "ignoreerrors": True,   # continue past 429 on individual languages
        **_cookie_opts(),
        **_proxy_opts(),
        **({"js_runtimes": {"node": {"path": node_path}}} if node_path else {}),
    }

    for lang in lang_candidates:
        for f in work_dir.glob("sub.*.*"):
            try: f.unlink()
            except Exception: pass

        opts = {**base_opts, "subtitleslangs": [lang]}
        try:
            with yt_dlp.YoutubeDL(opts) as ydl:
                ydl.download([url])
        except Exception:
            pass

        for ext in ["vtt", "srt"]:
            p = work_dir / f"sub.{lang}.{ext}"
            if p.exists():
                try:
                    content = p.read_text(encoding="utf-8")
                    if content.strip():
                        return content
                except Exception:
                    pass

    return None


def _parse_subtitle(content: str, lang_field: str) -> list[dict]:
    """Parse SRT or VTT content into segment dicts.
    lang_field: 'en' or 'zh' — which field to fill."""
    content = content.strip()
    if content.startswith("WEBVTT"):
        segs = _parse_vtt(content)
    else:
        segs = _parse_srt(content)

    result = []
    for i, seg in enumerate(segs, start=1):
        text = seg["text"].strip()
        if not text:
            continue
        result.append({
            "id": i,
            "inTime": seg["inTime"],
            "outTime": seg["outTime"],
            "en": text if lang_field == "en" else "",
            "zh": text if lang_field == "zh" else "",
            "approved": False,
        })
    return result


def _parse_srt(content: str) -> list[dict]:
    """Parse SRT subtitle format."""
    segs = []
    blocks = re.split(r"\n\s*\n", content.strip())
    for block in blocks:
        lines = block.strip().splitlines()
        if len(lines) < 2:
            continue
        # Find the timing line
        for i, line in enumerate(lines):
            m = re.match(
                r"(\d{1,2}:\d{2}:\d{2}[,.]\d{2,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,.]\d{2,3})",
                line,
            )
            if m:
                start = _srt_time(m.group(1))
                end   = _srt_time(m.group(2))
                text  = " ".join(lines[i + 1:]).strip()
                text  = re.sub(r"<[^>]+>", "", text)  # strip HTML tags
                segs.append({"inTime": start, "outTime": end, "text": text})
                break
    return segs


def _parse_vtt(content: str) -> list[dict]:
    """Parse WebVTT subtitle format (strips word-level cue tags)."""
    segs = []
    blocks = re.split(r"\n\s*\n", content.strip())
    for block in blocks:
        lines = block.strip().splitlines()
        for i, line in enumerate(lines):
            m = re.match(
                r"(\d{1,2}:\d{2}:\d{2}\.\d{2,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}\.\d{2,3})",
                line,
            )
            if m:
                start = _vtt_time(m.group(1))
                end   = _vtt_time(m.group(2))
                text  = " ".join(lines[i + 1:]).strip()
                # Strip VTT cue tags: <00:00:00.000>, <c>, </c>
                text = re.sub(r"<\d{2}:\d{2}:\d{2}\.\d+>", "", text)
                text = re.sub(r"</?c>", "", text)
                text = re.sub(r"<[^>]+>", "", text)  # any remaining tags
                text = text.strip()
                if text:
                    segs.append({"inTime": start, "outTime": end, "text": text})
                break
    return segs


def _srt_time(t: str) -> float:
    t = t.replace(",", ".")
    parts = t.split(":")
    h, m, s = int(parts[0]), int(parts[1]), float(parts[2])
    return round(h * 3600 + m * 60 + s, 2)


def _vtt_time(t: str) -> float:
    parts = t.split(":")
    h, m, s = int(parts[0]), int(parts[1]), float(parts[2])
    return round(h * 3600 + m * 60 + s, 2)


# ── translate (helpers only — translation now runs in Rust) ──────────────────
# _bing_translate / _tencent_translate kept for publish title/desc translation.

def _bing_translate(texts: list[str], key: str) -> list[str]:
    try:
        import requests
    except ImportError:
        fatal("requests not installed — run: pip install requests")
    url = "https://api.cognitive.microsofttranslator.com/translate"
    params = {"api-version": "3.0", "from": "en", "to": "zh-Hans"}
    headers = {"Ocp-Apim-Subscription-Key": key, "Content-Type": "application/json"}
    try:
        resp = requests.post(url, params=params, headers=headers,
                             json=[{"Text": t} for t in texts], timeout=30)
        resp.raise_for_status()
    except Exception as e:
        fatal(f"Bing Translate error: {e}")
    return [item["translations"][0]["text"] for item in resp.json()]


_SEP = "\n---SEP---\n"  # separator unlikely to appear in translation output

def _tencent_batch_size(texts: list[str]) -> int:
    """Calculate how many texts fit in one ~3000-char Tencent request."""
    if not texts:
        return 1
    avg = sum(len(t) for t in texts[:50]) / min(len(texts), 50)
    sep_overhead = len(_SEP)
    # 3000 char budget per request (well under 6000 limit for safety)
    return max(1, int(3000 / (avg + sep_overhead)))


def _tencent_translate(texts: list[str], secret_id: str, secret_key: str) -> list[str]:
    """Pack multiple texts into one request using a separator.
    Falls back to one-by-one if the separator is found in a text or result count mismatches.
    """
    try:
        from tencentcloud.common import credential
        from tencentcloud.tmt.v20180321 import tmt_client, models
    except ImportError:
        fatal("tencentcloud SDK not installed — run: pip install tencentcloud-sdk-python-tmt")

    from tencentcloud.common.profile.client_profile import ClientProfile
    from tencentcloud.common.retry import NoopRetryer
    profile = ClientProfile()
    profile.retryer = NoopRetryer()   # disable SDK-internal retry; we own rate control
    cred = credential.Credential(secret_id, secret_key)
    client = tmt_client.TmtClient(cred, "ap-guangzhou", profile)

    def call_api(text: str) -> str:
        _tencent_acquire()            # block until a slot is free
        try:
            req = models.TextTranslateRequest()
            req.SourceText = text
            req.Source = "en"
            req.Target = "zh"
            req.ProjectId = 0
            return client.TextTranslate(req).TargetText
        except Exception as e:
            raise RuntimeError(f"Tencent API error: {e}") from e
        finally:
            _tencent_release()        # release slot after 1s in background

    # Try packed request (separator trick)
    if len(texts) > 1 and all(_SEP not in t for t in texts):
        packed = _SEP.join(texts)
        try:
            result = call_api(packed)
            parts = result.split(_SEP)
            if len(parts) == len(texts):
                return parts
            # count mismatch — fall through to one-by-one
        except Exception:
            pass  # fall through to one-by-one

    # Fallback: one API call per text
    return [call_api(t) for t in texts]


# ── publish ───────────────────────────────────────────────────────────────────

def publish(job_id: str, meta_file: str) -> None:
    """Download YouTube video then upload to Bilibili via biliup."""
    try:
        _publish(job_id, meta_file)
    except Exception as e:
        import traceback
        traceback.print_exc(file=sys.stderr)
        fatal(f"发布失败：{e}")


def _publish(job_id: str, meta_file: str) -> None:
    sys.stderr.write(f"[DEBUG] _publish start, meta={meta_file}\n"); sys.stderr.flush()
    try:
        with open(meta_file, encoding="utf-8") as f:
            meta = json.load(f)
    except (OSError, json.JSONDecodeError) as e:
        fatal(f"Failed to read meta file: {e}")
    sys.stderr.write(f"[DEBUG] meta loaded, url={meta.get('url','?')}\n"); sys.stderr.flush()

    url        = meta["url"]
    title      = meta.get("title", "")
    desc       = meta.get("desc", "")
    tid        = meta.get("tid", 208)
    tags       = meta.get("tags", [])
    cover_url  = meta.get("cover_url", "")
    sessdata   = meta["sessdata"]
    bili_jct   = meta["bili_jct"]
    uid        = meta["uid"]
    subtitles  = meta.get("subtitles", [])

    try:
        from biliup.plugins.bili_webup import BiliBili, Data
    except ImportError:
        fatal("biliup not installed — run: pip install biliup")

    try:
        import yt_dlp
    except ImportError:
        fatal("yt-dlp not installed — run: pip install yt-dlp")

    work_dir = Path(tempfile.gettempdir()) / "tubepilot" / job_id
    work_dir.mkdir(parents=True, exist_ok=True)

    # 1. Use pre-downloaded video or download now
    pre_path = meta.get("video_path")
    if pre_path and Path(pre_path).exists():
        video_path = Path(pre_path)
        progress("publish", "upload_video", 40)  # skip to upload
    else:
        progress("publish", "download_video", 5)
        try:
            video_path = _download_video(url, work_dir)
        except Exception as e:
            fatal(f"视频下载失败：{e}")

    # 2. Export subtitles as SRT
    srt_path = None
    if subtitles:
        srt_content = _segs_to_srt(subtitles)
        srt_path = work_dir / "subtitles.srt"
        srt_path.write_text(srt_content, encoding="utf-8")

    # 3. Download cover image
    cover_path = None
    if cover_url:
        try:
            import requests as _req
            resp = _req.get(cover_url, timeout=20)
            resp.raise_for_status()
            ext = "jpg" if "jpeg" in resp.headers.get("content-type", "") or "jpg" in cover_url else "png"
            cover_path = work_dir / f"cover.{ext}"
            cover_path.write_bytes(resp.content)
        except Exception:
            cover_path = None  # non-fatal

    # 4. Translate title / desc if not Chinese
    provider = os.environ.get("TRANSLATE_PROVIDER", "").lower()
    if not provider:
        if os.environ.get("TENCENT_SECRET_ID") and os.environ.get("TENCENT_SECRET_KEY"):
            provider = "tencent"
        elif os.environ.get("BING_TRANSLATE_KEY"):
            provider = "bing"

    texts_to_translate = []
    translate_title = not _is_chinese(title) and bool(title)
    translate_desc  = not _is_chinese(desc)  and bool(desc)
    if translate_title: texts_to_translate.append(title)
    if translate_desc:  texts_to_translate.append(desc)

    if texts_to_translate and provider:
        progress("publish", "translating_meta", 38)
        try:
            translated = _translate_for_publish(texts_to_translate, provider)
            idx = 0
            if translate_title:
                title = translated[idx]; idx += 1
            if translate_desc:
                desc = translated[idx]
        except Exception as e:
            pass  # non-fatal: keep original text

    # 5. Upload to Bilibili
    sys.stderr.write(f"[DEBUG] starting B站 upload, video={video_path}\n"); sys.stderr.flush()
    progress("publish", "upload_video", 40)
    cookie = {
        "cookie_info": {
            "cookies": [
                {"name": "SESSDATA",   "value": sessdata},
                {"name": "bili_jct",   "value": bili_jct},
                {"name": "DedeUserID", "value": uid},
            ]
        }
    }

    video_data = Data(
        copyright=2,   # 转载
        source=url,
        tid=tid,
        title=title,
        desc=desc,
    )
    if tags:
        video_data.set_tag(tags if isinstance(tags, list) else tags.split(","))

    with BiliBili(video_data) as bili:
        # biliup 默认 UA 是 Chrome/63 (2017)，会被 B站 412 拦截，替换成现代 UA
        bili._BiliBili__session.headers.update({
            "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                          "AppleWebKit/537.36 (KHTML, like Gecko) "
                          "Chrome/124.0.0.0 Safari/537.36",
        })

        # Login
        try:
            bili.login_by_cookies(cookie)
        except Exception as e:
            fatal(f"B站登录失败（Cookie可能已过期，请在设置页重新扫码）：{e}")

        # Upload cover (non-fatal)
        if cover_path and cover_path.exists():
            try:
                video_data.cover = bili.cover_up(str(cover_path))
            except Exception:
                pass

        # Upload video
        progress("publish", "uploading_chunks", 45)
        try:
            video_part = bili.upload_file(str(video_path))
        except Exception as e:
            fatal(f"视频上传失败：{e}")
        video_part["title"] = title
        video_data.append(video_part)

        # Submit
        progress("publish", "submitting", 90)
        try:
            ret = bili.submit()
        except Exception as e:
            fatal(f"投稿提交失败：{e}")

    bvid = ret.get("data", {}).get("bvid", "")

    # Upload CC subtitle (non-fatal — video is already published)
    if bvid and subtitles:
        progress("publish", "uploading_subtitle", 95)
        _upload_bili_cc_subtitle(bvid, subtitles, sessdata, bili_jct)

    progress("publish", "done", 100)
    sys.stderr.write(f"[DEBUG] publish done, bvid={bvid}\n"); sys.stderr.flush()
    result = {"bvid": bvid, "url": f"https://www.bilibili.com/video/{bvid}"}
    # Write result to file AND stdout — file as fallback for pipe issues
    result_path = work_dir / "publish_result.json"
    result_path.write_text(json.dumps(result), encoding="utf-8")
    print(json.dumps(result), flush=True)
    # Give OS pipe time to deliver last line before process exits
    time.sleep(0.5)


def download_video_cmd(job_id: str, url: str, output_dir: str) -> None:
    """Standalone download command — called by Rust at pipeline start.
    Emits progress JSON and prints video_path on completion.
    """
    try:
        import yt_dlp
    except ImportError:
        fatal("yt-dlp not installed — run: pip install yt-dlp")

    work_dir = Path(output_dir) / job_id
    work_dir.mkdir(parents=True, exist_ok=True)

    last_pct: list[int] = [0]

    def _hook(d: dict) -> None:
        if d.get("status") != "downloading":
            return
        total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
        downloaded = d.get("downloaded_bytes") or 0
        if total > 0:
            pct = min(99, int(downloaded / total * 100))
            if pct >= last_pct[0] + 3:   # emit every ~3%
                last_pct[0] = pct
                print(json.dumps({"type": "progress", "percent": pct}), flush=True)

    try:
        path = _download_video(url, work_dir, progress_hook=_hook)
        print(json.dumps({"video_path": str(path)}), flush=True)
    except Exception as e:
        fatal(f"视频下载失败：{e}")


def _download_video(url: str, work_dir: Path, *, progress_hook=None) -> Path:
    """Download best quality mp4 video via yt-dlp (4 concurrent fragments)."""
    import yt_dlp
    _node = _find_node()
    proxy_opts = _proxy_opts()
    last_err = None

    for use_cookies in (True, False):
        cookie_opts = _cookie_opts() if use_cookies else {}
        for noverify in (False, True):
            opts = {
                "format": "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
                "outtmpl": str(work_dir / "video.%(ext)s"),
                "quiet": True,
                "no_warnings": True,
                "merge_output_format": "mp4",
                "concurrent_fragment_downloads": 1,
                "continuedl": True,
                "retries": 50,
                "fragment_retries": 50,
                "file_access_retries": 10,
                "sleep_interval": 5,
                "max_sleep_interval": 60,
                **cookie_opts, **proxy_opts,
                **(_node and {"js_runtimes": {"node": {"path": _node}}} or {}),
            }
            if noverify:
                opts["nocheckcertificate"] = True
            if progress_hook:
                opts["progress_hooks"] = [progress_hook]
            try:
                with yt_dlp.YoutubeDL(opts) as ydl:
                    ydl.download([url])
                break
            except Exception as e:
                last_err = e
                if "ssl" not in str(e).lower() and "eof" not in str(e).lower():
                    break  # non-SSL error, skip noverify retry
        else:
            continue  # both SSL attempts failed, try without cookies
        for ext in ["mp4", "mkv", "webm"]:
            p = work_dir / f"video.{ext}"
            if p.exists():
                return p

    raise FileNotFoundError(f"视频下载失败：{last_err}")


def _segs_to_srt(segs: list) -> str:
    """Convert subtitle segments to SRT format (Chinese preferred)."""
    lines = []
    for i, seg in enumerate(segs, start=1):
        text = (seg.get("zh") or seg.get("en", "")).strip()
        if not text:
            continue
        start = _srt_fmt(seg["inTime"])
        end   = _srt_fmt(seg["outTime"])
        lines.append(f"{i}\n{start} --> {end}\n{text}\n")
    return "\n".join(lines)


def _srt_fmt(secs: float) -> str:
    h  = int(secs // 3600)
    m  = int((secs % 3600) // 60)
    s  = int(secs % 60)
    ms = int((secs % 1) * 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


# ── Bilibili CC subtitle upload ───────────────────────────────────────────────

def _upload_bili_cc_subtitle(
    bvid: str,
    segments: list[dict],
    sessdata: str,
    bili_jct: str,
) -> None:
    """Upload CC subtitle to Bilibili after video is published.

    Flow:
      1. GET /x/web-interface/view?bvid= → cid
      2. Convert segments → B站 CC JSON format
      3. POST /x/v2/dm/subtitle/draft/save
    Non-fatal: errors are silently swallowed so publish still succeeds.
    """
    if not segments or not bvid:
        return
    try:
        import requests as _req
    except ImportError:
        return

    session = _req.Session()
    session.cookies.set("SESSDATA", sessdata)
    session.cookies.set("bili_jct",  bili_jct)
    session.headers.update({
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                      "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Referer": "https://www.bilibili.com",
    })

    try:
        # 1. Get CID (content id of the first video part)
        r = session.get(
            "https://api.bilibili.com/x/web-interface/view",
            params={"bvid": bvid}, timeout=20,
        )
        cid = r.json().get("data", {}).get("cid")
        if not cid:
            return

        # 2. Build B站 CC JSON format
        body = []
        for seg in segments:
            text = (seg.get("zh") or seg.get("en") or "").strip()
            if text:
                body.append({
                    "from":     round(float(seg["inTime"]),  3),
                    "to":       round(float(seg["outTime"]), 3),
                    "location": 2,   # bottom center
                    "content":  text,
                })
        if not body:
            return

        cc_data = json.dumps({
            "font_size":         0.4,
            "font_color":        "#FFFFFF",
            "background_alpha":  0.5,
            "background_color":  "#9C27B0",
            "Stroke":            "none",
            "body":              body,
        }, ensure_ascii=False)

        # 3. Upload subtitle draft
        session.post(
            "https://api.bilibili.com/x/v2/dm/subtitle/draft/save",
            data={
                "type":   1,
                "oid":    cid,
                "lan":    "zh-CN",
                "data":   cc_data,
                "csrf":   bili_jct,
                "submit": "true",
                "sign":   "false",
                "bvid":   bvid,
            },
            timeout=30,
        )
    except Exception:
        pass  # non-fatal — subtitle upload failure shouldn't block publish


# ── language / translation helpers ───────────────────────────────────────────

def _is_chinese(text: str) -> bool:
    """Return True if text contains any Chinese characters."""
    return bool(re.search(r"[一-鿿㐀-䶿豈-﫿]", text))


def _translate_for_publish(texts: list[str], provider: str) -> list[str]:
    """Translate a small list of texts (title/desc) to Chinese.
    URLs are protected from mangling by swapping with placeholders.
    """
    _url_pat = re.compile(r"https?://\S+")

    # Replace URLs with placeholders to protect them
    placeholders: list[list[tuple[str, str]]] = []
    guarded = []
    for text in texts:
        urls = _url_pat.findall(text)
        mapping = [(url, f"__URL{i}__") for i, url in enumerate(urls)]
        guarded_text = text
        for url, ph in mapping:
            guarded_text = guarded_text.replace(url, ph, 1)
        placeholders.append(mapping)
        guarded.append(guarded_text)

    # Translate
    if provider == "bing":
        key = os.environ.get("BING_TRANSLATE_KEY", "")
        if not key:
            raise RuntimeError("BING_TRANSLATE_KEY not set")
        translated = _bing_translate(guarded, key)
    elif provider == "tencent":
        sid  = os.environ.get("TENCENT_SECRET_ID", "")
        skey = os.environ.get("TENCENT_SECRET_KEY", "")
        if not sid or not skey:
            raise RuntimeError("Tencent credentials not set")
        translated = _tencent_translate(guarded, sid, skey)
    else:
        raise RuntimeError(f"Unknown provider: {provider}")

    # Restore URLs
    result = []
    for text, mapping in zip(translated, placeholders):
        for url, ph in mapping:
            text = text.replace(ph, url)
        result.append(text)
    return result


# ── helpers ───────────────────────────────────────────────────────────────────

def _fmt_duration(secs: int) -> str:
    m, s = divmod(int(secs), 60)
    h, m = divmod(m, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


if __name__ == "__main__":
    try:
        main()
    except BaseException as e:
        import traceback
        traceback.print_exc(file=sys.stderr)
        if isinstance(e, SystemExit):
            raise  # preserve exit code
        fatal(f"未捕获异常：{e}")
