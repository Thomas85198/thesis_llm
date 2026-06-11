import type { MetadataRoute } from "next";

// Next.js serves this at /manifest.webmanifest. The next-intl middleware skips
// paths with a file extension, so this (and /sw.js, /icon-*.png) are served
// un-prefixed — no locale redirect. start_url points at the default locale so
// launching the installed app lands on the home page directly (no redirect hop).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "論文檢核與 AI 寫作系統",
    short_name: "論文檢核",
    description: "論文結構缺陷檢核 + AI 寫作編輯器",
    id: "/zh-Hant",
    start_url: "/zh-Hant",
    scope: "/",
    display: "standalone",
    orientation: "any",
    lang: "zh-Hant",
    dir: "ltr",
    background_color: "#ffffff",
    theme_color: "#4F46E5",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
