"use client";
// Lint panel: lists the rule-based writing issues (half-width punctuation, CJK↔
// Latin spacing, space before punctuation) with a one-click fix each + fix-all.
// Non-modal so you can keep editing while cleaning up. No token cost.
import type { Editor } from "@tiptap/core";
import { Check, MapPin, Sparkles, Wand2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { lintDoc, type LintIssue, type LintType } from "@/lib/lint";
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

const TYPE_CLS: Record<LintType, string> = {
  halfPunct: "border-amber-300 text-amber-700 dark:text-amber-300",
  pangu: "border-sky-300 text-sky-700 dark:text-sky-300",
  spaceBeforePunct: "border-violet-300 text-violet-700 dark:text-violet-300",
};

export function LintPanel({ editor }: { editor: Editor }) {
  const t = useTranslations("editor");
  const open = useEditorStore((s) => s.lintOpen);
  const close = useEditorStore((s) => s.closeLint);
  const [issues, setIssues] = useState<LintIssue[]>([]);

  useEffect(() => {
    if (!open) return;
    editor.commands.setLintEnabled(true);
    const recompute = () => setIssues(lintDoc(editor.state.doc));
    recompute();
    editor.on("update", recompute);
    return () => {
      editor.off("update", recompute);
      editor.commands.setLintEnabled(false);
    };
  }, [open, editor]);

  // A short context snippet so a bare punctuation issue is legible.
  const context = (i: LintIssue) => {
    const size = editor.state.doc.content.size;
    const a = Math.max(0, i.from - 12);
    const b = Math.min(size, i.to + 12);
    return editor.state.doc.textBetween(a, b, " ", " ");
  };

  return (
    <Sheet
      open={open}
      modal={false}
      disablePointerDismissal
      onOpenChange={(o) => !o && close()}
    >
      <SheetContent
        side="right"
        overlay={false}
        className="flex w-full flex-col gap-0 sm:max-w-md"
      >
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" />
            {t("lint.panelTitle")}
          </SheetTitle>
          <SheetDescription>{t("lint.panelDesc")}</SheetDescription>
        </SheetHeader>

        <div className="flex items-center justify-between gap-2 px-4 pb-2 text-xs text-muted-foreground">
          <span>{t("lint.count", { n: issues.length })}</span>
          {issues.length > 0 && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="h-7 gap-1 px-2 text-xs"
              onClick={() => editor.commands.applyAllLintFixes()}
            >
              <Wand2 className="h-3.5 w-3.5" />
              {t("lint.fixAll")}
            </Button>
          )}
        </div>

        <div className="flex min-h-0 flex-1 flex-col px-4 pb-4">
          {issues.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 py-10 text-center text-sm text-muted-foreground">
              <Check className="h-5 w-5 opacity-60" />
              {t("lint.clean")}
            </div>
          ) : (
            <ScrollArea className="min-h-0 flex-1">
              <ul className="flex flex-col gap-2 pr-3">
                {issues.map((i, idx) => (
                  <li key={idx} className="rounded-lg border bg-card p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <Badge
                        variant="outline"
                        className={`text-[10px] ${TYPE_CLS[i.type]}`}
                      >
                        {t(`lint.type.${i.type}`)}
                      </Badge>
                      <div className="flex gap-1">
                        <button
                          type="button"
                          title={t("lint.locate")}
                          onClick={() =>
                            editor.commands.focusLint(i.from, i.to)
                          }
                          className="rounded p-1 text-muted-foreground transition hover:bg-accent hover:text-foreground"
                        >
                          <MapPin className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            editor.commands.applyLintFix(
                              i.from,
                              i.to,
                              i.replacement,
                            )
                          }
                          className="rounded bg-primary px-2 py-0.5 text-[11px] font-medium text-primary-foreground transition hover:opacity-90"
                        >
                          {t("lint.fix")}
                        </button>
                      </div>
                    </div>
                    <p className="mt-1.5 text-xs leading-snug text-muted-foreground">
                      …{context(i)}…
                    </p>
                    <p className="mt-1 font-mono text-[11px]">
                      <span className="rounded bg-red-500/15 px-1">
                        {i.original.replace(/ /g, "␣") || "␣"}
                      </span>
                      {" → "}
                      <span className="rounded bg-emerald-500/15 px-1">
                        {i.replacement.replace(/ /g, "␣") || "∅"}
                      </span>
                    </p>
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
