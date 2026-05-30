"use client";

import { Check } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

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
import { deletePaper, listPapers, type PaperListItem } from "@/lib/api";
import { cn } from "@/lib/utils";

export default function PapersPage() {
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
    if (
      !window.confirm(
        `確定刪除 ${count} 篇論文？\n` +
          `會一併清除其分析結果、學長判定與成本紀錄，此動作無法復原。`
      )
    )
      return;

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
      toast.error(`成功 ${okCount} 篇 / 失敗 ${failCount} 篇`);
    } else {
      toast.success(`已刪除 ${okCount} 篇`);
    }
    reload();
  }

  return (
    <div className="mx-auto w-full max-w-4xl flex-1 px-4 py-6 sm:px-6 sm:py-10">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            分析歷史
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            所有已分析過的論文（持久化於 SQLite）
          </p>
        </div>
        <div className="flex items-center gap-2">
          {selected.size > 0 && (
            <Button
              variant="destructive"
              size="sm"
              onClick={handleBulkDelete}
              disabled={deleting}
            >
              刪除選取 ({selected.size})
            </Button>
          )}
          <Link href="/" className={buttonVariants()}>
            上傳新論文
          </Link>
        </div>
      </div>

      {error ? (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardHeader>
            <CardTitle className="text-destructive text-base">
              無法取得列表
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
            <p className="text-sm text-muted-foreground">
              還沒有分析過的論文
            </p>
            <Link
              href="/"
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              上傳第一篇
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
              {selected.size === papers.length ? "取消全選" : "全選"}
            </button>
            <span>共 {papers.length} 篇</span>
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
                    aria-label={isSelected ? "取消選取" : "選取"}
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
                            {p.defect_count} 缺陷
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
