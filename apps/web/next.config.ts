import type { NextConfig } from "next";

// TAURI=1 → static export (needed for Tauri desktop bundling)
// Vercel / other hosts → standard Next.js (SSR, ISR, etc.)
const isDesktopBuild = process.env.TAURI === "1";

const nextConfig: NextConfig = {
  ...(isDesktopBuild && {
    output: "export",       // Tauri: produce /out for frontendDist
    trailingSlash: true,    // /page/ → /page/index.html
  }),
  images: {
    // Tauri can't use Next.js image optimization server;
    // Vercel has it built-in, so unoptimized only when building for desktop.
    unoptimized: isDesktopBuild,
  },
};

export default nextConfig;
