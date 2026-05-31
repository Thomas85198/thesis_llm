import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { fetchPaperCost, fetchPaperResult } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function PaperLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string; id: string }>;
}) {
  const { id } = await params;
  const t = await getTranslations("paperLayout");
  const decodedId = decodeURIComponent(id);

  let title = decodedId;
  let defectCount: number | null = null;
  let eduCount: number | null = null;
  let costUsd: number | null = null;
  let costCalls: number | null = null;
  try {
    const result = await fetchPaperResult(decodedId);
    title = result.graph.title || decodedId;
    defectCount = result.defects.length;
    eduCount = result.graph.edus.length;
  } catch {
    // Layout still renders; child page will show a friendlier error.
  }
  try {
    const cost = await fetchPaperCost(decodedId);
    costUsd = cost.total.cost_usd;
    costCalls = cost.total.calls;
  } catch {
    // Cost is best-effort.
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="border-b bg-background">
        <div className="mx-auto w-full max-w-7xl px-4 py-3 sm:px-6">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs font-mono text-muted-foreground">
                {decodedId}
              </p>
              <h2 className="mt-0.5 truncate text-base font-semibold sm:text-lg">
                {title}
              </h2>
              {(defectCount !== null || eduCount !== null) && (
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  {defectCount !== null && (
                    <Badge
                      variant={defectCount > 0 ? "destructive" : "secondary"}
                    >
                      {t("defectsBadge", { count: defectCount })}
                    </Badge>
                  )}
                  {eduCount !== null && (
                    <Badge variant="outline">EDU {eduCount}</Badge>
                  )}
                  {costUsd !== null && costCalls !== null && costCalls > 0 && (
                    <Badge
                      variant="outline"
                      title={t("llmCalls", { count: costCalls })}
                      className="font-mono"
                    >
                      ${costUsd.toFixed(3)}
                    </Badge>
                  )}
                </div>
              )}
            </div>
            <nav className="flex shrink-0 gap-1">
              <Link
                href={`/papers/${id}`}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                {t("tabDefects")}
              </Link>
              <Link
                href={`/papers/${id}/graph`}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                {t("tabGraph")}
              </Link>
            </nav>
          </div>
        </div>
      </div>
      <div className="mx-auto w-full max-w-7xl flex-1 px-4 py-3 sm:px-6">
        {children}
      </div>
    </div>
  );
}
