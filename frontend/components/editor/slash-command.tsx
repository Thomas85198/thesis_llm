"use client";
// Slash command: type "/" to summon a Notion/Heptabase-style block menu. Built
// on @tiptap/suggestion — the suggestion plugin handles the "/" trigger and
// query, and its render hooks drive a Zustand-backed menu (slash-menu.tsx) that
// lives inside the app's React/i18n tree (so it can't use ReactRenderer, which
// renders outside the provider). Each item's `command` deletes the "/query" then
// applies the block change.
import { Extension, type Editor, type Range } from "@tiptap/core";
import Suggestion from "@tiptap/suggestion";
import type { ComponentType } from "react";

import { useEditorStore } from "@/lib/editor-store";

export type SlashItem = {
  title: string;
  hint?: string;
  icon: ComponentType<{ className?: string }>;
  keywords?: string[];
  command: (args: { editor: Editor; range: Range }) => void;
};

export const SlashCommand = Extension.create<{ items: SlashItem[] }>({
  name: "slashCommand",

  addOptions() {
    return { items: [] };
  },

  addProseMirrorPlugins() {
    const all = () => this.options.items;
    return [
      Suggestion<SlashItem>({
        editor: this.editor,
        char: "/",
        allowSpaces: false,
        startOfLine: false,
        // Commit: run the chosen item's editor command (props === the item).
        command: ({ editor, range, props }) => props.command({ editor, range }),
        items: ({ query }) => {
          const q = query.toLowerCase();
          if (!q) return all().slice(0, 10);
          return all()
            .filter(
              (it) =>
                it.title.toLowerCase().includes(q) ||
                (it.keywords ?? []).some((k) => k.includes(q))
            )
            .slice(0, 10);
        },
        render: () => {
          const store = useEditorStore.getState;
          return {
            onStart: (props) =>
              store().openSlash({
                items: props.items,
                command: props.command,
                rect: props.clientRect?.() ?? null,
              }),
            onUpdate: (props) =>
              store().updateSlash({
                items: props.items,
                rect: props.clientRect?.() ?? null,
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
