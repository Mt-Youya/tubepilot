import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import { SettingsProvider } from "../lib/settings-context";
import "./globals.css";

export const metadata: Metadata = {
  title: "TubePilot",
  description: "YouTube to Bilibili pipeline",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon-192.png", type: "image/png", sizes: "192x192" },
      { url: "/icon-512.png", type: "image/png", sizes: "512x512" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <SettingsProvider>{children}</SettingsProvider>
        <Analytics />
      </body>
    </html>
  );
}
