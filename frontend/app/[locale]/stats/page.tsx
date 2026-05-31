"use client";

import { AlertTriangleIcon, DownloadIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  fetchEvalSummary,
  fetchJudgmentExport,
  fetchRuleStats,
  fetchRules,
  type EvalSummary,
  type Rule,
  type RulesStats,
} from "@/lib/api";
import { cn } from "@/lib/utils";

export default function StatsPage() {
  const t = useTranslations("stats");
  const [data, setData] = useState<RulesStats | null>(null);
  const [evalData, setEvalData] = useState<EvalSummary | null>(null);
  const [rules, setRules] = useState<Rule[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchRuleStats()
      .then(setData)
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : String(e))
      );
    fetchEvalSummary()
      .then(setEvalData)
      .catch(() => {
        // Eval summary 是次要資料，失敗不擋主頁
      });
    fetchRules()
      .then(setRules)
      .catch(() => {
        // 規則參考清單失敗不擋主頁
      });
  }, []);

  async function handleExportJudgments() {
    try {
      const data = await fetchJudgmentExport();
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const stamp = new Date().toISOString().slice(0, 10);
      a.download = `judgments_export_${stamp}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(t("exportOk", { count: data.total_judgments }));
    } catch (e) {
      toast.error(t("exportFailed"), {
        description: e instanceof Error ? e.message : String(e),
      });
    }
  }

  if (error) {
    return (
      <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
        <h1 className="text-2xl font-semibold">{t("pageTitle")}</h1>
        <p className="mt-4 text-sm text-red-600">
          {t("loadFailed")}
          {error}
        </p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
        <h1 className="text-2xl font-semibold">{t("pageTitle")}</h1>
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
    <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-8 sm:px-6">
      <PageHeader
        title={t("headerTitle")}
        description={t("headerDesc")}
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportJudgments}
            disabled={totalJudged === 0}
          >
            <DownloadIcon className="h-4 w-4" />
            {t("downloadJudgments", { count: totalJudged })}
          </Button>
        }
      />

      {/* Top-level KPIs */}
      <div className="grid gap-3 sm:grid-cols-4">
        <Kpi label={t("kpiPapers")} value={data.papers_analyzed} />
        <Kpi label={t("kpiDefects")} value={totalDefects} />
        <Kpi label={t("kpiJudged")} value={totalJudged} />
        <Kpi
          label={t("kpiPrecision")}
          value={
            overallPrecision === null
              ? "—"
              : `${(overallPrecision * 100).toFixed(0)}%`
          }
        />
      </div>

      {/* LLM vs Human evaluation */}
      {evalData && evalData.overall.total > 0 && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-xl font-semibold">{t("evalTitle")}</h2>
            <p className="text-xs text-muted-foreground">
              {t("evalSubtitle", { count: evalData.overall.total })}
            </p>
          </div>
          {evalData.orphan_judgments > 0 && (
            <p className="flex items-start gap-1.5 rounded border border-yellow-400/50 bg-yellow-50 p-2 text-xs text-yellow-800 dark:bg-yellow-950 dark:text-yellow-300">
              <AlertTriangleIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                {t("orphanWarning", { count: evalData.orphan_judgments })}
              </span>
            </p>
          )}

          {/* Overall + by severity + by confidence side by side */}
          <div className="grid gap-4 lg:grid-cols-3">
            {/* Overall numbers */}
            <div className="rounded-md border bg-card p-4">
              <h3 className="mb-3 text-sm font-medium text-muted-foreground">
                {t("overall")}
              </h3>
              <div className="space-y-2 text-sm">
                <BucketRow label="Correct" n={evalData.overall.correct} total={evalData.overall.total} colorClass="bg-emerald-500" />
                <BucketRow label="Partial" n={evalData.overall.partial} total={evalData.overall.total} colorClass="bg-yellow-500" />
                <BucketRow label="Wrong" n={evalData.overall.wrong} total={evalData.overall.total} colorClass="bg-red-500" />
                <div className="mt-3 border-t pt-3 text-center">
                  <div className="text-3xl font-bold tabular-nums">
                    {evalData.overall.soft_precision === null
                      ? "—"
                      : `${(evalData.overall.soft_precision * 100).toFixed(1)}%`}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {t("softPrecision")}
                  </div>
                </div>
              </div>
            </div>

            {/* By severity */}
            <div className="rounded-md border bg-card p-4">
              <h3 className="mb-3 text-sm font-medium text-muted-foreground">
                {t("bySeverity")}
              </h3>
              <table className="w-full text-xs">
                <thead className="text-[10px] uppercase text-muted-foreground">
                  <tr>
                    <th className="pb-2 text-left">{t("colSeverity")}</th>
                    <th className="pb-2 text-right">N</th>
                    <th className="pb-2 text-right">Precision</th>
                  </tr>
                </thead>
                <tbody>
                  {evalData.by_severity.map((s) => (
                    <tr key={s.severity} className="border-t">
                      <td className="py-1.5">
                        {s.severity === "high" && t("severityHigh")}
                        {s.severity === "medium" && t("severityMedium")}
                        {s.severity === "low" && t("severityLow")}
                        {s.severity === "unknown" && "—"}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">{s.total}</td>
                      <td className="py-1.5 text-right tabular-nums">
                        {s.soft_precision === null
                          ? "—"
                          : `${(s.soft_precision * 100).toFixed(0)}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-[10px] text-muted-foreground">
                {t("severityHint")}
              </p>
            </div>

            {/* By confidence (calibration) */}
            <div className="rounded-md border bg-card p-4">
              <h3 className="mb-3 text-sm font-medium text-muted-foreground">
                {t("byConfidence")}
              </h3>
              <table className="w-full text-xs">
                <thead className="text-[10px] uppercase text-muted-foreground">
                  <tr>
                    <th className="pb-2 text-left">{t("colConfBucket")}</th>
                    <th className="pb-2 text-right">N</th>
                    <th className="pb-2 text-right">Precision</th>
                  </tr>
                </thead>
                <tbody>
                  {evalData.by_confidence.map((b) => (
                    <tr key={b.bucket} className="border-t">
                      <td className="py-1.5">{b.bucket}</td>
                      <td className="py-1.5 text-right tabular-nums">{b.total}</td>
                      <td className="py-1.5 text-right tabular-nums">
                        {b.soft_precision === null
                          ? "—"
                          : `${(b.soft_precision * 100).toFixed(0)}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-[10px] text-muted-foreground">
                {t("confidenceHint")}
              </p>
            </div>
          </div>
        </section>
      )}

      {/* Table */}
      <div className="overflow-x-auto rounded-md border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-[11px] uppercase text-muted-foreground">
            <tr>
              <th className="p-2 text-left">{t("colRule")}</th>
              <th className="p-2 text-left">{t("colName")}</th>
              <th className="p-2 text-right" title={t("colTotalDefectsTitle")}>
                {t("colTotalDefects")}
              </th>
              <th className="p-2 text-right" title={t("colFiredPapersTitle")}>
                {t("colFiredPapers")}
              </th>
              <th className="p-2 text-right">{t("colFireRate")}</th>
              <th className="p-2 text-right" title={t("colJudgedTitle")}>
                {t("colJudged")}
              </th>
              <th
                className="p-2 text-right"
                title="(correct + 0.5×partial) / total"
              >
                Precision
              </th>
              <th className="p-2 text-left">{t("colStatus")}</th>
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
                      <span
                        title={t("judgedTitle", {
                          correct: r.judged_correct,
                          partial: r.judged_partial,
                          wrong: r.judged_wrong,
                        })}
                      >
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

      <div className="space-y-3 text-xs text-muted-foreground">
        <div className="space-y-1">
          <p>
            <strong>{t("fireRateLabel")}</strong>
            {t("fireRateExplain")}
          </p>
          <p>
            <strong>{t("precisionLabel")}</strong>
            {t("precisionExplain")}
          </p>
        </div>

        <div className="space-y-1 border-t pt-3">
          <p className="mb-1 font-medium text-foreground">
            {t("statusColHeading")}
          </p>
          <div className="grid gap-1.5 sm:grid-cols-2">
            <div className="flex items-start gap-2">
              <Badge variant="outline" className="border-emerald-400 text-emerald-700 shrink-0">
                {t("statusGood")}
              </Badge>
              <span>{t("statusGoodDesc")}</span>
            </div>
            <div className="flex items-start gap-2">
              <Badge variant="outline" className="border-red-400 text-red-700 shrink-0">
                {t("statusReview")}
              </Badge>
              <span>{t("statusReviewDesc")}</span>
            </div>
            <div className="flex items-start gap-2">
              <Badge variant="outline" className="border-orange-400 text-orange-700 shrink-0">
                {t("statusHighFire")}
              </Badge>
              <span>{t("statusHighFireDesc")}</span>
            </div>
            <div className="flex items-start gap-2">
              <Badge variant="outline" className="border-zinc-400 text-zinc-600 shrink-0">
                {t("statusNeverFire")}
              </Badge>
              <span>{t("statusNeverFireDesc")}</span>
            </div>
            <div className="flex items-start gap-2">
              <Badge variant="outline" className="shrink-0">
                {t("statusWorking")}
              </Badge>
              <span>{t("statusWorkingDesc")}</span>
            </div>
            <div className="flex items-start gap-2">
              <Badge variant="outline" className="shrink-0">
                {t("statusNoData")}
              </Badge>
              <span>{t("statusNoDataDesc")}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-md border bg-card">
        <div className="border-b px-4 py-3">
          <h2 className="text-base font-semibold">{t("rulesTitle")}</h2>
          <p className="text-xs text-muted-foreground">{t("rulesSubtitle")}</p>
        </div>
        <ol className="grid gap-x-6 gap-y-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
          {rules.map((r) => (
            <li key={r.id} className="text-xs leading-relaxed">
              <div className="flex items-center gap-1.5">
                <Badge variant="outline" className="font-mono text-[10px]">
                  {r.id}
                </Badge>
                <span className="font-semibold">{r.name}</span>
              </div>
              <p className="mt-0.5 text-muted-foreground">
                {t.has(`ruleDesc.${r.id}`)
                  ? t(`ruleDesc.${r.id}`)
                  : r.description.split("\n")[0]}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function BucketRow({
  label,
  n,
  total,
  colorClass,
}: {
  label: string;
  n: number;
  total: number;
  colorClass: string;
}) {
  const pct = total > 0 ? (n / total) * 100 : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span>{label}</span>
        <span className="tabular-nums text-muted-foreground">
          {n} ({pct.toFixed(0)}%)
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full", colorClass)} style={{ width: `${pct}%` }} />
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
  const t = useTranslations("stats");
  if (papersAnalyzed === 0) {
    return <Badge variant="outline">{t("statusNoData")}</Badge>;
  }
  if (total === 0) {
    return (
      <Badge
        variant="outline"
        className="border-zinc-400 text-zinc-600"
        title={t("neverFireTitle")}
      >
        {t("statusNeverFire")}
      </Badge>
    );
  }
  if (precision !== null && judgedTotal >= 3 && precision < 0.5) {
    return (
      <Badge
        variant="outline"
        className="border-red-400 text-red-700"
        title={t("reviewTitle")}
      >
        {t("statusReview")}
      </Badge>
    );
  }
  if (precision !== null && precision >= 0.7 && judgedTotal >= 3) {
    return (
      <Badge variant="outline" className="border-emerald-400 text-emerald-700">
        {t("statusGood")}
      </Badge>
    );
  }
  const fireRate = papersFired / papersAnalyzed;
  if (fireRate > 0.8) {
    return (
      <Badge
        variant="outline"
        className="border-orange-400 text-orange-700"
        title={t("highFireTitle")}
      >
        {t("statusHighFire")}
      </Badge>
    );
  }
  return <Badge variant="outline">{t("statusWorking")}</Badge>;
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
