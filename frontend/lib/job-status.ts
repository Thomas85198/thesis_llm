import type { JobStatus } from "@/lib/api";

export const STATUS_LABEL: Record<JobStatus, string> = {
  queued: "排隊中",
  extracting: "抽取 EDU / ER / RST / FRU",
  checking: "執行 13 條 REL 規則檢核",
  done: "完成",
  error: "失敗",
};

export const STATUS_PROGRESS: Record<JobStatus, number> = {
  queued: 5,
  extracting: 40,
  checking: 80,
  done: 100,
  error: 100,
};

// Statuses where the analysis is still running in the background.
export const PROCESSING_STATUSES: JobStatus[] = [
  "queued",
  "extracting",
  "checking",
];

export function isProcessingStatus(s: JobStatus | null | undefined): boolean {
  return s != null && PROCESSING_STATUSES.includes(s);
}
