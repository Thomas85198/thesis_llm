"use client";

import { UploadIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { useRouter } from "@/i18n/navigation";
import { useJobTracker } from "@/components/job-tracker";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { uploadPaper } from "@/lib/api";
import { STATUS_PROGRESS } from "@/lib/job-status";
import { cn } from "@/lib/utils";

// Mirrors the file input's `accept` — dropped files bypass the picker filter.
const ACCEPTED_EXTENSIONS = [".pdf", ".txt", ".md"];

export function UploadForm() {
  const t = useTranslations("upload");
  const tStatus = useTranslations("jobStatus");
  const router = useRouter();
  const { active, startJob, isProcessing } = useJobTracker();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Busy = the brief upload POST window, or an analysis already running globally.
  const busy = submitting || isProcessing;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file || busy) return;
    setSubmitting(true);
    setUploadError(null);

    try {
      const { job_id, paper_id, cached } = await uploadPaper(file, title);

      if (cached) {
        toast.success(t("cacheHitTitle"), {
          description: t("cacheHitDesc"),
        });
        router.push(`/papers/${encodeURIComponent(paper_id)}`);
        return;
      }

      // Hand off to the global tracker: polling, notification and the header
      // pill now follow the user across pages.
      startJob(job_id, paper_id, title || file.name);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err));
      toast.error(t("uploadFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{t("cardTitle")}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Dropzone — primary action, big touch target */}
          <div
            role="button"
            tabIndex={0}
            onClick={() => !busy && inputRef.current?.click()}
            onKeyDown={(e) => {
              if ((e.key === "Enter" || e.key === " ") && !busy) {
                e.preventDefault();
                inputRef.current?.click();
              }
            }}
            onDragOver={(e) => {
              e.preventDefault();
              if (!busy) setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragActive(false);
              if (busy) return;
              const f = e.dataTransfer.files?.[0];
              if (!f) return;
              const ok = ACCEPTED_EXTENSIONS.some((ext) =>
                f.name.toLowerCase().endsWith(ext),
              );
              if (!ok) {
                toast.error(t("invalidFileType"));
                return;
              }
              setFile(f);
            }}
            className={cn(
              "flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 text-center transition",
              busy
                ? "cursor-not-allowed opacity-60"
                : "cursor-pointer hover:border-primary/50 hover:bg-muted/50",
              dragActive
                ? "border-primary bg-primary/5"
                : "border-muted-foreground/25",
            )}
          >
            <UploadIcon className="h-8 w-8 text-muted-foreground" />
            {file ? (
              <div className="min-w-0">
                <p className="truncate font-medium">{file.name}</p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {(file.size / 1024).toFixed(1)} KB · {t("fileReplace")}
                </p>
              </div>
            ) : (
              <div>
                <p className="font-medium">{t("dropHint")}</p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {t("formats")}
                </p>
              </div>
            )}
            <input
              ref={inputRef}
              id="file"
              type="file"
              accept=".pdf,.txt,.md"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              disabled={busy}
              className="hidden"
            />
          </div>

          {/* Optional title */}
          <div className="space-y-1.5">
            <Label htmlFor="title">{t("titleLabel")}</Label>
            <Input
              id="title"
              placeholder={t("titlePlaceholder")}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={busy}
              className="h-11"
            />
            <p className="text-xs text-muted-foreground">{t("titleHelp")}</p>
          </div>

          <Button
            type="submit"
            size="lg"
            disabled={!file || busy}
            className="h-12 w-full text-base"
          >
            {busy ? t("analyzing") : t("start")}
          </Button>
        </form>

        {isProcessing && active && (
          <div className="mt-6 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">{tStatus(active.status)}</span>
              <span className="text-muted-foreground">{t("etaHint")}</span>
            </div>
            <Progress value={STATUS_PROGRESS[active.status]} />
            <p className="text-xs text-muted-foreground">{t("bgHint")}</p>
            {active.message && (
              <p className="text-xs text-muted-foreground">{active.message}</p>
            )}
            <p className="text-xs text-muted-foreground">
              Job: <code className="font-mono">{active.jobId}</code>
              {" · "}Paper: <code className="font-mono">{active.paperId}</code>
            </p>
          </div>
        )}

        {uploadError && (
          <div className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            <p className="font-semibold">{t("errorTitle")}</p>
            <p className="mt-1 break-all">{uploadError}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
