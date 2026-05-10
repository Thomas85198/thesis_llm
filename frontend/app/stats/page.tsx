"use client";

import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchRuleStats, type RulesStats } from "@/lib/api";
import { cn } from "@/lib/utils";

export default function StatsPage() {
  const [data, setData] = useState<RulesStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchRuleStats()
      .then(setData)
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : String(e))
      );
  }, []);

  if (error) {
    return (
      <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
        <h1 className="text-2xl font-semibold">規則統計</h1>
        <p className="mt-4 text-sm text-red-600">載入失敗：{error}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
        <h1 className="text-2xl font-semibold">規則統計</h1>
        <div className="mt-4 space-y-2">
          {Array.from({ length: 13 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      </div>
    );
  }

  const totalDefects = data.items.reduce((s, r) => s + r.total_defects, 0);
  const totalJudged = data.items.reduce((s, r) => s + r.judged_total, 0);
  const overallPrecision = computeOverallPrecision(data.items);

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:px-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">規則統計</h1>
        <p className="text-sm text-muted-foreground">
          13 條 REL 規則在所有已分析論文上的命中分布、人工判定 precision，與
          Phase 2 few-shot 樣本是否充足。
        </p>
      </header>

      {/* Top-level KPIs */}
      <div className="grid gap-3 sm:grid-cols-4">
        <Kpi label="已分析論文" value={data.papers_analyzed} />
        <Kpi label="累積缺陷" value={totalDefects} />
        <Kpi label="已人工判定" value={totalJudged} />
        <Kpi
          label="整體 precision"
          value={
            overallPrecision === null
              ? "—"
              : `${(overallPrecision * 100).toFixed(0)}%`
          }
        />
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-md border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-[11px] uppercase text-muted-foreground">
            <tr>
              <th className="p-2 text-left">規則</th>
              <th className="p-2 text-left">名稱</th>
              <th className="p-2 text-right" title="此規則一共抓出幾個缺陷">
                總缺陷
              </th>
              <th className="p-2 text-right" title="觸發此規則的論文數">
                觸發論文
              </th>
              <th className="p-2 text-right">命中率</th>
              <th className="p-2 text-right" title="學長已判定的缺陷數">
                已判
              </th>
              <th
                className="p-2 text-right"
                title="(correct + 0.5×partial) / total"
              >
                Precision
              </th>
              <th className="p-2 text-right">Phase 2</th>
              <th className="p-2 text-left">狀態</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((r) => {
              const fireRate =
                data.papers_analyzed > 0
                  ? r.papers_fired / data.papers_analyzed
                  : 0;
              return (
                <tr
                  key={r.rule_id}
                  className="border-t transition-colors hover:bg-accent/30"
                >
                  <td className="p-2 font-mono text-xs">{r.rule_id}</td>
                  <td className="p-2">{r.name}</td>
                  <td className="p-2 text-right tabular-nums">
                    {r.total_defects}
                  </td>
                  <td className="p-2 text-right tabular-nums">
                    {r.papers_fired}/{data.papers_analyzed}
                  </td>
                  <td className="p-2 text-right tabular-nums">
                    {(fireRate * 100).toFixed(0)}%
                  </td>
                  <td className="p-2 text-right tabular-nums">
                    {r.judged_total > 0 ? (
                      <span title={`✅${r.judged_correct} 🤔${r.judged_partial} ❌${r.judged_wrong}`}>
                        {r.judged_total}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">0</span>
                    )}
                  </td>
                  <td className="p-2 text-right tabular-nums">
                    {r.precision === null ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <PrecisionBadge value={r.precision} />
                    )}
                  </td>
                  <td className="p-2 text-right tabular-nums text-xs text-muted-foreground">
                    {phase2Status(r.judged_total)}
                  </td>
                  <td className="p-2">
                    <StatusChip
                      total={r.total_defects}
                      papersFired={r.papers_fired}
                      papersAnalyzed={data.papers_analyzed}
                      precision={r.precision}
                      judgedTotal={r.judged_total}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="space-y-1 text-xs text-muted-foreground">
        <p>
          <strong>命中率</strong>：觸發論文數 / 已分析論文數。過低 (≤10%) 可能規則太嚴或 Cypher 漏寫；過高 (≥80%) 可能 over-fire。
        </p>
        <p>
          <strong>Precision</strong>：(correct + 0.5 × partial) / 已判數。&lt; 0.5 應該重寫規則 description 或 Cypher。
        </p>
        <p>
          <strong>Phase 2</strong>：≥3 筆判定才會 inject 為 few-shot；&lt;3 筆時規則仍走 zero-shot。
        </p>
      </div>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-md border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function PrecisionBadge({ value }: { value: number }) {
  const pct = (value * 100).toFixed(0);
  let cls: string;
  if (value >= 0.8) cls = "bg-emerald-100 text-emerald-700";
  else if (value >= 0.5) cls = "bg-sky-100 text-sky-700";
  else cls = "bg-red-100 text-red-700";
  return (
    <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-medium", cls)}>
      {pct}%
    </span>
  );
}

function phase2Status(judgedTotal: number) {
  if (judgedTotal >= 3) return `⚙️ ON (${judgedTotal})`;
  if (judgedTotal === 0) return "—";
  return `${judgedTotal}/3`;
}

function StatusChip({
  total,
  papersFired,
  papersAnalyzed,
  precision,
  judgedTotal,
}: {
  total: number;
  papersFired: number;
  papersAnalyzed: number;
  precision: number | null;
  judgedTotal: number;
}) {
  if (papersAnalyzed === 0) {
    return <Badge variant="outline">無資料</Badge>;
  }
  if (total === 0) {
    return (
      <Badge
        variant="outline"
        className="border-zinc-400 text-zinc-600"
        title="從未觸發。可能規則太嚴或 Cypher 沒抓到候選"
      >
        🌑 從未觸發
      </Badge>
    );
  }
  if (precision !== null && judgedTotal >= 3 && precision < 0.5) {
    return (
      <Badge
        variant="outline"
        className="border-red-400 text-red-700"
        title="precision 低於 50%，建議重寫規則 description"
      >
        ⚠️ 需檢討
      </Badge>
    );
  }
  if (precision !== null && precision >= 0.7 && judgedTotal >= 3) {
    return (
      <Badge
        variant="outline"
        className="border-emerald-400 text-emerald-700"
      >
        ✅ 表現良好
      </Badge>
    );
  }
  const fireRate = papersFired / papersAnalyzed;
  if (fireRate > 0.8) {
    return (
      <Badge
        variant="outline"
        className="border-orange-400 text-orange-700"
        title="幾乎每篇都觸發，可能 over-fire"
      >
        🔥 高頻觸發
      </Badge>
    );
  }
  return <Badge variant="outline">運作中</Badge>;
}

function computeOverallPrecision(
  items: { judged_correct: number; judged_partial: number; judged_total: number }[]
): number | null {
  let correct = 0;
  let partial = 0;
  let total = 0;
  for (const r of items) {
    correct += r.judged_correct;
    partial += r.judged_partial;
    total += r.judged_total;
  }
  return total > 0 ? (correct + 0.5 * partial) / total : null;
}
