"use client";

import { useMemo, useState } from "react";

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

const SEVERITY_RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

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
    active:
      "bg-green-100 text-green-800 ring-2 ring-green-500 dark:bg-green-950 dark:text-green-200",
  },
  {
    value: "partial",
    label: "部分對",
    emoji: "🤔",
    active:
      "bg-yellow-100 text-yellow-800 ring-2 ring-yellow-500 dark:bg-yellow-950 dark:text-yellow-200",
  },
  {
    value: "wrong",
    label: "誤判",
    emoji: "❌",
    active:
      "bg-red-100 text-red-800 ring-2 ring-red-500 dark:bg-red-950 dark:text-red-200",
  },
];

type GroupBy = "severity" | "rule";

type Props = {
  defects: Defect[];
  eduMap: Map<string, EDU>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onJumpToPdf?: (defectId: string) => void;
  judgments: Map<string, Verdict>;
  onJudge: (defectId: string, ruleId: string, verdict: Verdict | null) => void;
};

export function DefectPanel({
  defects,
  eduMap,
  selectedId,
  onSelect,
  onJumpToPdf,
  judgments,
  onJudge,
}: Props) {
  const [groupBy, setGroupBy] = useState<GroupBy>("severity");

  const groups = useMemo(
    () => groupDefects(defects, groupBy),
    [defects, groupBy]
  );

  if (defects.length === 0) {
    return (
      <div className="flex h-full items-center justify-center rounded-md border bg-muted/30 p-6 text-center">
        <p className="text-sm text-muted-foreground">沒有發現缺陷 🎉</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col rounded-md border">
      <div className="flex items-center gap-1 border-b bg-muted/30 px-2 py-1.5 text-[11px]">
        <span className="text-muted-foreground">分組：</span>
        <button
          type="button"
          onClick={() => setGroupBy("severity")}
          className={cn(
            "rounded px-2 py-0.5 font-medium transition-colors",
            groupBy === "severity"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          嚴重度
        </button>
        <button
          type="button"
          onClick={() => setGroupBy("rule")}
          className={cn(
            "rounded px-2 py-0.5 font-medium transition-colors",
            groupBy === "rule"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          規則
        </button>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="space-y-3 p-2">
          {groups.map((g) => (
            <section key={g.key}>
              <h3 className="sticky top-0 z-10 mb-1 flex items-baseline gap-2 bg-background/95 px-1 py-1 text-[11px] font-medium uppercase text-muted-foreground backdrop-blur-sm">
                <span>{g.label}</span>
                <span className="text-[10px] font-normal">({g.items.length})</span>
              </h3>
              <div className="space-y-2">
                {g.items.map((d) => (
                  <DefectCard
                    key={d.id}
                    defect={d}
                    eduMap={eduMap}
                    isSelected={selectedId === d.id}
                    currentVerdict={judgments.get(d.id) ?? null}
                    onSelect={() =>
                      onSelect(selectedId === d.id ? null : d.id)
                    }
                    onJumpToPdf={onJumpToPdf ? () => onJumpToPdf(d.id) : undefined}
                    onJudge={(v) => onJudge(d.id, d.rule_id, v)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

function DefectCard({
  defect: d,
  eduMap,
  isSelected,
  currentVerdict,
  onSelect,
  onJumpToPdf,
  onJudge,
}: {
  defect: Defect;
  eduMap: Map<string, EDU>;
  isSelected: boolean;
  currentVerdict: Verdict | null;
  onSelect: () => void;
  onJumpToPdf?: () => void;
  onJudge: (v: Verdict | null) => void;
}) {
  const evidenceTexts = d.evidence_edu_ids
    .map((eid) => eduMap.get(eid)?.text)
    .filter((t): t is string => Boolean(t));

  // 點 card 時若使用者剛選了文字（drag-select），不要 toggle 選取 —
  // 讓使用者能正常複製文字 / 點右鍵 context menu，不會被 click handler 搶走。
  const handleCardClick = () => {
    const sel = typeof window !== "undefined" ? window.getSelection() : null;
    if (sel && sel.toString().length > 0) return;
    onSelect();
  };

  return (
    <div
      className={cn(
        "block w-full border-l-4 bg-card p-3 text-left transition-colors",
        SEVERITY_BORDER[d.severity],
        isSelected && "bg-accent ring-2 ring-primary/40"
      )}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={handleCardClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect();
          }
        }}
        className="block w-full cursor-pointer text-left select-text hover:opacity-90"
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
          <ConfidenceBadge value={d.confidence ?? null} />
        </div>

        {evidenceTexts.length > 0 && (
          <div className="mt-2 space-y-1 border-l-2 border-muted-foreground/30 pl-3">
            {evidenceTexts.map((t, i) => (
              <p
                key={i}
                title={t.trim()}
                className={cn(
                  "text-xs italic leading-relaxed text-muted-foreground",
                  // 選中時完整顯示原句；未選中保持 line-clamp-3
                  isSelected ? "" : "line-clamp-3 hover:line-clamp-none"
                )}
              >
                「{t.trim()}」
              </p>
            ))}
          </div>
        )}

        <p
          className={cn(
            "mt-2 text-sm leading-relaxed",
            isSelected ? "" : "line-clamp-3"
          )}
        >
          {d.description}
        </p>

        <div
          className={cn(
            "mt-2 rounded bg-muted/60 p-2 text-xs leading-relaxed",
            isSelected ? "" : "line-clamp-3"
          )}
        >
          <span className="font-semibold">建議：</span>
          {d.suggestion}
        </div>
      </div>

      {isSelected && onJumpToPdf && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onJumpToPdf();
          }}
          className={cn(
            "mt-2 inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-[11px] font-medium",
            "transition-colors hover:bg-accent"
          )}
          title="跳到 PDF 中對應位置並高亮"
        >
          📄 在 PDF 中查看
        </button>
      )}

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
                onJudge(isActive ? null : opt.value);
              }}
              className={cn(
                "rounded px-2 py-0.5 text-[11px] font-medium transition-all",
                "hover:opacity-90",
                isActive ? opt.active : "bg-muted text-muted-foreground"
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
}

function ConfidenceBadge({ value }: { value: number | null }) {
  if (value === null) return null;
  const pct = Math.round(value * 100);
  let cls: string;
  let label: string;
  if (value >= 0.8) {
    cls =
      "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300";
    label = "高信心";
  } else if (value >= 0.5) {
    cls = "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300";
    label = "中信心";
  } else {
    cls =
      "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";
    label = "低信心";
  }
  return (
    <span
      className={cn(
        "rounded px-1.5 py-0.5 font-mono text-[10px] font-medium",
        cls
      )}
      title={`LLM 信心：${pct}%（${label}）`}
    >
      {pct}%
    </span>
  );
}

type Group = { key: string; label: string; items: Defect[] };

function groupDefects(defects: Defect[], by: GroupBy): Group[] {
  if (by === "severity") {
    const buckets = new Map<Severity, Defect[]>();
    for (const d of defects) {
      const arr = buckets.get(d.severity) ?? [];
      arr.push(d);
      buckets.set(d.severity, arr);
    }
    return (Object.keys(SEVERITY_RANK) as Severity[])
      .filter((s) => buckets.has(s))
      .map((s) => ({
        key: s,
        label: `${SEVERITY_LABEL[s]}嚴重`,
        items: buckets.get(s)!,
      }));
  }
  const buckets = new Map<string, Defect[]>();
  for (const d of defects) {
    const arr = buckets.get(d.rule_id) ?? [];
    arr.push(d);
    buckets.set(d.rule_id, arr);
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([rule_id, items]) => ({
      key: rule_id,
      label: `${rule_id} · ${items[0].defect_type}`,
      items: items.sort(
        (x, y) => SEVERITY_RANK[x.severity] - SEVERITY_RANK[y.severity]
      ),
    }));
}
