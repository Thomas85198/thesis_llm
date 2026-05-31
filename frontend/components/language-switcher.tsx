"use client";

import { Menu } from "@base-ui/react/menu";
import { Check, Globe } from "lucide-react";
import { useLocale } from "next-intl";
import { useTranslations } from "next-intl";
import { useTransition } from "react";

import { Button } from "@/components/ui/button";
import { usePathname, useRouter } from "@/i18n/navigation";
import { LOCALE_LABELS, LOCALES, type Locale } from "@/i18n/routing";
import { cn } from "@/lib/utils";

// Locale switcher for the header. Switching navigates to the same path under the
// new locale prefix; next-intl's middleware persists the choice in the
// NEXT_LOCALE cookie, so a later visit to "/" redirects to the chosen language.
export function LanguageSwitcher({ className }: { className?: string }) {
  const locale = useLocale() as Locale;
  const router = useRouter();
  const pathname = usePathname();
  const t = useTranslations("header");
  const [isPending, startTransition] = useTransition();

  function switchTo(next: Locale) {
    if (next === locale) return;
    startTransition(() => {
      router.replace(pathname, { locale: next });
    });
  }

  return (
    <Menu.Root>
      <Menu.Trigger
        render={
          <Button
            variant="ghost"
            size="sm"
            aria-label={t("language")}
            disabled={isPending}
            className={cn("gap-1.5", className)}
          />
        }
      >
        <Globe className="h-4 w-4 shrink-0" />
        <span className="hidden sm:inline">{LOCALE_LABELS[locale]}</span>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="end" sideOffset={6} className="z-50">
          <Menu.Popup className="min-w-36 rounded-md border bg-popover p-1 text-popover-foreground shadow-lg outline-none data-ending-style:opacity-0 data-starting-style:opacity-0">
            {LOCALES.map((l) => (
              <Menu.Item
                key={l}
                onClick={() => switchTo(l)}
                className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors data-highlighted:bg-accent data-highlighted:text-accent-foreground"
              >
                <Check
                  className={cn(
                    "h-4 w-4 shrink-0",
                    l === locale ? "opacity-100" : "opacity-0",
                  )}
                />
                {LOCALE_LABELS[l]}
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
