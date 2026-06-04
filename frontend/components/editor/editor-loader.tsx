"use client";

import nextDynamic from "next/dynamic";

import { Skeleton } from "@/components/ui/skeleton";
import type { EditorDoc } from "@/lib/api";

// TipTap/ProseMirror touches the DOM at construction, so it can't render on the
// server — load it client-only (same pattern as the KG flow graph).
const TiptapEditor = nextDynamic(
  () => import("@/components/editor/tiptap-editor").then((m) => m.TiptapEditor),
  {
    ssr: false,
    loading: () => (
      <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
        <Skeleton className="mb-4 h-9 w-72" />
        <Skeleton className="mb-3 h-10 w-full" />
        <Skeleton className="h-[60vh] w-full" />
      </div>
    ),
  }
);

export function EditorLoader({ doc }: { doc: EditorDoc }) {
  return <TiptapEditor doc={doc} />;
}
