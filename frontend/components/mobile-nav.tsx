"use client";

import { MenuIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { GuardedLink } from "@/components/guarded-link";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Link } from "@/i18n/navigation";

const LINKS = [
  { href: "/", key: "upload" },
  { href: "/editor", key: "editor" },
  { href: "/papers", key: "history" },
  { href: "/stats", key: "ruleStats" },
  { href: "/changelog", key: "changelog" },
] as const;

// These routes are independent of an in-progress analysis, so they navigate
// directly instead of going through the analysis-guard prompt.
const UNGUARDED = new Set<string>(["/", "/editor"]);

export function MobileNav() {
  const [open, setOpen] = useState(false);
  const t = useTranslations("header");
  const tn = useTranslations("nav");
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={<Button variant="ghost" size="icon" aria-label={tn("menuAria")} />}
      >
        <MenuIcon className="h-5 w-5" />
      </SheetTrigger>
      <SheetContent side="right" className="w-64">
        <SheetHeader>
          <SheetTitle>{tn("menuTitle")}</SheetTitle>
        </SheetHeader>
        <nav className="flex flex-col gap-1 px-2">
          {LINKS.map((l) => {
            const cls =
              "rounded-md px-3 py-2.5 text-base transition-colors hover:bg-accent";
            const close = () => setOpen(false);
            // Unguarded routes (upload progress view, editor) navigate directly.
            return UNGUARDED.has(l.href) ? (
              <Link key={l.href} href={l.href} onClick={close} className={cls}>
                {t(l.key)}
              </Link>
            ) : (
              <GuardedLink
                key={l.href}
                href={l.href}
                onClick={close}
                className={cls}
              >
                {t(l.key)}
              </GuardedLink>
            );
          })}
        </nav>
      </SheetContent>
    </Sheet>
  );
}
