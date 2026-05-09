"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";

import { DefectPanel } from "@/components/defect-panel";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { pdfUrl, type AnalysisResult } from "@/lib/api";
import { defectsToCsv, downloadCsv } from "@/lib/csv";

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
  const [selectedDefectId, setSelectedDefectId] = useState<string | null>(null);
  const [focusedEduId, setFocusedEduId] = useState<string | null>(null);

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

  function handleSelectDefect(id: string | null) {
    setSelectedDefectId(id);
    if (id) {
      const d = result.defects.find((x) => x.id === id);
      const firstEdu = d?.evidence_edu_ids[0] ?? null;
      setFocusedEduId(firstEdu);
    } else {
      setFocusedEduId(null);
    }
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

  function handleExport() {
    const csv = defectsToCsv(result.defects, eduMap);
    const safeId = result.paper_id.replace(/[^\w-]/g, "_");
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsv(`defects_${safeId}_${stamp}.csv`, csv);
  }

  return (
    <div className="grid h-[calc(100vh-9rem)] gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(360px,2fr)]">
      <div className="min-h-[400px] min-w-0 lg:min-h-0">
        <PdfViewer
          pdfUrl={pdfUrl(result.paper_id)}
          highlights={highlights}
          focusedEduId={focusedEduId}
          onHighlightClick={handleHighlightClick}
        />
      </div>
      <div className="flex min-h-[300px] min-w-0 flex-col gap-2 lg:min-h-0">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm">
            <span className="font-semibold">{result.defects.length}</span>
            <span className="text-muted-foreground"> 個缺陷</span>
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
            disabled={result.defects.length === 0}
          >
            下載 CSV 報告
          </Button>
        </div>
        <div className="flex-1 min-h-0">
          <DefectPanel
            defects={result.defects}
            eduMap={eduMap}
            selectedId={selectedDefectId}
            onSelect={handleSelectDefect}
          />
        </div>
      </div>
    </div>
  );
}
