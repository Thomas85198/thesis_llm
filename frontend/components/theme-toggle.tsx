"use client";

import { Moon, Sun } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Light/dark toggle. The current theme lives in the `theme` cookie (read by the
// blocking init script in the root layout, so there's no flash on reload). We
// flip the `.dark` class on <html> directly and mirror it into the cookie —
// icon visibility is pure CSS (dark: variants), so there is no React state and
// therefore no hydration mismatch with the server-rendered markup.
export function ThemeToggle({ className }: { className?: string }) {
  const t = useTranslations("header");

  function toggle() {
    const isDark = document.documentElement.classList.toggle("dark");
    document.cookie = `theme=${isDark ? "dark" : "light"};path=/;max-age=31536000;samesite=lax`;
  }

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={toggle}
      aria-label={t("theme")}
      className={cn(className)}
    >
      <Sun className="h-4 w-4 dark:hidden" />
      <Moon className="hidden h-4 w-4 dark:block" />
    </Button>
  );
}
