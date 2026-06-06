"use client";
// Floating toolbar shown when the cursor is inside a table. Wires up
// @tiptap/extension-table's built-in commands (add/remove rows & columns,
// toggle header, delete table) — the operations a thesis table actually needs.
import type { Editor } from "@tiptap/core";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Columns3,
  Heading,
  Rows3,
  Trash2,
} from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";

function TBtn({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="h-7 w-7"
      title={label}
      aria-label={label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

export function TableToolbar({ editor }: { editor: Editor }) {
  const t = useTranslations("editor");
  const run = (fn: (c: ReturnType<Editor["chain"]>) => ReturnType<Editor["chain"]>) =>
    fn(editor.chain().focus()).run();

  return (
    <div className="flex items-center gap-0.5 rounded-lg border bg-popover p-1 shadow-md">
      <Columns3 className="ml-1 mr-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <TBtn label={t("tableMenu.colBefore")} onClick={() => run((c) => c.addColumnBefore())}>
        <ArrowLeft className="h-4 w-4" />
      </TBtn>
      <TBtn label={t("tableMenu.colAfter")} onClick={() => run((c) => c.addColumnAfter())}>
        <ArrowRight className="h-4 w-4" />
      </TBtn>
      <TBtn label={t("tableMenu.colDelete")} onClick={() => run((c) => c.deleteColumn())}>
        <Trash2 className="h-4 w-4" />
      </TBtn>

      <div className="mx-1 h-5 w-px bg-border" />

      <Rows3 className="mr-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <TBtn label={t("tableMenu.rowBefore")} onClick={() => run((c) => c.addRowBefore())}>
        <ArrowUp className="h-4 w-4" />
      </TBtn>
      <TBtn label={t("tableMenu.rowAfter")} onClick={() => run((c) => c.addRowAfter())}>
        <ArrowDown className="h-4 w-4" />
      </TBtn>
      <TBtn label={t("tableMenu.rowDelete")} onClick={() => run((c) => c.deleteRow())}>
        <Trash2 className="h-4 w-4" />
      </TBtn>

      <div className="mx-1 h-5 w-px bg-border" />

      <TBtn label={t("tableMenu.toggleHeader")} onClick={() => run((c) => c.toggleHeaderRow())}>
        <Heading className="h-4 w-4" />
      </TBtn>
      <TBtn label={t("tableMenu.deleteTable")} onClick={() => run((c) => c.deleteTable())}>
        <Trash2 className="h-4 w-4 text-destructive" />
      </TBtn>
    </div>
  );
}
