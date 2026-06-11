"use client";

import { DownloadIcon, RefreshCwIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AdminAuthError,
  downloadAdminUploadFile,
  fetchAdminUploads,
  type UploadEvent,
} from "@/lib/api";

const TOKEN_KEY = "adminToken";

type Filter = "all" | "error";

export default function AdminPage() {
  const t = useTranslations("admin");
  const [token, setToken] = useState<string | null>(null);
  const [tokenInput, setTokenInput] = useState("");
  const [events, setEvents] = useState<UploadEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");

  // Read the saved token once on mount. localStorage is undefined during SSR,
  // so this must happen in an effect (a lazy useState initializer would run on
  // the server and crash) — the one legitimate setState-in-effect here.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- client-only storage read on mount
    setToken(localStorage.getItem(TOKEN_KEY));
  }, []);

  // Apply a load error. Called from .then/.catch callbacks and event handlers,
  // never synchronously in an effect body.
  const applyError = useCallback(
    (e: unknown) => {
      if (e instanceof AdminAuthError) {
        if (e.status === 401) {
          localStorage.removeItem(TOKEN_KEY);
          setToken(null);
          setError(t("authFailed"));
        } else {
          setError(t("disabled"));
        }
        setEvents(null);
        return;
      }
      setError(e instanceof Error ? e.message : String(e));
    },
    [t]
  );

  // Fetch helper for the refresh button (event handlers may setState freely).
  const reload = useCallback(
    (tok: string, f: Filter) =>
      fetchAdminUploads(tok, f === "error" ? "error" : undefined)
        .then((items) => {
          setEvents(items);
          setError(null);
        })
        .catch(applyError),
    [applyError]
  );

  // Load on token/filter change. setState lives in the promise callbacks, not
  // the effect body, so it doesn't trigger cascading renders.
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    fetchAdminUploads(token, filter === "error" ? "error" : undefined)
      .then((items) => {
        if (cancelled) return;
        setEvents(items);
        setError(null);
      })
      .catch((e) => {
        if (!cancelled) applyError(e);
      });
    return () => {
      cancelled = true;
    };
  }, [token, filter, applyError]);

  function handleSubmitToken(e: React.FormEvent) {
    e.preventDefault();
    const tok = tokenInput.trim();
    if (!tok) return;
    localStorage.setItem(TOKEN_KEY, tok);
    setToken(tok);
    setTokenInput("");
  }

  function handleLogout() {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setEvents(null);
    setError(null);
  }

  async function handleDownload(ev: UploadEvent) {
    if (!token) return;
    try {
      await downloadAdminUploadFile(token, ev);
    } catch {
      toast.error(t("downloadFailed"));
    }
  }

  // --- Token gate ---
  if (!token) {
    return (
      <div className="mx-auto w-full max-w-md px-4 py-16 sm:px-6">
        <PageHeader title={t("title")} />
        <form onSubmit={handleSubmitToken} className="space-y-3">
          <label className="text-sm font-medium">{t("tokenPrompt")}</label>
          <Input
            type="password"
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            placeholder={t("tokenPlaceholder")}
            autoFocus
          />
          <Button type="submit" className="w-full">
            {t("tokenSubmit")}
          </Button>
          <p className="text-xs text-muted-foreground">{t("tokenHint")}</p>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </form>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-8 sm:px-6">
      <PageHeader
        title={t("title")}
        description={t("desc")}
        actions={
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => token && reload(token, filter)}
            >
              <RefreshCwIcon className="mr-1 h-4 w-4" />
              {t("refresh")}
            </Button>
            <Button variant="ghost" size="sm" onClick={handleLogout}>
              {t("logout")}
            </Button>
          </div>
        }
      />

      <div className="flex gap-2">
        {(["all", "error"] as const).map((f) => (
          <Button
            key={f}
            variant={filter === f ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter(f)}
          >
            {f === "all" ? t("filterAll") : t("filterError")}
          </Button>
        ))}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {!events && !error && (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      )}

      {events && events.length === 0 && (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      )}

      {events && events.length > 0 && (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr>
                <th className="p-2 text-left">{t("colTime")}</th>
                <th className="p-2 text-left">{t("colFile")}</th>
                <th className="p-2 text-right">{t("colSize")}</th>
                <th className="p-2 text-left">{t("colStatus")}</th>
                <th className="p-2 text-left">{t("colStage")}</th>
                <th className="p-2 text-left">{t("colError")}</th>
                <th className="p-2 text-right">{t("colAction")}</th>
              </tr>
            </thead>
            <tbody>
              {events.map((ev) => (
                <tr key={ev.id} className="border-t align-top hover:bg-accent/30">
                  <td className="whitespace-nowrap p-2 font-mono text-xs">
                    {formatTime(ev.created_at)}
                  </td>
                  <td className="max-w-[18rem] break-words p-2">
                    {ev.filename || "—"}
                  </td>
                  <td className="whitespace-nowrap p-2 text-right font-mono text-xs">
                    {formatSize(ev.file_size)}
                  </td>
                  <td className="p-2">
                    <StatusBadge status={ev.status} label={t(`status.${ev.status}`)} />
                  </td>
                  <td className="p-2 text-xs">{ev.error_stage || "—"}</td>
                  <td
                    className="max-w-[24rem] break-words p-2 text-xs text-muted-foreground"
                    title={ev.error_message || undefined}
                  >
                    {ev.error_type ? (
                      <span>
                        <span className="font-medium text-foreground">
                          {ev.error_type}
                        </span>
                        {ev.error_message ? `: ${truncate(ev.error_message)}` : ""}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="whitespace-nowrap p-2 text-right">
                    {ev.pdf_path ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleDownload(ev)}
                      >
                        <DownloadIcon className="mr-1 h-3.5 w-3.5" />
                        {t("download")}
                      </Button>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status, label }: { status: UploadEvent["status"]; label: string }) {
  const variant =
    status === "error"
      ? "destructive"
      : status === "done"
        ? "outline"
        : "secondary";
  return <Badge variant={variant}>{label}</Badge>;
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function formatSize(bytes: number | null): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function truncate(s: string, n = 160): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}
