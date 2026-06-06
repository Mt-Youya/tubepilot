#!/usr/bin/env bash
# Local build script — mirrors the GitHub Actions desktop build pipeline.
# Usage: bash scripts/build-desktop.sh [--check-only]
#
# --check-only   Run cargo check + frontend build only (skip tauri bundle)

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

CHECK_ONLY=false
for arg in "$@"; do
  [[ "$arg" == "--check-only" ]] && CHECK_ONLY=true
done

step() { echo; echo "▶ $*"; }

# ── 1. pnpm install ───────────────────────────────────────────────────────────
step "pnpm install (frozen-lockfile)"
pnpm install --frozen-lockfile

# ── 2. cargo check ────────────────────────────────────────────────────────────
step "cargo check"
(cd apps/desktop/src-tauri && cargo check)

if $CHECK_ONLY; then
  echo
  echo "✓ check-only done (skipped tauri bundle)"
  exit 0
fi

# ── 3. build frontend (tauri static export) ───────────────────────────────────
step "next build (TAURI=1)"
pnpm --filter @tubepilot/web build:tauri

# ── 4. tauri build ────────────────────────────────────────────────────────────
step "tauri build"
pnpm --filter @tubepilot/desktop build

echo
echo "✓ build complete"
echo "  artifacts: apps/desktop/src-tauri/target/release/bundle/"
