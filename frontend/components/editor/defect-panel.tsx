"use client";
// Defect-check side panel. Lists the structural defects the Thesis Critic found
// in the draft (the wow feature: correctness checking at the point of writing).
// Each defect shows its rule, severity, description, suggestion and the cited
// sentence; clicking "locate" selects that sentence in the editor.
import type { Editor } from "@tiptap/core";
import { Loader2, MapPin, ShieldAlert, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { useEditorStore } from "@/lib/editor-store";
import { Badge } from "@/components/ui/badge";
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
  medium:
    "border-amber-300 bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  low: "border-sky-300 bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300",
};

export function DefectPanel({
  editor,
  onCancel,
}: {
  editor: Editor;
  onCancel?: () => void;
}) {
  const t = useTranslations("editor");
  const open = useEditorStore((s) => s.defectOpen);
  const loading = useEditorStore((s) => s.defectLoading);
  const defects = useEditorStore((s) => s.defects);
  const closeDefects = useEditorStore((s) => s.closeDefects);
  const openRewrite = useEditorStore((s) => s.openRewrite);
  const [activeIdx, setActiveIdx] = useState<number | null>(null);

  // A fresh check / reopen resets which card is focused.
  useEffect(() => {
    setActiveIdx(null);
  }, [defects]);

  const locate = (i: number, sentence: string) => {
    setActiveIdx(i);
    editor.commands.focusDefect(sentence);
  };

  // "AI fix": locate the evidence sentence (reusing focusDefect's span search),
  // then hand its range + an instruction built from this defect to the rewrite
  // panel — the author previews the AI fix before it replaces the sentence.
  const applyFix = (i: number, d: (typeof defects)[number]) => {
    const sentence = d.evidence[0];
    if (!sentence) return;
    if (!editor.commands.focusDefect(sentence)) {
      toast.error(t("defect.fixNotFound"));
      return;
    }
    setActiveIdx(i);
    const { from, to } = editor.state.selection;
    openRewrite(
      editor.state.doc.textBetween(from, to),
      from,
      to,
      t("defect.fixInstruction", {
        description: d.description,
        suggestion: d.suggestion,
      }),
    );
  };

  return (
    // Non-modal + no pointer-dismissal: the author can keep editing the doc
    // (deselect, fix the sentence, re-run the check) while the panel stays open
    // — it only closes via the ✕ or Escape.
    <Sheet
      open={open}
      modal={false}
      disablePointerDismissal
      onOpenChange={(o) => {
        if (!o) {
          editor.commands.clearDefectFocus();
          closeDefects();
        }
      }}
    >
      <SheetContent
        side="right"
        overlay={false}
        className="flex w-full flex-col gap-0 sm:max-w-md"
      >
        <SheetHeader>
          <SheetTitle>{t("defect.panelTitle")}</SheetTitle>
          <SheetDescription>{t("defect.panelDesc")}</SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col px-4 pb-4">
          {/* Loading is a top bar (with cancel) so previous results stay visible
              while a new check runs — re-checking never blanks the panel. */}
          {loading && (
            <div className="mb-2 flex items-center justify-between gap-2 rounded-md border bg-muted/50 px-3 py-1.5 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {t("defect.checking")}
              </span>
              {onCancel && (
                <button
                  type="button"
                  onClick={onCancel}
                  className="rounded px-1.5 py-0.5 font-medium text-foreground hover:bg-accent"
                >
                  {t("defect.cancel")}
                </button>
              )}
            </div>
          )}
          {defects.length === 0 ? (
            loading ? null : (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 py-10 text-center text-sm text-muted-foreground">
                <ShieldAlert className="h-5 w-5 opacity-60" />
                {t("defect.empty")}
              </div>
            )
          ) : (
            <ScrollArea className="min-h-0 flex-1">
              <ul
                className="flex flex-col gap-2.5 pr-3"
                onMouseLeave={() => editor.commands.setHoverDefect(null)}
              >
                {defects.map((d, i) => (
                  <li
                    key={i}
                    role={d.evidence[0] ? "button" : undefined}
                    tabIndex={d.evidence[0] ? 0 : undefined}
                    onClick={() => d.evidence[0] && locate(i, d.evidence[0])}
                    onMouseEnter={() =>
                      d.evidence[0] &&
                      editor.commands.setHoverDefect(d.evidence[0])
                    }
                    onKeyDown={(e) => {
                      if (
                        d.evidence[0] &&
                        (e.key === "Enter" || e.key === " ")
                      ) {
                        e.preventDefault();
                        locate(i, d.evidence[0]);
                      }
                    }}
                    className={`rounded-lg border bg-card p-3 transition-colors ${
                      d.evidence[0] ? "cursor-pointer hover:bg-accent/50" : ""
                    } ${
                      activeIdx === i
                        ? "border-primary/60 ring-1 ring-primary/40"
                        : ""
                    }`}
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge
                        variant="outline"
                        className="font-mono text-[10px]"
                      >
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
                    <p className="mt-1.5 text-sm leading-snug">
                      {d.description}
                    </p>
                    {d.evidence[0] && (
                      <p className="mt-1.5 border-l-2 border-muted-foreground/30 pl-2 text-xs italic text-muted-foreground">
                        「{d.evidence[0]}」
                      </p>
                    )}
                    {d.suggestion && (
                      <p className="mt-1.5 rounded bg-muted/60 p-2 text-xs">
                        <span className="font-medium">
                          {t("defect.suggestionLabel")}
                        </span>
                        {d.suggestion}
                      </p>
                    )}
                    {d.evidence[0] && (
                      <div className="mt-1.5 flex items-center gap-3">
                        <span
                          className={`inline-flex items-center gap-1 text-xs ${
                            activeIdx === i
                              ? "text-primary"
                              : "text-muted-foreground"
                          }`}
                        >
                          <MapPin className="h-3.5 w-3.5" />
                          {activeIdx === i
                            ? t("defect.located")
                            : t("defect.locate")}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            applyFix(i, d);
                          }}
                          className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                        >
                          <Sparkles className="h-3.5 w-3.5" />
                          {t("defect.applyFix")}
                        </button>
                      </div>
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
