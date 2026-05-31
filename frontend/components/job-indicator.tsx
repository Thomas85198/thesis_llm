"use client";

import { Check, RefreshCwIcon, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { useJobTracker } from "@/components/job-tracker";
import { Link } from "@/i18n/navigation";
import { STATUS_PROGRESS } from "@/lib/job-status";

export function JobIndicator() {
  const { active, isProcessing, clearJob } = useJobTracker();
  const t = useTranslations("jobIndicator");
  if (!active) return null;

  if (isProcessing) {
    return (
      <Link
        href="/"
        title={t("backToProgress")}
        className="flex items-center gap-1.5 rounded-full border bg-muted/60 px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted"
      >
        <RefreshCwIcon className="h-3.5 w-3.5 shrink-0 animate-spin" />
        <span>{t("analyzing")}</span>
        <span className="tabular-nums">{STATUS_PROGRESS[active.status]}%</span>
      </Link>
    );
  }

  // Done — invite the user to view the result, with a dismiss.
  return (
    <span className="flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 py-1 pr-1 pl-2.5 text-xs font-medium text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
      <Link
        href={`/papers/${encodeURIComponent(active.paperId)}`}
        onClick={clearJob}
        className="flex items-center gap-1.5"
      >
        <Check className="h-3.5 w-3.5 shrink-0" />
        {t("doneView")}
      </Link>
      <button
        onClick={clearJob}
        aria-label={t("close")}
        className="rounded-full p-0.5 hover:bg-emerald-100 dark:hover:bg-emerald-900"
      >
        <XIcon className="h-3.5 w-3.5" />
      </button>
    </span>
  );
}
