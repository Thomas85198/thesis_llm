"use client";
// Heptabase/Notion-style block handle. The official @tiptap DragHandle renders a
// portal that follows the hovered top-level block; we put a grip (⠿) inside it.
// Dragging reorders the block (handled by the extension); clicking the grip
// selects the block and opens a small menu (duplicate / delete) — which is also
// how the user removes atom blocks (math, table, figure) that the caret can't
// otherwise reach.
import { DragHandle } from "@tiptap/extension-drag-handle-react";
import type { Editor } from "@tiptap/react";
import { Copy, GripVertical, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { memo, useCallback, useRef, useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";

type MenuState = { x: number; y: number; pos: number };

function BlockHandleImpl({ editor }: { editor: Editor }) {
  const t = useTranslations("editor");
  // Latest hovered block position, reported by the DragHandle as the mouse moves.
  const posRef = useRef<number | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);

  // MUST be stable: DragHandle re-registers its ProseMirror plugin whenever this
  // identity changes, and that plugin churn was resetting the slash-command
  // suggestion's state mid-open, so the "/" menu never stayed up.
  const onNodeChange = useCallback(({ pos }: { pos: number }) => {
    posRef.current = pos;
  }, []);

  const openMenu = (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const pos = posRef.current;
    if (pos == null) return;
    const r = e.currentTarget.getBoundingClientRect();
    // Select the block so the user can see exactly what the menu acts on.
    editor.commands.setNodeSelection(pos);
    setMenu({ x: r.right + 4, y: r.top, pos });
  };

  const close = () => setMenu(null);

  const duplicate = () => {
    if (menu) {
      const node = editor.state.doc.nodeAt(menu.pos);
      if (node) {
        editor
          .chain()
          .focus()
          .insertContentAt(menu.pos + node.nodeSize, node.toJSON())
          .run();
      }
    }
    close();
  };

  const remove = () => {
    if (menu) {
      editor.chain().focus().setNodeSelection(menu.pos).deleteSelection().run();
    }
    close();
  };

  return (
    <>
      <DragHandle editor={editor} onNodeChange={onNodeChange}>
        <button
          type="button"
          aria-label={t("blockHandle.label")}
          title={t("blockHandle.label")}
          onClick={openMenu}
          className="flex h-6 w-5 cursor-grab items-center justify-center rounded text-muted-foreground/50 transition-colors hover:bg-accent hover:text-foreground active:cursor-grabbing"
        >
          <GripVertical className="h-4 w-4" />
        </button>
      </DragHandle>

      {menu &&
        typeof document !== "undefined" &&
        createPortal(
          <>
            {/* Catch outside clicks to dismiss. */}
            <div className="fixed inset-0 z-40" onMouseDown={close} />
            <div
              style={{
                position: "fixed",
                top: menu.y,
                left: menu.x,
                zIndex: 50,
              }}
              className="min-w-40 rounded-lg border bg-popover p-1 shadow-md"
            >
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  duplicate();
                }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-foreground hover:bg-accent"
              >
                <Copy className="h-4 w-4 shrink-0" />
                {t("blockHandle.duplicate")}
              </button>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  remove();
                }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="h-4 w-4 shrink-0" />
                {t("blockHandle.delete")}
              </button>
            </div>
          </>,
          document.body,
        )}
    </>
  );
}

// `editor` is stable, so memo keeps the handle (and its DragHandle plugin) from
// re-rendering on every editor transaction the parent re-renders on.
export const BlockHandle = memo(BlockHandleImpl);
