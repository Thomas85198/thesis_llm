import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  CHANGE_TYPE_META,
  CURRENT_VERSION,
  VERSION_LOG,
  type ChangeType,
} from "@/lib/version-log";
import { cn } from "@/lib/utils";

export const metadata = {
  title: "版本紀錄 · 論文檢核系統",
  description: "版本紀錄與三碼語意化版本號規則",
};

const VERSION_SCHEME: { part: string; name: string; desc: string }[] = [
  { part: "MAJOR", name: "主版本", desc: "架構性大改 / 不相容的破壞性變更" },
  { part: "MINOR", name: "次版本", desc: "新增功能，向後相容" },
  { part: "PATCH", name: "修訂版本", desc: "bug 修復、小調整，不改變對外行為" },
];

export default function ChangelogPage() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-10 px-4 py-8 sm:px-6">
      {/* HERO */}
      <header className="space-y-3 border-b pb-6">
        <div className="flex items-center gap-3">
          <Badge variant="secondary" className="font-mono">
            版本紀錄 / Changelog
          </Badge>
          <Badge className="font-mono">v{CURRENT_VERSION}</Badge>
        </div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">版本紀錄</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          記錄每次改版的功能、修復與調整。版本號採用三碼語意化版本（
          <span className="font-mono">MAJOR.MINOR.PATCH</span>）。
        </p>
      </header>

      {/* 版本號規則 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">版本號規則</CardTitle>
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
            {VERSION_SCHEME.map((s) => (
              <li key={s.part} className="flex gap-3">
                <span className="w-16 shrink-0 font-mono text-xs font-semibold text-muted-foreground">
                  {s.part}
                </span>
                <span>
                  <span className="font-medium">{s.name}</span>
                  <span className="text-muted-foreground"> — {s.desc}</span>
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {/* Timeline */}
      <div className="space-y-8">
        {VERSION_LOG.map((entry, idx) => (
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
                    最新
                  </Badge>
                )}
                {entry.date && (
                  <time className="text-xs text-muted-foreground">{entry.date}</time>
                )}
              </div>

              <p className="text-sm font-medium">{entry.title}</p>
              {entry.summary && (
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {entry.summary}
                </p>
              )}

              <ul className="space-y-2">
                {entry.changes.map((c, i) => (
                  <li key={i} className="flex gap-2 text-sm leading-relaxed">
                    <ChangeTag type={c.type} />
                    <span className="min-w-0">{c.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function ChangeTag({ type }: { type: ChangeType }) {
  const meta = CHANGE_TYPE_META[type];
  return (
    <span
      className={cn(
        "mt-0.5 h-fit shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium",
        meta.className,
      )}
    >
      {meta.label}
    </span>
  );
}
