import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { notFound } from "next/navigation";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { setRequestLocale } from "next-intl/server";

import { JobTrackerProvider } from "@/components/job-tracker";
import { SiteHeader } from "@/components/site-header";
import { Toaster } from "@/components/ui/sonner";
import { VersionWatcher } from "@/components/version-watcher";
import { routing } from "@/i18n/routing";
import "../globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Tab title is kept in English across locales (the user asked to unify it
// rather than localize the browser-tab string).
export const metadata: Metadata = {
  title: "Paper Review System",
  description: "EDU → ER → RST/FRU → Neo4j KG → 13 REL rule checks",
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

// Runs before first paint (blocking inline script): reads the `theme` cookie and
// applies `.dark` to <html> so a reload never flashes the wrong theme. Falls
// back to the OS preference for first-time visitors who have no cookie yet. The
// toggle (components/theme-toggle) keeps the cookie in sync afterwards.
const THEME_INIT_SCRIPT = `(function(){try{var m=document.cookie.match(/(?:^|; )theme=([^;]+)/);var t=m&&m[1];if(t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.classList.add('dark');}}catch(e){}})();`;

export default async function LocaleLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}>) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  // Enable static rendering for this locale segment.
  setRequestLocale(locale);

  return (
    <html
      lang={locale}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col bg-muted/30">
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <NextIntlClientProvider>
          <JobTrackerProvider>
            <SiteHeader />
            <main className="flex-1 flex flex-col">{children}</main>
          </JobTrackerProvider>
          <VersionWatcher />
          <Toaster richColors position="top-center" />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
