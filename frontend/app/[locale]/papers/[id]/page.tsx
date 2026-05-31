import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
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
  params: Promise<{ locale: string; id: string }>;
}) {
  const { id } = await params;
  const decodedId = decodeURIComponent(id);
  const t = await getTranslations("paperResult");

  try {
    const result = await fetchPaperResult(decodedId);
    return <ResultView result={result} />;
  } catch (e) {
    return (
      <Card className="mx-auto max-w-xl">
        <CardHeader>
          <CardTitle>{t("notFound")}</CardTitle>
          <CardDescription>
            {e instanceof Error ? e.message : String(e)}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>{t("notFoundHint")}</p>
          <Link href="/" className={buttonVariants()}>
            {t("backToUpload")}
          </Link>
        </CardContent>
      </Card>
    );
  }
}
