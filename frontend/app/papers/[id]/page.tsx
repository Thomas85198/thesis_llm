import Link from "next/link";

import { ResultView } from "@/components/result-view";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { fetchPaperResult } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function PaperResultPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const decodedId = decodeURIComponent(id);

  try {
    const result = await fetchPaperResult(decodedId);
    return <ResultView result={result} />;
  } catch (e) {
    return (
      <Card className="mx-auto max-w-xl">
        <CardHeader>
          <CardTitle>找不到結果</CardTitle>
          <CardDescription>
            {e instanceof Error ? e.message : String(e)}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            可能原因：後端伺服器重啟導致 in-memory 結果遺失。請重新上傳論文。
          </p>
          <Link href="/" className={buttonVariants()}>
            回上傳頁
          </Link>
        </CardContent>
      </Card>
    );
  }
}
