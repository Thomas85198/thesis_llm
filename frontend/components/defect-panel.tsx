"use client";

import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { Defect, EDU, Severity, Verdict } from "@/lib/api";

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

const VERDICT_OPTIONS: {
  value: Verdict;
  label: string;
  emoji: string;
  active: string;
}[] = [
  {
    value: "correct",
    label: "判對",
    emoji: "✅",
    active: "bg-green-100 text-green-800 ring-2 ring-green-500 dark:bg-green-950 dark:text-green-200",
  },
  {
    value: "partial",
    label: "部分對",
    emoji: "🤔",
    active: "bg-yellow-100 text-yellow-800 ring-2 ring-yellow-500 dark:bg-yellow-950 dark:text-yellow-200",
  },
  {
    value: "wrong",
    label: "誤判",
    emoji: "❌",
    active: "bg-red-100 text-red-800 ring-2 ring-red-500 dark:bg-red-950 dark:text-red-200",
  },
];

type Props = {
  defects: Defect[];
  eduMap: Map<string, EDU>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  judgments: Map<string, Verdict>;
  onJudge: (defectId: string, ruleId: string, verdict: Verdict | null) => void;
};

export function DefectPanel({
  defects,
  eduMap,
  selectedId,
  onSelect,
  judgments,
  onJudge,
}: Props) {
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
          const currentVerdict = judgments.get(d.id) ?? null;
          const evidenceTexts = d.evidence_edu_ids
            .map((eid) => eduMap.get(eid)?.text)
            .filter((t): t is string => Boolean(t));

          return (
            <div
              key={d.id}
              className={cn(
                "block w-full border-l-4 bg-card p-3 text-left transition-colors",
                SEVERITY_BORDER[d.severity],
                isSelected && "bg-accent ring-2 ring-primary/40"
              )}
            >
              <button
                type="button"
                className="block w-full cursor-pointer text-left hover:opacity-90"
                onClick={() => onSelect(isSelected ? null : d.id)}
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
              </button>

              <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-border/50 pt-2">
                <span className="text-[10px] font-medium text-muted-foreground">
                  學長判定：
                </span>
                {VERDICT_OPTIONS.map((opt) => {
                  const isActive = currentVerdict === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onJudge(
                          d.id,
                          d.rule_id,
                          isActive ? null : opt.value
                        );
                      }}
                      className={cn(
                        "rounded px-2 py-0.5 text-[11px] font-medium transition-all",
                        "hover:opacity-90",
                        isActive
                          ? opt.active
                          : "bg-muted text-muted-foreground"
                      )}
                      title={isActive ? "點擊取消" : `標為 ${opt.label}`}
                    >
                      <span className="mr-0.5">{opt.emoji}</span>
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </ScrollArea>
  );
}
