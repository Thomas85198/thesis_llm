import Link from "next/link";

import { KGFlowLoader } from "@/components/kg-flow-loader";
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

export default async function GraphPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const decodedId = decodeURIComponent(id);

  try {
    const result = await fetchPaperResult(decodedId);
    return <KGFlowLoader result={result} />;
  } catch (e) {
    return (
      <Card className="mx-auto max-w-xl">
        <CardHeader>
          <CardTitle>找不到結果</CardTitle>
          <CardDescription>
            {e instanceof Error ? e.message : String(e)}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/" className={buttonVariants()}>
            回上傳頁
          </Link>
        </CardContent>
      </Card>
    );
  }
}
