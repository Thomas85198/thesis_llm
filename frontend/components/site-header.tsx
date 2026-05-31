import { useTranslations } from "next-intl";

import { GuardedLink } from "@/components/guarded-link";
import { JobIndicator } from "@/components/job-indicator";
import { LanguageSwitcher } from "@/components/language-switcher";
import { MobileNav } from "@/components/mobile-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { CURRENT_VERSION } from "@/lib/version-log";

export function SiteHeader() {
  const t = useTranslations("header");
  return (
    <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="mx-auto flex h-14 w-full max-w-7xl items-center gap-4 px-4 sm:px-6">
        <Link href="/" aria-label={t("appNameAria")} className="flex items-center">
          <svg
            viewBox="0 0 32 32"
            className="h-7 w-7 shrink-0"
            fill="none"
            aria-hidden="true"
          >
            <rect width="32" height="32" rx="7" fill="#4F46E5" />
            <path
              d="M12 6H17L22 11V23A2 2 0 0 1 20 25H12A2 2 0 0 1 10 23V8A2 2 0 0 1 12 6Z"
              fill="#FFFFFF"
            />
            <path d="M17 6L22 11H17V6Z" fill="#C7D2FE" />
            <path
              d="M13.2 16.9L15.7 19.4L20.2 14.2"
              stroke="#4F46E5"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </Link>
        <GuardedLink href="/changelog" title={t("versionTitle")}>
          <Badge
            variant="secondary"
            className="font-mono text-[10px] transition-colors hover:bg-accent"
          >
            v{CURRENT_VERSION}
          </Badge>
        </GuardedLink>
        <JobIndicator />
        <nav className="ml-auto hidden items-center gap-1 sm:flex">
          <Link href="/" className={buttonVariants({ variant: "ghost", size: "sm" })}>
            {t("upload")}
          </Link>
          <GuardedLink
            href="/papers"
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            {t("history")}
          </GuardedLink>
          <GuardedLink
            href="/stats"
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            {t("ruleStats")}
          </GuardedLink>
          <GuardedLink
            href="/changelog"
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            {t("changelog")}
          </GuardedLink>
          <ThemeToggle />
          <LanguageSwitcher />
        </nav>
        <div className="ml-auto flex items-center gap-1 sm:hidden">
          <ThemeToggle />
          <LanguageSwitcher />
          <MobileNav />
        </div>
      </div>
    </header>
  );
}
