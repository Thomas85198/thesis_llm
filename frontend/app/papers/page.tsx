import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { listPapers, type PaperListItem } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function PapersPage() {
  let papers: PaperListItem[] = [];
  let error: string | null = null;
  try {
    papers = await listPapers();
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  return (
    <div className="mx-auto w-full max-w-4xl flex-1 px-4 py-6 sm:px-6 sm:py-10">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            分析歷史
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            本次 server 啟動後分析過的論文
          </p>
        </div>
        <Link href="/" className={buttonVariants()}>
          上傳新論文
        </Link>
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
        <div className="grid gap-3">
          {papers.map((p) => (
            <Link
              key={p.paper_id}
              href={`/papers/${encodeURIComponent(p.paper_id)}`}
              className="block"
            >
              <Card className="transition-colors hover:bg-muted/50">
                <CardContent className="flex items-center justify-between gap-4 py-4">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{p.title}</p>
                    <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                      {p.paper_id}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge variant="outline">EDU {p.edu_count}</Badge>
                    <Badge
                      variant={p.defect_count > 0 ? "destructive" : "secondary"}
                    >
                      {p.defect_count} 缺陷
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
