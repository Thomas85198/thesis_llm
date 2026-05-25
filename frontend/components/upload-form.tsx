"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { fetchJob, uploadPaper, type JobStatus } from "@/lib/api";

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
        <CardTitle>上傳論文</CardTitle>
        <CardDescription>支援 PDF 或純文字（中/英）</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="title">標題（選填）</Label>
            <Input
              id="title"
              placeholder="留空則自動從論文內容偵測標題"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={isProcessing}
            />
            <p className="text-xs text-muted-foreground">
              通常不用填，系統會自動讀出論文標題；想覆寫再手動輸入。
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="file">檔案</Label>
            <Input
              id="file"
              type="file"
              accept=".pdf,.txt,.md"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              disabled={isProcessing}
              required
              className="file:mr-3 file:cursor-pointer file:rounded file:border-0 file:bg-primary/10 file:px-3 file:py-1 file:text-sm file:text-primary"
            />
            {file && (
              <p className="text-xs text-muted-foreground">
                {file.name} · {(file.size / 1024).toFixed(1)} KB
              </p>
            )}
          </div>

          <Button
            type="submit"
            disabled={!file || isProcessing}
            className="w-full sm:w-auto"
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
