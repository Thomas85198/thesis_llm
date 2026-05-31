"use client";

import { RefreshCwIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { CURRENT_VERSION } from "@/lib/version-log";

const POLL_MS = 60_000;

// Detects when a newer frontend has been deployed while this tab stayed open.
// CURRENT_VERSION is baked into this bundle at build time; /version is served
// by the live server and reflects the deployed version. A mismatch => stale tab.
export function VersionWatcher() {
  const [stale, setStale] = useState(false);
  const t = useTranslations("versionWatcher");

  useEffect(() => {
    if (stale) return; // detected once — stop polling, leave the banner up.

    let cancelled = false;

    async function check() {
      try {
        const res = await fetch("/version", { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { version?: string };
        if (!cancelled && data.version && data.version !== CURRENT_VERSION) {
          setStale(true);
        }
      } catch {
        // Network blip / offline — ignore and retry on the next tick.
      }
    }

    check(); // run immediately on mount
    const id = setInterval(check, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      clearInterval(id);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [stale]);

  if (!stale) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 flex justify-center p-4">
      <div className="flex items-center gap-3 rounded-lg border bg-primary px-4 py-3 text-primary-foreground shadow-lg">
        <RefreshCwIcon className="h-4 w-4 shrink-0" />
        <span className="text-sm font-medium">{t("updated")}</span>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => window.location.reload()}
        >
          {t("updateNow")}
        </Button>
      </div>
    </div>
  );
}
