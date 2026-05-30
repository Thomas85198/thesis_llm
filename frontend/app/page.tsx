import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { UploadForm } from "@/components/upload-form";
import { fetchRules, type Rule } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function Home() {
  let rules: Rule[] = [];
  let backendError: string | null = null;
  try {
    rules = await fetchRules();
  } catch (e) {
    backendError = e instanceof Error ? e.message : String(e);
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center px-4 py-6 sm:px-6 sm:py-8">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-stretch">
        <div className="flex min-w-0 flex-col justify-center gap-6">
          <section className="space-y-2">
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
              上傳論文，自動找出邏輯缺陷
            </h1>
            <p className="text-sm text-muted-foreground sm:text-base">
              系統會把論文拆成 EDU、抽 Entity 與關係、標 RST/FRU 結構，寫入
              Neo4j Knowledge Graph，最後用 13 條 REL 規則檢核並列出修改建議。
            </p>
          </section>

          {backendError && (
            <Card className="border-destructive/40 bg-destructive/5">
              <CardHeader className="pb-3">
                <CardTitle className="text-destructive text-base">
                  後端未連線
                </CardTitle>
                <CardDescription>{backendError}</CardDescription>
              </CardHeader>
              <CardContent className="pt-0 text-xs text-muted-foreground">
                請啟動：
                <code className="ml-1 rounded bg-muted px-1.5 py-0.5">
                  cd backend && uvicorn main:app --reload --reload-dir app
                </code>
              </CardContent>
            </Card>
          )}

          <UploadForm />
        </div>

        <aside className="min-w-0">
          <Card className="flex h-full flex-col">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">13 條 REL 規則</CardTitle>
              <CardDescription>MECE 收斂自 51 條章節規則</CardDescription>
            </CardHeader>
            <CardContent className="flex-1 px-0 pb-3">
              <ScrollArea className="h-[420px] px-6 lg:h-[calc(100vh-15rem)]">
                <ol className="space-y-2.5">
                  {rules.map((r) => (
                    <li key={r.id} className="text-xs leading-relaxed">
                      <div className="flex items-center gap-1.5">
                        <Badge
                          variant="outline"
                          className="font-mono text-[10px]"
                        >
                          {r.id}
                        </Badge>
                        <span className="font-semibold">{r.name}</span>
                      </div>
                      <p className="mt-0.5 text-muted-foreground">
                        {r.description.split("\n")[0]}
                      </p>
                    </li>
                  ))}
                </ol>
              </ScrollArea>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
