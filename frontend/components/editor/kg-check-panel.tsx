"use client";
// Knowledge-graph / deep-check panel. Opening it runs the whole-draft "full"
// check (combined graph + cross-section rules); this panel renders the SAME rich
// KGFlow view as the paper-analysis page (section-grouped entities, ego graph,
// relations) — minus the PDF/judgment bits a draft doesn't have. Cross-section
// defects flow to the defect panel.
import { Loader2, Network, RotateCw } from "lucide-react";
import { useTranslations } from "next-intl";

import type { AnalysisResult } from "@/lib/api";
import { useEditorStore } from "@/lib/editor-store";
import { KGFlowLoader } from "@/components/kg-flow-loader";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

export function KGCheckPanel({
  result,
  loading,
  summary,
  onRerun,
}: {
  result: AnalysisResult | null;
  loading: boolean;
  summary: { total: number; cross: number } | null;
  onRerun: () => void;
}) {
  const t = useTranslations("editor");
  const open = useEditorStore((s) => s.kgOpen);
  const close = useEditorStore((s) => s.closeKG);
  const openDefects = useEditorStore((s) => s.openDefects);

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
        // KGFlow is a two-pane layout (entity list + ego-graph aside); it needs
        // real width. Use the same data-side override the PDF sheet uses so it
        // beats the base `data-[side=right]:sm:max-w-sm`.
        className="flex w-full flex-col gap-0 data-[side=right]:w-[94vw] data-[side=right]:sm:max-w-[1000px]"
      >
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Network className="h-4 w-4" />
            {t("kg.panelTitle")}
          </SheetTitle>
          <SheetDescription>{t("kg.panelDesc")}</SheetDescription>
        </SheetHeader>

        <div className="flex items-center justify-between gap-2 px-4 pb-2">
          <div className="text-xs text-muted-foreground">
            {summary && !loading
              ? t("kg.summary", { total: summary.total, cross: summary.cross })
              : null}
            {summary && summary.total > 0 && !loading && (
              <button
                type="button"
                onClick={openDefects}
                className="ml-2 font-medium text-primary hover:underline"
              >
                {t("kg.seeDefects")}
              </button>
            )}
          </div>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 gap-1 px-2 text-xs"
            disabled={loading}
            onClick={onRerun}
          >
            <RotateCw className="h-3.5 w-3.5" />
            {t("kg.rerun")}
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto border-t px-3 pt-2">
          {loading ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              {t("kg.building")}
            </div>
          ) : result ? (
            <KGFlowLoader result={result} noPdf />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              {t("kg.empty")}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
