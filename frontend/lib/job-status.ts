import type { JobStatus } from "@/lib/api";

// Status display labels live in messages/*.json under the "jobStatus" namespace
// (keyed by JobStatus) so they localize. This module stays data-only.
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
