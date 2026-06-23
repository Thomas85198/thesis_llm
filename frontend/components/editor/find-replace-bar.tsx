"use client";
// Find & Replace bar — a compact floating panel at the top-right of the editor.
// Drives the SearchReplace extension's commands and reads its match count via a
// transaction subscription. Opened with ⌘/Ctrl+F or the toolbar; Esc closes.
import type { Editor } from "@tiptap/core";
import {
  ArrowDown,
  ArrowUp,
  CaseSensitive,
  Replace,
  ReplaceAll,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { searchKey } from "@/components/editor/search-replace-extension";
import { useEditorStore } from "@/lib/editor-store";
import { Button } from "@/components/ui/button";

export function FindReplaceBar({ editor }: { editor: Editor }) {
  const t = useTranslations("editor");
  const open = useEditorStore((s) => s.findOpen);
  const close = useEditorStore((s) => s.closeFind);

  const [term, setTerm] = useState("");
  const [replacement, setReplacement] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [count, setCount] = useState({ current: -1, total: 0 });
  const inputRef = useRef<HTMLInputElement>(null);

  // Push the term into the extension whenever it (or case sensitivity) changes.
  useEffect(() => {
    if (!open) return;
    editor.commands.setSearchTerm(term, caseSensitive);
  }, [editor, open, term, caseSensitive]);

  // Mirror the plugin's match count into local state on every transaction.
  useEffect(() => {
    if (!open) return;
    const sync = () => {
      const s = searchKey.getState(editor.state);
      setCount({ current: s?.current ?? -1, total: s?.matches.length ?? 0 });
    };
    sync();
    editor.on("transaction", sync);
    return () => {
      editor.off("transaction", sync);
    };
  }, [editor, open]);

  // Focus the input when opened; clear the highlight when closed.
  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
      inputRef.current?.select();
    } else {
      editor.commands.clearSearch();
    }
  }, [open, editor]);

  if (!open) return null;

  const label =
    count.total > 0
      ? `${count.current + 1}/${count.total}`
      : term
        ? t("find.none")
        : "";

  return (
    <div className="absolute right-2 top-2 z-20 flex flex-col gap-1.5 rounded-lg border bg-background/98 p-2 shadow-lg backdrop-blur">
      <div className="flex items-center gap-1.5">
        <input
          ref={inputRef}
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              editor
                .chain()
                .focus()
                [e.shiftKey ? "searchPrev" : "searchNext"]()
                .run();
              inputRef.current?.focus();
            } else if (e.key === "Escape") {
              e.preventDefault();
              close();
            }
          }}
          placeholder={t("find.searchPlaceholder")}
          className="h-8 w-44 rounded-md border bg-background px-2 text-sm outline-none"
        />
        <span className="w-12 shrink-0 text-center text-xs tabular-nums text-muted-foreground">
          {label}
        </span>
        <Button
          type="button"
          size="icon"
          variant={caseSensitive ? "secondary" : "ghost"}
          className="h-7 w-7"
          title={t("find.caseSensitive")}
          onClick={() => setCaseSensitive((v) => !v)}
        >
          <CaseSensitive className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          title={t("find.prev")}
          disabled={count.total === 0}
          onClick={() => editor.chain().focus().searchPrev().run()}
        >
          <ArrowUp className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          title={t("find.next")}
          disabled={count.total === 0}
          onClick={() => editor.chain().focus().searchNext().run()}
        >
          <ArrowDown className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          title={t("find.close")}
          onClick={() => close()}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="flex items-center gap-1.5">
        <input
          value={replacement}
          onChange={(e) => setReplacement(e.target.value)}
          placeholder={t("find.replacePlaceholder")}
          className="h-8 w-44 rounded-md border bg-background px-2 text-sm outline-none"
        />
        <span className="w-12 shrink-0" />
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 gap-1 px-2 text-xs"
          title={t("find.replace")}
          disabled={count.total === 0}
          onClick={() =>
            editor.chain().focus().replaceCurrent(replacement).run()
          }
        >
          <Replace className="h-3.5 w-3.5" />
          {t("find.replace")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 gap-1 px-2 text-xs"
          title={t("find.replaceAll")}
          disabled={count.total === 0}
          onClick={() => editor.chain().focus().replaceAll(replacement).run()}
        >
          <ReplaceAll className="h-3.5 w-3.5" />
          {t("find.replaceAll")}
        </Button>
      </div>
    </div>
  );
}
