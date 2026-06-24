"use client";
// Live 字數 / word counter for the status row. Isolated into its own component
// (subscribes to the editor's `update` event) so it re-renders on every edit
// without re-rendering the whole editor — and it's computed once on mount, so
// it's correct on load, not only after the first keystroke.
import type { Editor } from "@tiptap/core";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

export function WordCount({ editor }: { editor: Editor }) {
  const t = useTranslations("editor");
  const [c, setC] = useState({ chars: 0, words: 0 });

  useEffect(() => {
    const update = () => {
      const text = editor.state.doc.textContent;
      const trimmed = text.trim();
      setC({
        chars: text.replace(/\s/g, "").length, // 字數 excludes whitespace
        words: trimmed ? trimmed.split(/\s+/).length : 0,
      });
    };
    update();
    editor.on("update", update);
    return () => {
      editor.off("update", update);
    };
  }, [editor]);

  return (
    <span className="shrink-0 whitespace-nowrap text-xs tabular-nums text-muted-foreground">
      {t("wordCount.summary", { chars: c.chars, words: c.words })}
    </span>
  );
}
