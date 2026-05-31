import { getTranslations } from "next-intl/server";
import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  CHANGE_TYPE_META,
  CURRENT_VERSION,
  VERSION_LOG,
  type ChangeType,
} from "@/lib/version-log";
import { cn } from "@/lib/utils";

export async function generateMetadata() {
  const t = await getTranslations("changelog");
  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
  };
}

// 版本字串含點號，JSON 鍵不便用點號，這裡統一把點號換成底線當鍵。
const versionKey = (version: string) => version.replace(/\./g, "_");

const VERSION_SCHEME_PARTS = ["MAJOR", "MINOR", "PATCH"] as const;

export default function ChangelogPage() {
  const t = useTranslations("changelog");

  return (
    <div className="mx-auto w-full max-w-3xl space-y-10 px-4 py-8 sm:px-6">
      {/* HERO */}
      <header className="space-y-3 border-b pb-6">
        <div className="flex items-center gap-3">
          <Badge variant="secondary" className="font-mono">
            {t("badge")}
          </Badge>
          <Badge className="font-mono">v{CURRENT_VERSION}</Badge>
        </div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          {t("heading")}
        </h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {t("introBefore")}
          <span className="font-mono">MAJOR.MINOR.PATCH</span>
          {t("introAfter")}
        </p>
      </header>

      {/* 版本號規則 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("schemeTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-baseline gap-1 font-mono text-2xl font-semibold tracking-tight">
            <span className="text-emerald-600">MAJOR</span>
            <span className="text-muted-foreground">.</span>
            <span className="text-sky-600">MINOR</span>
            <span className="text-muted-foreground">.</span>
            <span className="text-amber-600">PATCH</span>
          </div>
          <ul className="space-y-2 text-sm">
            {VERSION_SCHEME_PARTS.map((part) => (
              <li key={part} className="flex gap-3">
                <span className="w-16 shrink-0 font-mono text-xs font-semibold text-muted-foreground">
                  {part}
                </span>
                <span>
                  <span className="font-medium">
                    {t(`scheme.${part}.name`)}
                  </span>
                  <span className="text-muted-foreground">
                    {" "}
                    — {t(`scheme.${part}.desc`)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {/* Timeline */}
      <div className="space-y-8">
        {VERSION_LOG.map((entry, idx) => {
          const vk = versionKey(entry.version);
          const summary = t(`versions.${vk}.summary`);
          return (
            <section key={entry.version} className="relative pl-6">
              {/* timeline rail */}
              <span
                aria-hidden
                className="absolute left-0 top-1.5 h-3 w-3 rounded-full border-2 border-primary bg-background"
              />
              {idx < VERSION_LOG.length - 1 && (
                <span
                  aria-hidden
                  className="absolute left-[5px] top-5 h-[calc(100%+1.5rem)] w-px bg-border"
                />
              )}

              <div className="space-y-3">
                <div className="flex flex-wrap items-baseline gap-2">
                  <h2 className="font-mono text-xl font-semibold tracking-tight">
                    v{entry.version}
                  </h2>
                  {idx === 0 && (
                    <Badge variant="secondary" className="text-[10px]">
                      {t("latest")}
                    </Badge>
                  )}
                  {entry.date && (
                    <time className="text-xs text-muted-foreground">
                      {entry.date}
                    </time>
                  )}
                </div>

                <p className="text-sm font-medium">
                  {t(`versions.${vk}.title`)}
                </p>
                {summary && (
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {summary}
                  </p>
                )}

                <ul className="space-y-2">
                  {entry.changes.map((c, i) => (
                    <li
                      key={i}
                      className="flex gap-2 text-sm leading-relaxed"
                    >
                      <ChangeTag type={c.type} />
                      <span className="min-w-0">
                        {t(`versions.${vk}.changes.${i}`)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function ChangeTag({ type }: { type: ChangeType }) {
  const t = useTranslations("changelog");
  const meta = CHANGE_TYPE_META[type];
  return (
    <span
      className={cn(
        "mt-0.5 h-fit shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium",
        meta.className,
      )}
    >
      {t(`changeType.${type}`)}
    </span>
  );
}
