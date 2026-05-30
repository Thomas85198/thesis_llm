"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

import { fetchJob, fetchPaperResult, type JobStatus } from "@/lib/api";
import { isProcessingStatus } from "@/lib/job-status";
import { fireDoneNotification, requestNotifyPermission } from "@/lib/notify";

const POLL_MS = 2000;
const STORAGE_KEY = "paperchecker:activeJob";
const DONE_TITLE = "✅ 分析完成 — 論文檢核系統";

export type ActiveJob = {
  jobId: string;
  paperId: string;
  title: string;
  status: JobStatus;
  message: string;
};

type JobTrackerValue = {
  active: ActiveJob | null;
  isProcessing: boolean;
  startJob: (jobId: string, paperId: string, title: string) => void;
  clearJob: () => void;
};

const JobTrackerContext = createContext<JobTrackerValue | null>(null);

export function useJobTracker(): JobTrackerValue {
  const ctx = useContext(JobTrackerContext);
  if (!ctx) throw new Error("useJobTracker must be used within JobTrackerProvider");
  return ctx;
}

export function JobTrackerProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [active, setActive] = useState<ActiveJob | null>(null);
  const origTitleRef = useRef<string | null>(null);

  const processing = isProcessingStatus(active?.status);

  // Hydrate from localStorage once (resume after a reload).
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (raw) setActive(JSON.parse(raw) as ActiveJob);
    } catch {
      /* ignore corrupt value */
    }
  }, []);

  // Persist.
  useEffect(() => {
    try {
      if (active) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(active));
      else window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* storage unavailable — non-fatal */
    }
  }, [active]);

  const startJob = useCallback(
    (jobId: string, paperId: string, title: string) => {
      setActive({
        jobId,
        paperId,
        title,
        status: "queued",
        message: "等待後端開始處理…",
      });
      // Fired from the submit-button gesture so the browser allows the prompt.
      void requestNotifyPermission();
    },
    []
  );

  const clearJob = useCallback(() => setActive(null), []);

  const markDone = useCallback(
    (paperId: string, title: string, defectCount: number | null) => {
      setActive((p) =>
        p
          ? { ...p, status: "done", message: "完成" }
          : { jobId: "", paperId, title, status: "done", message: "完成" }
      );
      const open = () => router.push(`/papers/${encodeURIComponent(paperId)}`);
      toast.success("分析完成", {
        description: defectCount != null ? `共 ${defectCount} 個缺陷` : undefined,
        action: { label: "查看結果", onClick: open },
        duration: 12000,
      });
      fireDoneNotification({ title, defectCount, onOpen: open });
      // Cross-context fallback: flash the tab title if the user is elsewhere.
      if (typeof document !== "undefined" && document.hidden) {
        if (origTitleRef.current == null) origTitleRef.current = document.title;
        document.title = DONE_TITLE;
      }
    },
    [router]
  );

  // Restore the flashed tab title once the user comes back.
  useEffect(() => {
    const restore = () => {
      if (!document.hidden && origTitleRef.current != null) {
        document.title = origTitleRef.current;
        origTitleRef.current = null;
      }
    };
    window.addEventListener("focus", restore);
    document.addEventListener("visibilitychange", restore);
    return () => {
      window.removeEventListener("focus", restore);
      document.removeEventListener("visibilitychange", restore);
    };
  }, []);

  // Warn before closing / reloading the whole tab while processing.
  useEffect(() => {
    if (!processing) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [processing]);

  // Poll the active job. Keyed on jobId so status updates don't thrash the
  // interval; job id / paper id / title are stable for a given run.
  useEffect(() => {
    const job0 = active;
    if (!job0 || !isProcessingStatus(job0.status)) return;
    const { jobId, paperId, title } = job0;
    let cancelled = false;

    const tick = async () => {
      try {
        const job = await fetchJob(jobId);
        if (cancelled) return;
        if (job.status === "done") {
          markDone(paperId, title, job.result?.defects.length ?? null);
        } else if (job.status === "error") {
          toast.error("分析失敗", { description: job.error });
          setActive(null);
        } else {
          setActive((p) =>
            p && p.jobId === jobId
              ? { ...p, status: job.status, message: job.message ?? "" }
              : p
          );
        }
      } catch (e) {
        // Job record gone (backend restarted): the result may still be in
        // SQLite — fall back to the paper result before giving up.
        if (String(e).includes("404")) {
          try {
            await fetchPaperResult(paperId);
            if (!cancelled) markDone(paperId, title, null);
          } catch {
            if (!cancelled) {
              toast("先前的分析已中斷", {
                description: "後端可能已重啟，請重新上傳。",
              });
              setActive(null);
            }
          }
        }
        // Other (transient network) errors: ignore and retry next tick.
      }
    };

    tick();
    const id = setInterval(tick, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") tick();
    };
    window.addEventListener("focus", tick);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearInterval(id);
      window.removeEventListener("focus", tick);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.jobId, markDone]);

  return (
    <JobTrackerContext.Provider
      value={{ active, isProcessing: processing, startJob, clearJob }}
    >
      {children}
    </JobTrackerContext.Provider>
  );
}
