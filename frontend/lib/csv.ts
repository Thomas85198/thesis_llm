import type { Defect, EDU } from "@/lib/api";

function csvField(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

const HEADERS = [
  "rule_id",
  "defect_type",
  "severity",
  "section",
  "page",
  "evidence_text",
  "description",
  "suggestion",
];

export function defectsToCsv(
  defects: Defect[],
  eduMap: Map<string, EDU>
): string {
  const rows = defects.map((d) => {
    const evidenceTexts = d.evidence_edu_ids
      .map((eid) => eduMap.get(eid)?.text ?? "")
      .filter(Boolean);
    const pages = Array.from(
      new Set(
        d.evidence_edu_ids
          .map((eid) => eduMap.get(eid)?.page)
          .filter((p): p is number => typeof p === "number")
          .map((p) => p + 1) // human-readable page numbers
      )
    ).sort((a, b) => a - b);
    return [
      d.rule_id,
      d.defect_type,
      d.severity,
      d.section,
      pages.join(" / "),
      evidenceTexts.join(" || ").trim(),
      d.description,
      d.suggestion,
    ];
  });

  const lines = [
    HEADERS.join(","),
    ...rows.map((r) => r.map(csvField).join(",")),
  ];
  return lines.join("\r\n");
}

/** Trigger a browser download for the given CSV string. UTF-8 BOM included so Excel opens 中文 cleanly. */
export function downloadCsv(filename: string, csv: string) {
  const BOM = "﻿";
  const blob = new Blob([BOM + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
