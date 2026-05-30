"use client";

import { MenuIcon } from "lucide-react";
import Link from "next/link";
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

const LINKS = [
  { href: "/", label: "上傳" },
  { href: "/papers", label: "歷史" },
  { href: "/stats", label: "規則統計" },
  { href: "/changelog", label: "版本紀錄" },
];

export function MobileNav() {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={<Button variant="ghost" size="icon" aria-label="選單" />}
      >
        <MenuIcon className="h-5 w-5" />
      </SheetTrigger>
      <SheetContent side="right" className="w-64">
        <SheetHeader>
          <SheetTitle>選單</SheetTitle>
        </SheetHeader>
        <nav className="flex flex-col gap-1 px-2">
          {LINKS.map((l) => {
            const cls =
              "rounded-md px-3 py-2.5 text-base transition-colors hover:bg-accent";
            const close = () => setOpen(false);
            // "/" goes to the progress view itself, so it never needs a guard.
            return l.href === "/" ? (
              <Link key={l.href} href={l.href} onClick={close} className={cls}>
                {l.label}
              </Link>
            ) : (
              <GuardedLink
                key={l.href}
                href={l.href}
                onClick={close}
                className={cls}
              >
                {l.label}
              </GuardedLink>
            );
          })}
        </nav>
      </SheetContent>
    </Sheet>
  );
}
