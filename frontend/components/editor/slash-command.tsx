"use client";
// Slash command: type "/" to summon a Notion/Heptabase-style block menu. Built
// on @tiptap/suggestion — the suggestion plugin handles the "/" trigger and
// query, and its render hooks drive a Zustand-backed menu (slash-menu.tsx) that
// lives inside the app's React/i18n tree (so it can't use ReactRenderer, which
// renders outside the provider). The "/query" text is deleted centrally below
// (in its own transaction) before each item's `command` applies the block
// change — so no command can ever leave the typed keyword behind.
import { Extension, type Editor } from "@tiptap/core";
import Suggestion from "@tiptap/suggestion";
import type { ComponentType } from "react";

import { useEditorStore } from "@/lib/editor-store";

export type SlashItem = {
  title: string;
  hint?: string;
  icon: ComponentType<{ className?: string }>;
  keywords?: string[];
  command: (args: { editor: Editor }) => void;
};

export const SlashCommand = Extension.create<{ items: SlashItem[] }>({
  name: "slashCommand",

  addOptions() {
    return { items: [] };
  },

  addProseMirrorPlugins() {
    const all = () => this.options.items;
    const editor = this.editor;
    // The suggestion's clientRect() can be null on the very first call (onStart),
    // which left the menu hidden until a caret move (arrow key) fired onUpdate
    // with a real rect. Fall back to deriving the caret rect from the editor so
    // the menu shows the instant "/" is typed.
    const rectFor = (
      clientRect?: (() => DOMRect | null) | null,
    ): DOMRect | null => {
      const r = clientRect?.();
      if (r) return r;
      try {
        const c = editor.view.coordsAtPos(editor.state.selection.from);
        return new DOMRect(c.left, c.top, 0, c.bottom - c.top);
      } catch {
        return null;
      }
    };
    return [
      Suggestion<SlashItem>({
        editor: this.editor,
        char: "/",
        allowSpaces: false,
        startOfLine: false,
        // Commit: delete the "/query" in its own transaction first (so the typed
        // keyword can never be left behind), then run the item's block change.
        command: ({ editor, range, props }) => {
          editor.chain().focus().deleteRange(range).run();
          props.command({ editor });
        },
        items: ({ query }) => {
          const q = query.toLowerCase();
          // Menu scrolls (max-h-80 overflow-y-auto), so show the full set rather
          // than capping — capping hid Math/Table below the fold on empty query.
          if (!q) return all();
          return all().filter(
            (it) =>
              it.title.toLowerCase().includes(q) ||
              (it.keywords ?? []).some((k) => k.includes(q)),
          );
        },
        render: () => {
          const store = useEditorStore.getState;
          return {
            onStart: (props) =>
              store().openSlash({
                items: props.items,
                command: props.command,
                rect: rectFor(props.clientRect),
              }),
            onUpdate: (props) =>
              store().updateSlash({
                items: props.items,
                // Must refresh: props.command closes over the current range,
                // which grows as the query is typed (see updateSlash).
                command: props.command,
                rect: rectFor(props.clientRect),
              }),
            onKeyDown: (props) => {
              const s = store();
              if (!s.slashOpen) return false;
              switch (props.event.key) {
                case "ArrowUp":
                  s.moveSlash(-1);
                  return true;
                case "ArrowDown":
                  s.moveSlash(1);
                  return true;
                case "Enter":
                  s.pickSlash();
                  return true;
                case "Escape":
                  s.closeSlash();
                  return true;
                default:
                  return false;
              }
            },
            onExit: () => store().closeSlash(),
          };
        },
      }),
    ];
  },
});
