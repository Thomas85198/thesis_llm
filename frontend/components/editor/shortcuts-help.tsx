"use client";
// Keyboard-shortcuts cheat sheet. Lists the StarterKit defaults plus our custom
// editor shortcuts (⌘J ghost text, Tab accept, / slash menu). The modifier key
// label adapts to the platform (⌘ on macOS, Ctrl elsewhere).
import { Keyboard } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { useEditorStore } from "@/lib/editor-store";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

export function ShortcutsHelp() {
  const t = useTranslations("editor");
  const open = useEditorStore((s) => s.shortcutsOpen);
  const close = useEditorStore((s) => s.closeShortcuts);
  const [mod, setMod] = useState("⌘");

  useEffect(() => {
    const mac =
      typeof navigator !== "undefined" &&
      /Mac|iPhone|iPad/.test(navigator.platform);
    if (!mac) setMod("Ctrl");
  }, []);

  const groups: { title: string; items: [string, string][] }[] = [
    {
      title: t("shortcuts.groupFormat"),
      items: [
        [`${mod} B`, t("shortcuts.bold")],
        [`${mod} I`, t("shortcuts.italic")],
        [`${mod} E`, t("shortcuts.code")],
        [`${mod} ⇧ S`, t("shortcuts.strike")],
      ],
    },
    {
      title: t("shortcuts.groupBlocks"),
      items: [
        [`${mod} ⌥ 1/2/3`, t("shortcuts.heading")],
        [`${mod} ⇧ 7`, t("shortcuts.orderedList")],
        [`${mod} ⇧ 8`, t("shortcuts.bulletList")],
        ["/", t("shortcuts.slash")],
      ],
    },
    {
      title: t("shortcuts.groupAI"),
      items: [
        [`${mod} J`, t("shortcuts.aiSuggest")],
        ["Tab", t("shortcuts.acceptGhost")],
        ["Esc", t("shortcuts.dismiss")],
      ],
    },
    {
      title: t("shortcuts.groupEdit"),
      items: [
        [`${mod} Z`, t("shortcuts.undo")],
        [`${mod} ⇧ Z`, t("shortcuts.redo")],
        [`${mod} F`, t("shortcuts.find")],
      ],
    },
  ];

  return (
    <Sheet open={open} onOpenChange={(o) => !o && close()}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 sm:max-w-md"
      >
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Keyboard className="h-4 w-4" />
            {t("shortcuts.title")}
          </SheetTitle>
          <SheetDescription>{t("shortcuts.desc")}</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-4 overflow-y-auto px-4 pb-4">
          {groups.map((g) => (
            <div key={g.title}>
              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {g.title}
              </h3>
              <ul className="flex flex-col gap-1.5">
                {g.items.map(([k, label]) => (
                  <li
                    key={k}
                    className="flex items-center justify-between gap-3 text-sm"
                  >
                    <span className="min-w-0">{label}</span>
                    <kbd className="shrink-0 rounded border bg-muted px-1.5 py-0.5 font-mono text-xs">
                      {k}
                    </kbd>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
