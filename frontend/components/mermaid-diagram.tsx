"use client";

import { useEffect, useId, useRef, useState } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type Props = {
  code: string;
  className?: string;
  caption?: string;
};

export function MermaidDiagram({ code, className, caption }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const id = useId().replace(/[:]/g, "-");
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mermaidLib = (await import("mermaid")).default;
        mermaidLib.initialize({
          startOnLoad: false,
          theme: "neutral",
          securityLevel: "loose",
          fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
          flowchart: { curve: "basis", htmlLabels: true },
          sequence: { actorMargin: 60, messageAlign: "center" },
        });
        const { svg } = await mermaidLib.render(`mermaid-${id}`, code);
        if (cancelled) return;
        if (ref.current) {
          ref.current.innerHTML = svg;
          setReady(true);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, id]);

  return (
    <figure className={cn("my-4", className)}>
      <div className="overflow-x-auto rounded-md border bg-card p-4">
        {!ready && !error && <Skeleton className="h-48 w-full" />}
        {error && (
          <p className="text-sm text-destructive">
            圖表渲染失敗：{error}
          </p>
        )}
        <div ref={ref} className={cn("[&_svg]:mx-auto", !ready && "hidden")} />
      </div>
      {caption && (
        <figcaption className="mt-2 text-center text-xs text-muted-foreground">
          {caption}
        </figcaption>
      )}
    </figure>
  );
}
