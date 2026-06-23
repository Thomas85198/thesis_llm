"use client";
// Knowledge-graph / deep-check panel. Opening it runs the whole-draft "full"
// check (combined graph + cross-section rules) in the editor; this panel shows
// the resulting concept graph. Cross-section defects flow to the defect panel.
import nextDynamic from "next/dynamic";
import { Loader2, Network, RotateCw } from "lucide-react";
import { useTranslations } from "next-intl";

import type { DraftGraph } from "@/lib/api";
import { useEditorStore } from "@/lib/editor-store";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

// React Flow is client-only; load it lazily so it never runs during SSR.
const KGGraph = nextDynamic(() => import("@/components/editor/kg-graph"), {
  ssr: false,
});

export function KGCheckPanel({
  graph,
  loading,
  summary,
  onRerun,
}: {
  graph: DraftGraph | null;
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
        className="flex w-full flex-col gap-0 sm:max-w-2xl"
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
              ? t("kg.summary", {
                  total: summary.total,
                  cross: summary.cross,
                })
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

        <div className="min-h-0 flex-1 border-t">
          {loading ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              {t("kg.building")}
            </div>
          ) : graph ? (
            <KGGraph graph={graph} />
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
