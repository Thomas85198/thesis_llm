import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { JobTrackerProvider } from "@/components/job-tracker";
import { SiteHeader } from "@/components/site-header";
import { Toaster } from "@/components/ui/sonner";
import { VersionWatcher } from "@/components/version-watcher";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "論文檢核系統",
  description: "EDU → ER → RST/FRU → Neo4j KG → 13 條 REL 規則檢核",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-Hant"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col bg-muted/30">
        <JobTrackerProvider>
          <SiteHeader />
          <main className="flex-1 flex flex-col">{children}</main>
        </JobTrackerProvider>
        <VersionWatcher />
        <Toaster richColors position="top-center" />
      </body>
    </html>
  );
}
