import { PageHeader } from "@/components/page-header";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { UploadForm } from "@/components/upload-form";
import { fetchRules } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function Home() {
  // fetchRules doubles as a lightweight backend health check; the rule list
  // itself now lives on the 規則統計 page.
  let backendError: string | null = null;
  try {
    await fetchRules();
  } catch (e) {
    backendError = e instanceof Error ? e.message : String(e);
  }

  return (
    <div className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 sm:px-6">
      <PageHeader
        title="上傳論文，自動找出邏輯缺陷"
        description="系統會把論文拆成 EDU、抽 Entity 與關係、標 RST/FRU 結構，寫入 Neo4j Knowledge Graph，最後用 13 條 REL 規則檢核並列出修改建議。"
      />

      {backendError && (
        <Card className="mb-6 border-destructive/40 bg-destructive/5">
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
  );
}
