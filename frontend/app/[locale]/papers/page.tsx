"use client";

import { Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "@/i18n/navigation";
import { deletePaper, listPapers, type PaperListItem } from "@/lib/api";
import { cn } from "@/lib/utils";

export default function PapersPage() {
  const t = useTranslations("papers");
  const [papers, setPapers] = useState<PaperListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);

  const reload = useCallback(() => {
    listPapers()
      .then((items) => {
        setPapers(items);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  function toggle(paperId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(paperId)) next.delete(paperId);
      else next.add(paperId);
      return next;
    });
  }

  function toggleAll() {
    if (!papers) return;
    if (selected.size === papers.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(papers.map((p) => p.paper_id)));
    }
  }

  async function handleBulkDelete() {
    if (selected.size === 0) return;
    const count = selected.size;
    if (!window.confirm(t("confirmDelete", { count }))) return;

    setDeleting(true);
    const ids = Array.from(selected);
    let okCount = 0;
    let failCount = 0;
    for (const id of ids) {
      try {
        await deletePaper(id);
        okCount += 1;
      } catch (err) {
        failCount += 1;
        console.error(`delete ${id} failed`, err);
      }
    }
    setSelected(new Set());
    setDeleting(false);
    if (failCount > 0) {
      toast.error(t("deletePartial", { ok: okCount, fail: failCount }));
    } else {
      toast.success(t("deleteOk", { ok: okCount }));
    }
    reload();
  }

  return (
    <div className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <div className="flex items-center gap-2">
            {selected.size > 0 && (
              <Button
                variant="destructive"
                size="sm"
                onClick={handleBulkDelete}
                disabled={deleting}
              >
                {t("deleteSelected", { count: selected.size })}
              </Button>
            )}
            <Link href="/" className={buttonVariants()}>
              {t("uploadNew")}
            </Link>
          </div>
        }
      />

      {error ? (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardHeader>
            <CardTitle className="text-destructive text-base">
              {t("listError")}
            </CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
        </Card>
      ) : papers === null ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : papers.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <p className="text-sm text-muted-foreground">{t("empty")}</p>
            <Link
              href="/"
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              {t("uploadFirst")}
            </Link>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
            <button
              type="button"
              onClick={toggleAll}
              className="hover:text-foreground"
            >
              {selected.size === papers.length
                ? t("deselectAll")
                : t("selectAll")}
            </button>
            <span>{t("totalCount", { count: papers.length })}</span>
          </div>
          <div className="grid gap-3">
            {papers.map((p) => {
              const isSelected = selected.has(p.paper_id);
              return (
                <div key={p.paper_id} className="flex items-stretch gap-2">
                  <button
                    type="button"
                    onClick={() => toggle(p.paper_id)}
                    className={cn(
                      "flex w-10 shrink-0 items-center justify-center rounded-md border bg-card transition-colors",
                      isSelected
                        ? "border-primary bg-primary/10 text-primary"
                        : "hover:bg-accent"
                    )}
                    aria-label={isSelected ? t("deselectAria") : t("selectAria")}
                  >
                    {isSelected ? <Check className="h-4 w-4" /> : null}
                  </button>
                  <Link
                    href={`/papers/${encodeURIComponent(p.paper_id)}`}
                    className="block flex-1"
                  >
                    <Card
                      className={cn(
                        "transition-colors hover:bg-muted/50",
                        isSelected && "ring-2 ring-primary/40"
                      )}
                    >
                      <CardContent className="flex items-center justify-between gap-4 py-4">
                        <div className="min-w-0">
                          <p className="truncate font-medium">{p.title}</p>
                          {/* filename 小字顯示，但若跟 title 相同就不重複（多數為舊資料 backfill 的情況） */}
                          {p.filename && p.filename !== p.title && (
                            <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                              {p.filename}
                            </p>
                          )}
                          <p className="mt-0.5 font-mono text-[10px] text-muted-foreground/70">
                            {p.paper_id}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <Badge variant="outline">EDU {p.edu_count}</Badge>
                          <Badge
                            variant={
                              p.defect_count > 0 ? "destructive" : "secondary"
                            }
                          >
                            {t("defectsBadge", { count: p.defect_count })}
                          </Badge>
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
