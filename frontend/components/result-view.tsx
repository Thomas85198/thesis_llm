"use client";

import dynamic from "next/dynamic";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { ChatDrawer } from "@/components/chat-drawer";
import { DefectPanel } from "@/components/defect-panel";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  deleteJudgment,
  fetchJudgments,
  pdfUrl,
  submitJudgment,
  type AnalysisResult,
  type Verdict,
} from "@/lib/api";
import { defectsToCsv, downloadCsv } from "@/lib/csv";
import { cn } from "@/lib/utils";

// react-pdf must be client-only (touches window).
const PdfViewer = dynamic(
  () => import("@/components/pdf-viewer").then((m) => m.PdfViewer),
  {
    ssr: false,
    loading: () => (
      <div className="space-y-3 p-4">
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-[600px] w-full" />
      </div>
    ),
  }
);

export function ResultView({ result }: { result: AnalysisResult }) {
  const t = useTranslations("defects");
  const locale = useLocale();
  const [selectedDefectId, setSelectedDefectId] = useState<string | null>(null);
  const [focusedEduId, setFocusedEduId] = useState<string | null>(null);
  const [judgments, setJudgments] = useState<Map<string, Verdict>>(new Map());

  const eduMap = useMemo(
    () => new Map(result.graph.edus.map((e) => [e.id, e])),
    [result]
  );

  const selectedDefect = useMemo(
    () => result.defects.find((d) => d.id === selectedDefectId) ?? null,
    [result.defects, selectedDefectId]
  );

  const highlights = useMemo(() => {
    if (!selectedDefect) return [];
    return selectedDefect.evidence_edu_ids
      .map((eid) => {
        const edu = eduMap.get(eid);
        if (!edu) return null;
        return {
          edu_id: edu.id,
          page: edu.page,
          bbox: edu.bbox,
          severity: selectedDefect.severity,
        };
      })
      .filter((h): h is NonNullable<typeof h> => h !== null);
  }, [selectedDefect, eduMap]);

  // Load existing judgments once.
  useEffect(() => {
    let cancelled = false;
    fetchJudgments(result.paper_id)
      .then((items) => {
        if (cancelled) return;
        const m = new Map<string, Verdict>();
        for (const j of items) m.set(j.defect_id, j.verdict);
        setJudgments(m);
      })
      .catch(() => {
        // Best-effort; missing judgments shouldn't block the page.
      });
    return () => {
      cancelled = true;
    };
  }, [result.paper_id]);

  function handleSelectDefect(id: string | null) {
    // Only toggle selection — don't auto-scroll PDF. PDF jump is now an
    // explicit user action via the "在 PDF 中查看" button on the selected
    // card, so reading the full evidence inline doesn't yank the viewport.
    setSelectedDefectId(id);
    if (!id) {
      setFocusedEduId(null);
    }
  }

  function handleJumpToPdf(defectId: string) {
    const d = result.defects.find((x) => x.id === defectId);
    const firstEdu = d?.evidence_edu_ids[0] ?? null;
    if (firstEdu) setFocusedEduId(firstEdu);
  }

  function handleHighlightClick(eduId: string) {
    const owner = result.defects.find((d) =>
      d.evidence_edu_ids.includes(eduId)
    );
    if (owner) {
      setSelectedDefectId(owner.id);
      setFocusedEduId(eduId);
    }
  }

  // Chat assistant cites [EDU:xxx] / [DEFECT:xxx] — clicking a citation should
  // jump the PDF viewer / defect panel to that location.
  function handleChatEduClick(eduId: string) {
    if (!eduMap.has(eduId)) {
      toast.error(t("notFoundEdu"));
      return;
    }
    setFocusedEduId(eduId);
    const owner = result.defects.find((d) =>
      d.evidence_edu_ids.includes(eduId)
    );
    if (owner) setSelectedDefectId(owner.id);
  }

  function handleChatDefectClick(defectId: string) {
    const d = result.defects.find((x) => x.id === defectId);
    if (!d) {
      toast.error(t("notFoundDefect"));
      return;
    }
    setSelectedDefectId(d.id);
    setFocusedEduId(d.evidence_edu_ids[0] ?? null);
  }

  async function handleJudge(
    defectId: string,
    ruleId: string,
    verdict: Verdict | null
  ) {
    // Optimistic update.
    setJudgments((prev) => {
      const next = new Map(prev);
      if (verdict === null) next.delete(defectId);
      else next.set(defectId, verdict);
      return next;
    });

    try {
      if (verdict === null) {
        await deleteJudgment(result.paper_id, defectId);
      } else {
        await submitJudgment(result.paper_id, {
          defect_id: defectId,
          rule_id: ruleId,
          verdict,
        });
      }
    } catch (err) {
      toast.error(t("saveJudgeFailed"), {
        description: err instanceof Error ? err.message : String(err),
      });
      // Roll back: re-fetch to recover server state.
      try {
        const items = await fetchJudgments(result.paper_id);
        const m = new Map<string, Verdict>();
        for (const j of items) m.set(j.defect_id, j.verdict);
        setJudgments(m);
      } catch {
        // ignore
      }
    }
  }

  function handleExport() {
    const csv = defectsToCsv(result.defects, eduMap, locale);
    const safeId = result.paper_id.replace(/[^\w-]/g, "_");
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsv(`defects_${safeId}_${stamp}.csv`, csv);
  }

  // Judgment progress stats
  const judgedCount = result.defects.filter((d) => judgments.has(d.id)).length;
  const correctCount = result.defects.filter(
    (d) => judgments.get(d.id) === "correct"
  ).length;
  const wrongCount = result.defects.filter(
    (d) => judgments.get(d.id) === "wrong"
  ).length;
  const partialCount = result.defects.filter(
    (d) => judgments.get(d.id) === "partial"
  ).length;

  return (
    <div
      className={cn(
        "gap-3 flex flex-col",
        // 桌面：固定高度兩欄、外層 clip — 每欄各自內部 scroll，PDF 釘左邊不動。
        "lg:grid lg:h-[calc(100vh-5rem)] lg:grid-cols-[minmax(0,3fr)_minmax(360px,2fr)] lg:overflow-hidden"
      )}
    >
      <ChatDrawer
        paperId={result.paper_id}
        onEduClick={handleChatEduClick}
        onDefectClick={handleChatDefectClick}
      />
      <div className="min-h-[400px] min-w-0 lg:min-h-0 lg:overflow-hidden">
        <PdfViewer
          pdfUrl={pdfUrl(result.paper_id)}
          highlights={highlights}
          focusedEduId={focusedEduId}
          onHighlightClick={handleHighlightClick}
        />
      </div>
      <div className="flex min-h-[300px] min-w-0 flex-col gap-2 lg:min-h-0 lg:overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span>
              <span className="font-semibold">{result.defects.length}</span>
              <span className="text-muted-foreground"> {t("countSuffix")}</span>
            </span>
            {result.defects.length > 0 && (
              <span className="text-xs text-muted-foreground">
                ·{" "}
                {t("judgedProgress", {
                  judged: judgedCount,
                  total: result.defects.length,
                })}
                {judgedCount > 0 && (
                  <>
                    {" "}
                    {t("verdictBreakdown", {
                      correct: correctCount,
                      partial: partialCount,
                      wrong: wrongCount,
                    })}
                  </>
                )}
              </span>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
            disabled={result.defects.length === 0}
          >
            {t("downloadCsv")}
          </Button>
        </div>
        <div className="flex-1 min-h-0">
          <DefectPanel
            defects={result.defects}
            eduMap={eduMap}
            selectedId={selectedDefectId}
            onSelect={handleSelectDefect}
            onJumpToPdf={handleJumpToPdf}
            onFocusEdu={handleHighlightClick}
            judgments={judgments}
            onJudge={handleJudge}
          />
        </div>
      </div>
    </div>
  );
}
