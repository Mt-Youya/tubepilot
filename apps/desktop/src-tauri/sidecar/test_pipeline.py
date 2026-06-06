#!/usr/bin/env python3
"""
TubePilot sidecar end-to-end test.

Usage:
  python3 test_pipeline.py [youtube_url]

Tests the normal user flow:
  1. fetch-metadata  — title / channel / duration
  2. transcribe      — subtitles (zh_available should be True for videos with captions)

Translation is done in Rust; not tested here.
"""

import json
import os
import subprocess
import sys
import time
from pathlib import Path

# ── Config ────────────────────────────────────────────────────────────────────

URL      = sys.argv[1] if len(sys.argv) > 1 else "https://www.youtube.com/watch?v=t3my5ByUhFU"
SIDECAR  = Path(__file__).parent / "main.py"
ENV_FILE = Path(__file__).parents[4] / ".env.local"
JOB_ID   = "test-pipeline-001"

# Use the same Python that runs this script — ensures correct env/packages
PYTHON = sys.executable

# ── Colours ───────────────────────────────────────────────────────────────────

GREEN  = "\033[32m"
RED    = "\033[31m"
YELLOW = "\033[33m"
CYAN   = "\033[36m"
GREY   = "\033[90m"
RESET  = "\033[0m"
BOLD   = "\033[1m"

def ok(msg):     print(f"  {GREEN}✓{RESET} {msg}")
def fail(msg):   print(f"  {RED}✗{RESET} {msg}"); sys.exit(1)
def info(msg):   print(f"  {CYAN}→{RESET} {msg}")
def warn(msg):   print(f"  {YELLOW}⚠{RESET} {msg}")
def detail(msg): print(f"  {GREY}{msg}{RESET}")
def header(msg): print(f"\n{BOLD}{YELLOW}▶ {msg}{RESET}")
def section(msg):print(f"\n{BOLD}{msg}{RESET}")

# ── Environment setup ─────────────────────────────────────────────────────────

env = os.environ.copy()
if ENV_FILE.exists():
    for line in ENV_FILE.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")

if "TRANSLATE_PROVIDER" not in env:
    if env.get("TENCENT_SECRET_ID") and env.get("TENCENT_SECRET_KEY"):
        env["TRANSLATE_PROVIDER"] = "tencent"
    elif env.get("BING_TRANSLATE_KEY"):
        env["TRANSLATE_PROVIDER"] = "bing"

# ── Helper ────────────────────────────────────────────────────────────────────

def run(args: list[str], timeout: int = 120):
    """Run sidecar, stream stdout lines, return (json_lines, stderr, returncode)."""
    proc = subprocess.run(
        [PYTHON, str(SIDECAR)] + args,
        capture_output=True, text=True, env=env, timeout=timeout,
    )
    lines = []
    for line in proc.stdout.splitlines():
        line = line.strip()
        if line:
            try:
                lines.append(json.loads(line))
            except json.JSONDecodeError:
                pass
    return lines, proc.stderr, proc.returncode

# ══════════════════════════════════════════════════════════════════════════════

section("TubePilot Pipeline Test")
print(f"Python:  {PYTHON}")
print(f"Sidecar: {SIDECAR}")
print(f"URL:     {URL}")

# ── Pre-flight: environment info ──────────────────────────────────────────────

header("Pre-flight checks")

# Python packages
for pkg in ("yt_dlp", "requests"):
    try:
        __import__(pkg)
        ok(f"{pkg} installed")
    except ImportError:
        fail(f"{pkg} not installed — run: pip install {pkg.replace('_', '-')}")

# Proxy
lines, _, _ = run(["--help"], timeout=5)  # just a throwaway call to import the module
proxy_check = subprocess.run(
    [PYTHON, "-c",
     "import sys; sys.path.insert(0, '.'); from main import _proxy_opts; print(_proxy_opts())"],
    capture_output=True, text=True, cwd=str(SIDECAR.parent),
)
proxy_result = proxy_check.stdout.strip()
if "proxy" in proxy_result:
    ok(f"proxy detected: {proxy_result}")
else:
    warn("no proxy detected — YouTube may be unreachable")

# Cookie
cookie_check = subprocess.run(
    [PYTHON, "-c",
     "import sys; sys.path.insert(0, '.'); from main import _cookie_opts; print(_cookie_opts())"],
    capture_output=True, text=True, cwd=str(SIDECAR.parent),
)
cookie_result = cookie_check.stdout.strip()
if "cookiesfrombrowser" in cookie_result:
    ok(f"browser cookies: {cookie_result}")
else:
    warn("no browser cookies — may hit rate limits")

# Node.js
node_check = subprocess.run(
    [PYTHON, "-c",
     "import sys; sys.path.insert(0, '.'); from main import _find_node; print(_find_node())"],
    capture_output=True, text=True, cwd=str(SIDECAR.parent),
)
node_result = node_check.stdout.strip()
if node_result and node_result != "None":
    ok(f"node.js: {node_result}")
else:
    warn("node.js not found — yt-dlp n-challenge may fail")

# ── Step 1: fetch-metadata ────────────────────────────────────────────────────

header("Step 1: fetch-metadata")
t0 = time.time()
try:
    lines, stderr, rc = run(["fetch-metadata", URL], timeout=60)
except subprocess.TimeoutExpired:
    fail("timed out after 60s")
elapsed = time.time() - t0

if rc != 0 or not lines:
    fail(f"exit {rc}\n    {stderr.strip()[-400:]}")

meta = lines[-1]
if "title" not in meta:
    fail(f"unexpected output: {meta}")

info(f"title:    {meta['title']}")
info(f"channel:  {meta['channel']}")
info(f"duration: {meta['duration']}")
if meta.get("thumbnail_url"):
    info(f"thumbnail: {meta['thumbnail_url'][:60]}...")
ok(f"done in {elapsed:.1f}s")

# ── Step 2: transcribe ────────────────────────────────────────────────────────

header("Step 2: transcribe")
info("fetching subtitles (zh-Hans preferred, en fallback, Whisper last resort)...")
t0 = time.time()
try:
    lines, stderr, rc = run(["transcribe", JOB_ID, URL], timeout=300)
except subprocess.TimeoutExpired:
    fail("timed out after 300s")
elapsed = time.time() - t0

if rc != 0:
    fail(f"exit {rc}\n    {stderr.strip()[-400:]}")

progress_steps = [l["step"] for l in lines if l.get("type") == "progress"]
result = next((l for l in lines if "segments" in l), None)

if result is None:
    fail(f"no segments returned\n    stderr: {stderr.strip()[-400:]}")

segments    = result["segments"]
zh_available = result.get("zh_available", False)

detail(f"progress path: {' → '.join(progress_steps)}")
info(f"segments:      {len(segments)}")
info(f"zh_available:  {zh_available}")

if not segments:
    fail("empty segments list")

# Show first 3 segments
for seg in segments[:3]:
    text = seg.get("zh") or seg.get("en") or ""
    detail(f"  [{seg['id']:3d}] {seg['inTime']:6.1f}s  {text[:60]}")

# Validate segment structure
s0 = segments[0]
for field in ("id", "inTime", "outTime", "en", "zh", "approved"):
    if field not in s0:
        fail(f"segment missing field '{field}': {s0}")

if zh_available:
    zh_text = s0.get("zh", "")
    if not zh_text:
        fail("zh_available=True but first segment has no zh text")
    ok(f"✓ zh subtitles from YouTube — translation NOT needed")
else:
    en_text = s0.get("en", "")
    if not en_text:
        fail("zh_available=False but first segment has no en text")
    warn("zh_available=False — translation will run in Rust pipeline")
    info("(expected for videos without Chinese captions)")

ok(f"done in {elapsed:.1f}s")

# ── Step 3: translate skipped (done in Rust) ──────────────────────────────────

header("Step 3: translate")
info("skipped — translation runs natively in Rust (not in sidecar)")
ok("skipped")

# ── Summary ───────────────────────────────────────────────────────────────────

section("=" * 50)
print(f"{BOLD}{GREEN}All steps passed.{RESET}")
print()
if zh_available:
    print(f"  {GREEN}✓{RESET} Video has zh subtitles — full pipeline will skip translation")
else:
    print(f"  {YELLOW}⚠{RESET} Video needs translation — ensure BING_TRANSLATE_KEY or")
    print(f"    TENCENT_SECRET_ID/KEY are set in .env.local")
print()
