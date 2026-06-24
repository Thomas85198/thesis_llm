"use client";
// Writing progress widget for the status row: live 字數, an optional word-count
// goal with a progress bar, and a per-chapter (h1) breakdown so thesis writers
// can track total progress and chapter balance. The goal is remembered per-doc.
// Pure client-side counting — no LLM / token cost.
import type { Editor } from "@tiptap/core";
import { Target } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";

type Chapter = { title: string; chars: number };

const nonWs = (s: string) => s.replace(/\s/g, "").length;
const goalKey = (docId: string) => `editor:goal:${docId}`;

function computeChapters(
  editor: Editor,
  prefaceLabel: string,
  untitled: string,
) {
  let cur: Chapter = { title: prefaceLabel, chars: 0 };
  const chapters: Chapter[] = [cur];
  editor.state.doc.forEach((node) => {
    const n = nonWs(node.textContent);
    if (node.type.name === "heading" && node.attrs.level === 1) {
      cur = { title: node.textContent.trim() || untitled, chars: n };
      chapters.push(cur);
    } else {
      cur.chars += n;
    }
  });
  // Drop the pre-chapter bucket when the doc starts with a chapter.
  return chapters.filter(
    (c, i) => !(i === 0 && c.title === prefaceLabel && c.chars === 0),
  );
}

export function WritingProgress({
  editor,
  docId,
}: {
  editor: Editor;
  docId: string;
}) {
  const t = useTranslations("editor");
  const [total, setTotal] = useState(0);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [goal, setGoal] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Load the saved goal once.
  useEffect(() => {
    const raw =
      typeof window !== "undefined"
        ? window.localStorage.getItem(goalKey(docId))
        : null;
    const n = raw ? Number(raw) : NaN;
    setGoal(Number.isFinite(n) && n > 0 ? n : null);
  }, [docId]);

  // Recount on every edit.
  useEffect(() => {
    const update = () => {
      setTotal(nonWs(editor.state.doc.textContent));
      setChapters(
        computeChapters(editor, t("progress.preface"), t("progress.untitled")),
      );
    };
    update();
    editor.on("update", update);
    return () => {
      editor.off("update", update);
    };
  }, [editor, t]);

  // Close the popover on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const saveGoal = useCallback(
    (v: number | null) => {
      setGoal(v);
      if (typeof window === "undefined") return;
      if (v && v > 0) window.localStorage.setItem(goalKey(docId), String(v));
      else window.localStorage.removeItem(goalKey(docId));
    },
    [docId],
  );

  const pct = goal ? Math.min(100, Math.round((total / goal) * 100)) : 0;

  return (
    <div ref={wrapRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 whitespace-nowrap rounded-md px-1.5 py-0.5 text-xs tabular-nums text-muted-foreground transition hover:bg-accent"
        title={t("progress.label")}
      >
        <Target className="h-3.5 w-3.5" />
        {t("progress.words", { chars: total })}
        {goal ? (
          <span className="font-medium text-primary">· {pct}%</span>
        ) : null}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-30 mt-1.5 w-72 rounded-lg border bg-popover p-3 text-popover-foreground shadow-lg">
          {/* Goal */}
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-medium">
              {t("progress.goalLabel")}
            </span>
            {goal ? (
              <button
                type="button"
                onClick={() => saveGoal(null)}
                className="text-[11px] text-muted-foreground hover:text-foreground hover:underline"
              >
                {t("progress.clearGoal")}
              </button>
            ) : null}
          </div>
          <input
            type="number"
            min={0}
            step={500}
            value={goal ?? ""}
            placeholder={t("progress.goalPlaceholder")}
            onChange={(e) => {
              const v = e.target.value ? Number(e.target.value) : null;
              saveGoal(v && v > 0 ? v : null);
            }}
            className="w-full rounded-md border bg-background px-2 py-1 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          {goal ? (
            <div className="mt-2">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground tabular-nums">
                {t("progress.ofGoal", { current: total, goal })} · {pct}%
              </p>
            </div>
          ) : (
            <p className="mt-1 text-[11px] text-muted-foreground">
              {t("progress.noGoal")}
            </p>
          )}

          {/* Per-chapter breakdown */}
          {chapters.length > 0 && (
            <div className="mt-3 border-t pt-2">
              <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {t("progress.byChapter")}
              </p>
              <ul className="flex max-h-48 flex-col gap-1 overflow-auto pr-1">
                {chapters.map((c, i) => (
                  <li
                    key={i}
                    className="flex items-center justify-between gap-2 text-xs"
                  >
                    <span className="min-w-0 truncate">{c.title}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {t("progress.words", { chars: c.chars })}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
