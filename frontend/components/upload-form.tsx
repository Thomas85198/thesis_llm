"use client";

import { UploadIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

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
import { fetchJob, uploadPaper, type JobStatus } from "@/lib/api";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Record<JobStatus, string> = {
  queued: "排隊中",
  extracting: "抽取 EDU / ER / RST / FRU",
  checking: "執行 13 條 REL 規則檢核",
  done: "完成",
  error: "失敗",
};

const STATUS_PROGRESS: Record<JobStatus, number> = {
  queued: 5,
  extracting: 40,
  checking: 80,
  done: 100,
  error: 100,
};

export function UploadForm() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [paperId, setPaperId] = useState<string | null>(null);
  const [status, setStatus] = useState<JobStatus | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setSubmitting(true);
    setError(null);
    setStatus(null);

    try {
      const { job_id, paper_id, cached } = await uploadPaper(file, title);
      setJobId(job_id);
      setPaperId(paper_id);

      if (cached) {
        setStatus("done");
        setMessage("命中快取，直接顯示之前的分析結果。");
        toast.success("命中快取", {
          description: "相同檔案已分析過，跳過重新處理",
        });
        router.push(`/papers/${encodeURIComponent(paper_id)}`);
        return;
      }

      setStatus("queued");
      setMessage("等待後端開始處理…");

      const tick = async () => {
        try {
          const job = await fetchJob(job_id);
          setStatus(job.status);
          setMessage(job.message ?? "");
          if (job.status === "done") {
            if (pollRef.current) clearInterval(pollRef.current);
            toast.success("分析完成", {
              description: `共 ${job.result?.defects.length ?? 0} 個缺陷`,
            });
            router.push(`/papers/${encodeURIComponent(paper_id)}`);
          } else if (job.status === "error") {
            if (pollRef.current) clearInterval(pollRef.current);
            setError(job.error ?? "未知錯誤");
            toast.error("分析失敗", { description: job.error });
            setSubmitting(false);
          }
        } catch (err) {
          if (pollRef.current) clearInterval(pollRef.current);
          setError(err instanceof Error ? err.message : String(err));
          setSubmitting(false);
        }
      };

      // Poll once immediately, then on a 2s interval.
      tick();
      pollRef.current = setInterval(tick, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      toast.error("上傳失敗");
      setSubmitting(false);
    }
  }

  const progress = status ? STATUS_PROGRESS[status] : 0;
  const isProcessing = submitting && status !== "error";

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
            onClick={() => !isProcessing && inputRef.current?.click()}
            onKeyDown={(e) => {
              if ((e.key === "Enter" || e.key === " ") && !isProcessing) {
                e.preventDefault();
                inputRef.current?.click();
              }
            }}
            onDragOver={(e) => {
              e.preventDefault();
              if (!isProcessing) setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragActive(false);
              if (isProcessing) return;
              const f = e.dataTransfer.files?.[0];
              if (f) setFile(f);
            }}
            className={cn(
              "flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 text-center transition",
              isProcessing
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
              disabled={isProcessing}
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
              disabled={isProcessing}
              className="h-11"
            />
            <p className="text-xs text-muted-foreground">
              通常不用填，系統會自動讀出論文標題；想覆寫再手動輸入。
            </p>
          </div>

          <Button
            type="submit"
            size="lg"
            disabled={!file || isProcessing}
            className="h-12 w-full text-base"
          >
            {isProcessing ? "分析中…" : "開始分析"}
          </Button>
        </form>

        {status && (
          <div className="mt-6 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">{STATUS_LABEL[status]}</span>
              {status !== "done" && status !== "error" && (
                <span className="text-muted-foreground">
                  通常需要 1–10 分鐘，視論文長度
                </span>
              )}
            </div>
            <Progress value={progress} />
            {message && (
              <p className="text-xs text-muted-foreground">{message}</p>
            )}
            {jobId && (
              <p className="text-xs text-muted-foreground">
                Job: <code className="font-mono">{jobId}</code>
                {paperId && (
                  <>
                    {" · "}Paper: <code className="font-mono">{paperId}</code>
                  </>
                )}
              </p>
            )}
          </div>
        )}

        {error && (
          <div className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            <p className="font-semibold">錯誤</p>
            <p className="mt-1 break-all">{error}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
