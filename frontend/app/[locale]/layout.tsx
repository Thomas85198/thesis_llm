import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { setRequestLocale } from "next-intl/server";

import { JobTrackerProvider } from "@/components/job-tracker";
import { PWARegister } from "@/components/pwa-register";
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
  // PWA: installable on tablets (Add to Home Screen → standalone fullscreen).
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "論文檢核" },
  icons: { apple: "/apple-icon-180.png" },
  // Legacy iOS standalone flag (older iPadOS that doesn't yet honor the
  // manifest's display:standalone for Add to Home Screen).
  other: { "apple-mobile-web-app-capable": "yes" },
};

// theme_color / viewport for the standalone app shell (status bar tint on iPad).
export const viewport: Viewport = {
  themeColor: "#4F46E5",
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

// First-visit fallback only. When the user has already chosen a theme we render
// the `.dark` class on <html> server-side (see below), so a reload never flashes.
// This blocking <head> script covers the no-cookie case: it follows the OS
// preference before first paint. The toggle keeps the cookie in sync afterwards.
const THEME_INIT_SCRIPT = `(function(){try{if(!/(?:^|; )theme=/.test(document.cookie)&&window.matchMedia('(prefers-color-scheme: dark)').matches){document.documentElement.classList.add('dark');}}catch(e){}})();`;

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
  setRequestLocale(locale);

  // Read the saved theme server-side so the SSR'd <html> already carries `.dark`
  // — the reload paints the correct theme from the very first frame, no flash.
  const isDark = (await cookies()).get("theme")?.value === "dark";

  return (
    <html
      lang={locale}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased${
        isDark ? " dark" : ""
      }`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col bg-muted/30">
        <NextIntlClientProvider>
          <JobTrackerProvider>
            <SiteHeader />
            <main className="flex-1 flex flex-col">{children}</main>
          </JobTrackerProvider>
          <VersionWatcher />
          <PWARegister />
          <Toaster richColors position="top-center" />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
