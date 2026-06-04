import { getTranslations } from "next-intl/server";

import { EditorLoader } from "@/components/editor/editor-loader";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Link } from "@/i18n/navigation";
import { fetchDocument } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function EditorDocPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { id } = await params;
  const decodedId = decodeURIComponent(id);
  const t = await getTranslations("editor");

  try {
    const doc = await fetchDocument(decodedId);
    return <EditorLoader doc={doc} />;
  } catch (e) {
    return (
      <Card className="mx-auto mt-10 max-w-xl">
        <CardHeader>
          <CardTitle>{t("notFound")}</CardTitle>
          <CardDescription>
            {e instanceof Error ? e.message : String(e)}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/editor" className={buttonVariants()}>
            {t("backToList")}
          </Link>
        </CardContent>
      </Card>
    );
  }
}
