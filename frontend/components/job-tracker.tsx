"use client";

import { useTranslations } from "next-intl";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

import { useRouter } from "@/i18n/navigation";
import { fetchJob, fetchPaperResult, type JobStatus } from "@/lib/api";
import { isProcessingStatus } from "@/lib/job-status";
import { fireDoneNotification, requestNotifyPermission } from "@/lib/notify";

const POLL_MS = 2000;
const STORAGE_KEY = "paperchecker:activeJob";
// Cross-tab title flash (shown when the user is on another tab) — kept in
// English regardless of locale, since the active UI locale isn't meaningful
// for an out-of-focus tab.
const DONE_TITLE = "✅ Analysis complete — Paper Review System";
// Auto-dismiss the "done" pill if the user never acts on it.
const DONE_AUTO_DISMISS_MS = 180_000; // 3 minutes
// Give up polling after this many consecutive non-404 failures (~60s at
// POLL_MS) — the backend is unreachable, not just momentarily busy.
const MAX_POLL_ERRORS = 30;

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
  if (!ctx)
    throw new Error("useJobTracker must be used within JobTrackerProvider");
  return ctx;
}

export function JobTrackerProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const t = useTranslations("jobIndicator");
  const [active, setActive] = useState<ActiveJob | null>(null);
  const origTitleRef = useRef<string | null>(null);
  // Guards against firing the completion toast/notification more than once for
  // the same job (a stray poll tick could otherwise re-trigger it).
  const doneNotifiedRef = useRef<string | null>(null);

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
      if (active)
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(active));
      else window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* storage unavailable — non-fatal */
    }
  }, [active]);

  const startJob = useCallback(
    (jobId: string, paperId: string, title: string) => {
      doneNotifiedRef.current = null;
      setActive({
        jobId,
        paperId,
        title,
        status: "queued",
        message: t("waitingBackend"),
      });
      // Fired from the submit-button gesture so the browser allows the prompt.
      void requestNotifyPermission();
    },
    [t],
  );

  const clearJob = useCallback(() => setActive(null), []);

  const markDone = useCallback(
    (paperId: string, title: string, defectCount: number | null) => {
      setActive((p) =>
        p
          ? { ...p, status: "done", message: "done" }
          : { jobId: "", paperId, title, status: "done", message: "done" },
      );
      const open = () => router.push(`/papers/${encodeURIComponent(paperId)}`);
      toast.success(t("toastDone"), {
        description:
          defectCount != null
            ? t("toastDefects", { count: defectCount })
            : undefined,
        action: { label: t("viewResults"), onClick: open },
        duration: 12000,
      });
      fireDoneNotification({ title, defectCount, onOpen: open });
      // Cross-context fallback: flash the tab title if the user is elsewhere.
      if (typeof document !== "undefined" && document.hidden) {
        if (origTitleRef.current == null) origTitleRef.current = document.title;
        document.title = DONE_TITLE;
      }
    },
    [router, t],
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

  // Auto-dismiss the "done" pill after a few minutes if untouched.
  useEffect(() => {
    if (active?.status !== "done") return;
    const t = setTimeout(() => clearJob(), DONE_AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [active?.status, clearJob]);

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
    let pollErrors = 0; // consecutive non-404 failures

    const tick = async () => {
      try {
        const job = await fetchJob(jobId);
        if (cancelled) return;
        pollErrors = 0;
        if (job.status === "done") {
          if (doneNotifiedRef.current !== jobId) {
            doneNotifiedRef.current = jobId;
            markDone(paperId, title, job.result?.defects.length ?? null);
          }
        } else if (job.status === "error") {
          toast.error(t("analysisFailed"), { description: job.error });
          setActive(null);
        } else {
          setActive((p) =>
            p && p.jobId === jobId
              ? { ...p, status: job.status, message: job.message ?? "" }
              : p,
          );
        }
      } catch (e) {
        // Job record gone (backend restarted): the result may still be in
        // SQLite — fall back to the paper result before giving up.
        if (String(e).includes("404")) {
          try {
            await fetchPaperResult(paperId);
            if (!cancelled && doneNotifiedRef.current !== jobId) {
              doneNotifiedRef.current = jobId;
              markDone(paperId, title, null);
            }
          } catch {
            if (!cancelled) {
              toast(t("jobInterrupted"), {
                description: t("jobInterruptedDesc"),
              });
              setActive(null);
            }
          }
          return;
        }
        // Other (transient network) errors: retry next tick — but not forever.
        // Clearing the job also releases the beforeunload guard.
        pollErrors += 1;
        // === (not >=) so a straggler tick can't fire the toast twice before
        // the effect cleanup lands.
        if (!cancelled && pollErrors === MAX_POLL_ERRORS) {
          toast.error(t("jobInterrupted"), {
            description: t("jobInterruptedDesc"),
          });
          setActive(null);
        }
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
  }, [active?.jobId, processing, markDone, t]);

  return (
    <JobTrackerContext.Provider
      value={{ active, isProcessing: processing, startJob, clearJob }}
    >
      {children}
    </JobTrackerContext.Provider>
  );
}
