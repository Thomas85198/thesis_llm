"use client";
// Defect-check side panel. Lists the structural defects the Thesis Critic found
// in the draft (the wow feature: correctness checking at the point of writing).
// Each defect shows its rule, severity, description, suggestion and the cited
// sentence; clicking "locate" selects that sentence in the editor.
import type { Editor } from "@tiptap/core";
import { Loader2, MapPin, ShieldAlert } from "lucide-react";
import { useTranslations } from "next-intl";

import { useEditorStore } from "@/lib/editor-store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

const SEVERITY_CLS: Record<string, string> = {
  high: "border-red-300 bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300",
  medium: "border-amber-300 bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  low: "border-sky-300 bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300",
};

export function DefectPanel({ editor }: { editor: Editor }) {
  const t = useTranslations("editor");
  const open = useEditorStore((s) => s.defectOpen);
  const loading = useEditorStore((s) => s.defectLoading);
  const defects = useEditorStore((s) => s.defects);
  const closeDefects = useEditorStore((s) => s.closeDefects);

  return (
    <Sheet open={open} onOpenChange={(o) => !o && closeDefects()}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{t("defect.panelTitle")}</SheetTitle>
          <SheetDescription>{t("defect.panelDesc")}</SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col px-4 pb-4">
          {loading ? (
            <div className="flex flex-1 items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("defect.checking")}
            </div>
          ) : defects.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 py-10 text-center text-sm text-muted-foreground">
              <ShieldAlert className="h-5 w-5 opacity-60" />
              {t("defect.empty")}
            </div>
          ) : (
            <ScrollArea className="min-h-0 flex-1">
              <ul className="flex flex-col gap-2.5 pr-3">
                {defects.map((d, i) => (
                  <li key={i} className="rounded-lg border bg-card p-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant="outline" className="font-mono text-[10px]">
                        {d.rule_id}
                      </Badge>
                      <span
                        className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${
                          SEVERITY_CLS[d.severity] ?? SEVERITY_CLS.low
                        }`}
                      >
                        {t(`defect.severity.${d.severity}`)}
                      </span>
                      {d.confidence != null && (
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {Math.round(d.confidence * 100)}%
                        </span>
                      )}
                    </div>
                    <p className="mt-1.5 text-sm leading-snug">{d.description}</p>
                    {d.evidence[0] && (
                      <p className="mt-1.5 border-l-2 border-muted-foreground/30 pl-2 text-xs italic text-muted-foreground">
                        「{d.evidence[0]}」
                      </p>
                    )}
                    {d.suggestion && (
                      <p className="mt-1.5 rounded bg-muted/60 p-2 text-xs">
                        <span className="font-medium">{t("defect.suggestionLabel")}</span>
                        {d.suggestion}
                      </p>
                    )}
                    {d.evidence[0] && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="mt-1.5 h-7 gap-1 px-2 text-xs"
                        onClick={() => editor.commands.focusDefect(d.evidence[0])}
                      >
                        <MapPin className="h-3.5 w-3.5" />
                        {t("defect.locate")}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </ScrollArea>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
