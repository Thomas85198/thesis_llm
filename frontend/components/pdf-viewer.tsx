"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";

import { Skeleton } from "@/components/ui/skeleton";

// Use the same pdfjs version that react-pdf bundles, served from CDN.
pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

type Highlight = {
  edu_id: string;
  page: number;
  bbox: [number, number, number, number];
  severity?: "high" | "medium" | "low";
};

type Props = {
  pdfUrl: string;
  highlights?: Highlight[];
  /** Highlight to scroll into view & flash. Triggered when this id changes. */
  focusedEduId?: string | null;
  /** Optional: notify parent when user clicks a highlight on the PDF. */
  onHighlightClick?: (eduId: string) => void;
};

const SEVERITY_COLORS: Record<NonNullable<Highlight["severity"]>, string> = {
  high: "rgba(239,68,68,0.30)",
  medium: "rgba(249,115,22,0.30)",
  low: "rgba(234,179,8,0.30)",
};

export function PdfViewer({
  pdfUrl,
  highlights = [],
  focusedEduId,
  onHighlightClick,
}: Props) {
  const [numPages, setNumPages] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  // page index → natural width/height (PDF points)
  const [pageDims, setPageDims] = useState<Record<number, { w: number; h: number }>>({});
  const containerRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const [renderWidth, setRenderWidth] = useState(0);

  // Track container width with ResizeObserver for RWD.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setRenderWidth(Math.max(280, Math.min(900, w - 16)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Group highlights by page for cheap per-page rendering.
  const highlightsByPage = useMemo(() => {
    const map = new Map<number, Highlight[]>();
    for (const h of highlights) {
      if (!map.has(h.page)) map.set(h.page, []);
      map.get(h.page)!.push(h);
    }
    return map;
  }, [highlights]);

  // Scroll focused highlight into view + flash. Depends on pageDims too so that
  // when the viewer is freshly mounted (e.g. opened in a drawer) the scroll
  // re-runs once the target page has loaded and its ref is populated.
  useEffect(() => {
    if (!focusedEduId) return;
    const target = highlights.find((h) => h.edu_id === focusedEduId);
    if (!target) return;
    const pageEl = pageRefs.current[target.page];
    if (pageEl) {
      pageEl.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [focusedEduId, highlights, pageDims]);

  const handlePageLoad = useCallback(
    (pageIdx: number) =>
      (page: { originalWidth: number; originalHeight: number }) => {
        setPageDims((prev) =>
          prev[pageIdx]
            ? prev
            : {
                ...prev,
                [pageIdx]: { w: page.originalWidth, h: page.originalHeight },
              }
        );
      },
    []
  );

  return (
    <div
      ref={containerRef}
      className="h-full w-full overflow-y-auto rounded-md border bg-muted/40"
    >
      {loadError ? (
        <div className="flex h-full items-center justify-center p-4 text-sm text-destructive">
          {loadError}
        </div>
      ) : (
        <Document
          file={pdfUrl}
          onLoadSuccess={({ numPages: n }) => setNumPages(n)}
          onLoadError={(e) => setLoadError(e.message)}
          loading={
            <div className="space-y-3 p-4">
              <Skeleton className="h-8 w-1/2" />
              <Skeleton className="h-[600px] w-full" />
            </div>
          }
          className="flex flex-col items-center gap-3 py-3"
        >
          {Array.from({ length: numPages }, (_, i) => {
            const dims = pageDims[i];
            const scale = dims && renderWidth ? renderWidth / dims.w : 1;
            const pageHighlights = highlightsByPage.get(i) ?? [];

            return (
              <div
                key={i}
                ref={(el) => {
                  pageRefs.current[i] = el;
                }}
                className="relative shadow-sm"
              >
                <Page
                  pageNumber={i + 1}
                  width={renderWidth || undefined}
                  renderTextLayer={false}
                  renderAnnotationLayer={false}
                  onLoadSuccess={handlePageLoad(i)}
                />
                {dims &&
                  pageHighlights.map((h) => {
                    const [x0, y0, x1, y1] = h.bbox;
                    const isFocused = focusedEduId === h.edu_id;
                    return (
                      <button
                        key={h.edu_id}
                        type="button"
                        onClick={() => onHighlightClick?.(h.edu_id)}
                        className="absolute cursor-pointer transition-all hover:opacity-100"
                        style={{
                          left: x0 * scale,
                          top: y0 * scale,
                          width: Math.max(8, (x1 - x0) * scale),
                          height: Math.max(8, (y1 - y0) * scale),
                          background: SEVERITY_COLORS[h.severity ?? "medium"],
                          border: isFocused
                            ? "2px solid rgb(220,38,38)"
                            : "1px solid rgba(0,0,0,0.10)",
                          borderRadius: 2,
                          boxShadow: isFocused
                            ? "0 0 0 4px rgba(239,68,68,0.20)"
                            : undefined,
                          opacity: isFocused ? 1 : 0.85,
                        }}
                        aria-label={`EDU ${h.edu_id}`}
                      />
                    );
                  })}
              </div>
            );
          })}
        </Document>
      )}
    </div>
  );
}
