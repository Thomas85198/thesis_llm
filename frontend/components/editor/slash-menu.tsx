"use client";
// The floating menu for the slash command. Reads its state from the editor
// store (driven by slash-command.tsx) and renders into a portal so it isn't
// clipped by the editor's overflow. Keyboard nav is handled upstream by the
// suggestion plugin's onKeyDown (which mutates slashIndex); this only renders.
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

import { useEditorStore } from "@/lib/editor-store";

const MENU_WIDTH = 288; // w-72
const EST_HEIGHT = 320; // for flip decision

export function SlashMenu() {
  const open = useEditorStore((s) => s.slashOpen);
  const items = useEditorStore((s) => s.slashItems);
  const index = useEditorStore((s) => s.slashIndex);
  const rect = useEditorStore((s) => s.slashRect);
  const pickSlash = useEditorStore((s) => s.pickSlash);
  const setSlashIndex = useEditorStore((s) => s.setSlashIndex);

  const activeRef = useRef<HTMLButtonElement | null>(null);

  // Keep the keyboard-selected item scrolled into view.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [index]);

  // The editor mounts client-only (ssr:false), but guard document for safety.
  if (typeof document === "undefined") return null;
  if (!open || !rect || items.length === 0) return null;

  // Below the caret by default; flip above when there isn't room.
  const flipUp = rect.bottom + EST_HEIGHT > window.innerHeight;
  const top = flipUp ? undefined : rect.bottom + 6;
  const bottom = flipUp ? window.innerHeight - rect.top + 6 : undefined;
  const left = Math.min(rect.left, window.innerWidth - MENU_WIDTH - 12);

  return createPortal(
    <div
      style={{ position: "fixed", top, bottom, left, width: MENU_WIDTH, zIndex: 50 }}
      className="max-h-80 overflow-y-auto rounded-lg border bg-popover p-1 shadow-md"
    >
      {items.map((item, i) => {
        const Icon = item.icon;
        const active = i === index;
        return (
          <button
            key={item.title}
            ref={active ? activeRef : null}
            type="button"
            // Don't blur the editor / move the cursor before the command runs.
            onMouseDown={(e) => {
              e.preventDefault();
              pickSlash(i);
            }}
            onMouseEnter={() => setSlashIndex(i)}
            className={`flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left text-sm ${
              active ? "bg-accent text-accent-foreground" : "text-foreground"
            }`}
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded border bg-background">
              <Icon className="h-4 w-4" />
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="truncate font-medium">{item.title}</span>
              {item.hint && (
                <span className="truncate text-xs text-muted-foreground">{item.hint}</span>
              )}
            </span>
          </button>
        );
      })}
    </div>,
    document.body
  );
}
