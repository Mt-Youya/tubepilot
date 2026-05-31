#!/usr/bin/env node
/**
 * Cross-platform clean script.
 *
 * Usage:
 *   node scripts/clean.mjs          # build artifacts only
 *   node scripts/clean.mjs --all    # + node_modules + pnpm-lock.yaml
 */

import { rmSync, existsSync } from "fs";
import { join } from "path";

const ROOT  = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const ALL   = process.argv.includes("--all");

// ── Paths to always remove (build / generated) ────────────────────────────────
const BUILD_ARTIFACTS = [
  // Next.js
  "apps/web/.next",
  "apps/web/out",

  // Rust / Tauri  (large — can take minutes to rebuild)
  "apps/desktop/src-tauri/target",

  // TypeScript incremental build info
  "apps/web/tsconfig.tsbuildinfo",
  "packages/ui/tsconfig.tsbuildinfo",
  ".pnpm-store",
];

// ── Paths removed only with --all ─────────────────────────────────────────────
const DEEP_CLEAN = [
  // workspace node_modules
  "node_modules",
  "apps/web/node_modules",
  "apps/desktop/node_modules",
  "packages/ui/node_modules",
  "packages/core/node_modules",
  "packages/subtitle/node_modules",
  "packages/publisher/node_modules",

  // lockfile (regenerated on next install)
  "pnpm-lock.yaml",
];

function remove(rel) {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) return;
  rmSync(abs, { recursive: true, force: true });
  console.log(`  removed  ${rel}`);
}

const targets = ALL ? [...BUILD_ARTIFACTS, ...DEEP_CLEAN] : BUILD_ARTIFACTS;

console.log(ALL ? "Clean: build artifacts + dependencies\n" : "Clean: build artifacts\n");
targets.forEach(remove);
console.log("\nDone.");
