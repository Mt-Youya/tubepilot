#!/usr/bin/env python3
"""
End-to-end pipeline test.
Usage: python3 test_pipeline.py <youtube_url>
"""

import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

URL = sys.argv[1] if len(sys.argv) > 1 else "https://www.youtube.com/watch?v=IuVr8hqWG0o"
SIDECAR = Path(__file__).parent / "main.py"
ENV_FILE = Path(__file__).parents[4] / ".env.local"
JOB_ID   = "test-pipeline-001"

# ── colours ───────────────────────────────────────────────────────────────────
GREEN  = "\033[32m"
RED    = "\033[31m"
YELLOW = "\033[33m"
CYAN   = "\033[36m"
RESET  = "\033[0m"
BOLD   = "\033[1m"

def ok(msg):   print(f"  {GREEN}✓{RESET} {msg}")
def fail(msg): print(f"  {RED}✗{RESET} {msg}"); sys.exit(1)
def info(msg): print(f"  {CYAN}→{RESET} {msg}")
def header(msg): print(f"\n{BOLD}{YELLOW}▶ {msg}{RESET}")

# ── load .env.local ───────────────────────────────────────────────────────────
env = os.environ.copy()
if ENV_FILE.exists():
    for line in ENV_FILE.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip()

# Auto-detect TRANSLATE_PROVIDER (mirrors Rust logic in lib.rs)
if "TRANSLATE_PROVIDER" not in env:
    if env.get("TENCENT_SECRET_ID") and env.get("TENCENT_SECRET_KEY"):
        env["TRANSLATE_PROVIDER"] = "tencent"
    elif env.get("BING_TRANSLATE_KEY"):
        env["TRANSLATE_PROVIDER"] = "bing"

def run(args: list[str], timeout=120) -> tuple[list[dict], str]:
    """Run sidecar, return (parsed_json_lines, stderr)."""
    result = subprocess.run(
        ["python3", str(SIDECAR)] + args,
        capture_output=True, text=True, env=env, timeout=timeout,
    )
    lines = []
    for line in result.stdout.splitlines():
        line = line.strip()
        if line:
            try:
                lines.append(json.loads(line))
            except json.JSONDecodeError:
                pass
    return lines, result.stderr, result.returncode

# ══════════════════════════════════════════════════════════════════════════════
print(f"\n{BOLD}TubePilot Pipeline Test{RESET}")
print(f"URL: {URL}\n")

# ── Step 1: fetch-metadata ────────────────────────────────────────────────────
header("Step 1: fetch-metadata")
t0 = time.time()
lines, stderr, rc = run(["fetch-metadata", URL])
elapsed = time.time() - t0

if rc != 0 or not lines:
    fail(f"failed (exit {rc})\n  stderr: {stderr.strip()[-300:]}")

meta = lines[-1]
if "title" not in meta:
    fail(f"unexpected output: {meta}")

info(f"title:    {meta['title']}")
info(f"channel:  {meta['channel']}")
info(f"duration: {meta['duration']}")
ok(f"done in {elapsed:.1f}s")

# ── Step 2: transcribe ────────────────────────────────────────────────────────
header("Step 2: transcribe")
t0 = time.time()
lines, stderr, rc = run(["transcribe", JOB_ID, URL], timeout=180)
elapsed = time.time() - t0

if rc != 0:
    fail(f"failed (exit {rc})\n  stderr: {stderr.strip()[-300:]}")

progress = [l for l in lines if l.get("type") == "progress"]
result   = next((l for l in lines if "segments" in l), None)

if result is None:
    fail(f"no segments in output\n  lines: {lines}\n  stderr: {stderr.strip()[-300:]}")

segments   = result["segments"]
zh_avail   = result.get("zh_available", False)
lang_field = "zh" if zh_avail else "en"
sample     = segments[0].get(lang_field, "") if segments else ""

info(f"segments:     {len(segments)}")
info(f"zh_available: {zh_avail}")
info(f"progress steps: {[p['step'] for p in progress]}")
info(f"sample[0]:    {sample[:80]}")

if not segments:
    fail("empty segments list")
if not sample:
    fail(f"first segment has no '{lang_field}' text")

ok(f"done in {elapsed:.1f}s")

# ── Step 3: translate (only if zh not available) ──────────────────────────────
if not zh_avail:
    header("Step 3: translate")

    # Use only first 20 segments to keep test fast
    test_segs = segments[:20]
    segs_file = Path(tempfile.gettempdir()) / f"tubepilot-test-segs-{JOB_ID}.json"
    segs_file.write_text(json.dumps(test_segs), encoding="utf-8")

    t0 = time.time()
    lines, stderr, rc = run(["translate", JOB_ID, str(segs_file)], timeout=60)
    elapsed = time.time() - t0

    if rc != 0:
        fail(f"failed (exit {rc})\n  stderr: {stderr.strip()[-300:]}")

    result = next((l for l in lines if "segments" in l), None)
    if result is None:
        fail(f"no segments in translate output\n  stderr: {stderr.strip()[-300:]}")

    translated = result["segments"]
    sample_zh  = translated[0].get("zh", "") if translated else ""

    info(f"translated:   {len(translated)} segments (of {len(segments)} total)")
    info(f"sample zh[0]: {sample_zh[:80]}")

    if not sample_zh:
        fail("first translated segment has no 'zh' text")

    ok(f"done in {elapsed:.1f}s")
else:
    header("Step 3: translate")
    info("skipped — zh subtitles already available from YouTube")
    ok("skipped")

# ── Summary ───────────────────────────────────────────────────────────────────
print(f"\n{BOLD}{GREEN}All steps passed.{RESET}\n")
