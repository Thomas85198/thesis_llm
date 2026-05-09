"use client";

import nextDynamic from "next/dynamic";

import { Skeleton } from "@/components/ui/skeleton";
import type { AnalysisResult } from "@/lib/api";

const KGFlow = nextDynamic(
  () => import("@/components/kg-flow").then((m) => m.KGFlow),
  {
    ssr: false,
    loading: () => (
      <div className="space-y-3">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="h-[600px] w-full" />
      </div>
    ),
  }
);

export function KGFlowLoader({ result }: { result: AnalysisResult }) {
  return <KGFlow result={result} />;
}
