"use client";

import { UploadIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { useJobTracker } from "@/components/job-tracker";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { uploadPaper } from "@/lib/api";
import { STATUS_LABEL, STATUS_PROGRESS } from "@/lib/job-status";
import { cn } from "@/lib/utils";

export function UploadForm() {
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
        toast.success("命中快取", {
          description: "相同檔案已分析過，跳過重新處理",
        });
        router.push(`/papers/${encodeURIComponent(paper_id)}`);
        return;
      }

      // Hand off to the global tracker: polling, notification and the header
      // pill now follow the user across pages.
      startJob(job_id, paper_id, title || file.name);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err));
      toast.error("上傳失敗");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">上傳論文</CardTitle>
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
              if (f) setFile(f);
            }}
            className={cn(
              "flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 text-center transition",
              busy
                ? "cursor-not-allowed opacity-60"
                : "cursor-pointer hover:border-primary/50 hover:bg-muted/50",
              dragActive
                ? "border-primary bg-primary/5"
                : "border-muted-foreground/25"
            )}
          >
            <UploadIcon className="h-8 w-8 text-muted-foreground" />
            {file ? (
              <div className="min-w-0">
                <p className="truncate font-medium">{file.name}</p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {(file.size / 1024).toFixed(1)} KB · 點擊或拖放可更換
                </p>
              </div>
            ) : (
              <div>
                <p className="font-medium">拖放檔案到此，或點擊選擇</p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  支援 PDF / TXT / MD（中・英）
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
            <Label htmlFor="title">標題（選填）</Label>
            <Input
              id="title"
              placeholder="留空則自動從論文內容偵測標題"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={busy}
              className="h-11"
            />
            <p className="text-xs text-muted-foreground">
              通常不用填，系統會自動讀出論文標題；想覆寫再手動輸入。
            </p>
          </div>

          <Button
            type="submit"
            size="lg"
            disabled={!file || busy}
            className="h-12 w-full text-base"
          >
            {busy ? "分析中…" : "開始分析"}
          </Button>
        </form>

        {isProcessing && active && (
          <div className="mt-6 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">{STATUS_LABEL[active.status]}</span>
              <span className="text-muted-foreground">
                通常需要 1–10 分鐘，視論文長度
              </span>
            </div>
            <Progress value={STATUS_PROGRESS[active.status]} />
            <p className="text-xs text-muted-foreground">
              可切到其他頁或關掉分頁去做別的事 — 分析會在背景完成，完成時通知你。
            </p>
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
            <p className="font-semibold">錯誤</p>
            <p className="mt-1 break-all">{uploadError}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
