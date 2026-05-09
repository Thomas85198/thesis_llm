"use client";

import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { Defect, EDU, Severity } from "@/lib/api";

const SEVERITY_LABEL: Record<Severity, string> = {
  high: "高",
  medium: "中",
  low: "低",
};

const SEVERITY_BORDER: Record<Severity, string> = {
  high: "border-l-red-500",
  medium: "border-l-orange-500",
  low: "border-l-yellow-500",
};

const SEVERITY_BADGE: Record<Severity, string> = {
  high: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  medium: "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300",
  low: "bg-yellow-100 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-300",
};

type Props = {
  defects: Defect[];
  /** Map from EDU id → EDU (for resolving evidence text). */
  eduMap: Map<string, EDU>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
};

export function DefectPanel({ defects, eduMap, selectedId, onSelect }: Props) {
  if (defects.length === 0) {
    return (
      <div className="flex h-full items-center justify-center rounded-md border bg-muted/30 p-6 text-center">
        <p className="text-sm text-muted-foreground">沒有發現缺陷 🎉</p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full rounded-md border">
      <div className="space-y-2 p-2">
        {defects.map((d) => {
          const isSelected = selectedId === d.id;
          const evidenceTexts = d.evidence_edu_ids
            .map((eid) => eduMap.get(eid)?.text)
            .filter((t): t is string => Boolean(t));

          return (
            <button
              key={d.id}
              type="button"
              onClick={() => onSelect(isSelected ? null : d.id)}
              className={cn(
                "block w-full border-l-4 bg-card p-3 text-left transition-colors hover:bg-accent",
                SEVERITY_BORDER[d.severity],
                isSelected && "bg-accent ring-2 ring-primary/40"
              )}
            >
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant="outline" className="font-mono text-[10px]">
                  {d.rule_id}
                </Badge>
                <span className="text-sm font-semibold">{d.defect_type}</span>
                <span
                  className={cn(
                    "rounded px-1.5 py-0.5 text-[10px] font-medium",
                    SEVERITY_BADGE[d.severity]
                  )}
                >
                  {SEVERITY_LABEL[d.severity]}嚴重
                </span>
                <Badge variant="secondary" className="text-[10px]">
                  {d.section}
                </Badge>
              </div>

              {evidenceTexts.length > 0 && (
                <div className="mt-2 space-y-1 border-l-2 border-muted-foreground/30 pl-3">
                  {evidenceTexts.map((t, i) => (
                    <p
                      key={i}
                      className="text-xs italic leading-relaxed text-muted-foreground line-clamp-3"
                    >
                      「{t.trim()}」
                    </p>
                  ))}
                </div>
              )}

              <p className="mt-2 text-sm leading-relaxed">{d.description}</p>

              <div className="mt-2 rounded bg-muted/60 p-2 text-xs leading-relaxed">
                <span className="font-semibold">建議：</span>
                {d.suggestion}
              </div>

              {d.evidence_edu_ids.length > 0 && (
                <p className="mt-2 text-[10px] text-muted-foreground">
                  → 點擊以在 PDF 標出 {d.evidence_edu_ids.length} 處證據
                </p>
              )}
            </button>
          );
        })}
      </div>
    </ScrollArea>
  );
}
