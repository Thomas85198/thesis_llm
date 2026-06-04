// Editor-mode document state + debounced autosave (Zustand).
//
// The rest of the app uses React Context, but the writing editor has
// high-frequency state (every keystroke) that we don't want re-rendering the
// whole tree — a Zustand store keeps autosave bookkeeping out of React's render
// path. Content and title each have their own debounce so a content-only
// autosave never clobbers a title rename and vice versa (matches the backend's
// partial PUT).
import { create } from "zustand";

import { updateDocument, type ProseMirrorDoc } from "@/lib/api";

const AUTOSAVE_DELAY_MS = 1200;

export type SaveState = "idle" | "saving" | "saved" | "error";

type EditorStore = {
  docId: string | null;
  title: string;
  saveState: SaveState;
  /** Bind the store to a freshly-loaded document. */
  init: (docId: string, title: string) => void;
  /** Rename (debounced autosave of title only). */
  setTitle: (title: string) => void;
  /** Queue a content autosave (debounced; resets on each keystroke). */
  queueContentSave: (content: ProseMirrorDoc) => void;
  /** Clear timers + state on unmount. */
  reset: () => void;
};

let contentTimer: ReturnType<typeof setTimeout> | null = null;
let titleTimer: ReturnType<typeof setTimeout> | null = null;

export const useEditorStore = create<EditorStore>((set, get) => {
  async function persist(body: { title?: string; content_json?: ProseMirrorDoc }) {
    const docId = get().docId;
    if (!docId) return;
    set({ saveState: "saving" });
    try {
      await updateDocument(docId, body);
      set({ saveState: "saved" });
    } catch (e) {
      console.error("autosave failed", e);
      set({ saveState: "error" });
    }
  }

  return {
    docId: null,
    title: "",
    saveState: "idle",
    init: (docId, title) => {
      if (contentTimer) clearTimeout(contentTimer);
      if (titleTimer) clearTimeout(titleTimer);
      set({ docId, title, saveState: "idle" });
    },
    setTitle: (title) => {
      set({ title, saveState: "idle" });
      if (titleTimer) clearTimeout(titleTimer);
      titleTimer = setTimeout(() => void persist({ title }), AUTOSAVE_DELAY_MS);
    },
    queueContentSave: (content) => {
      set({ saveState: "idle" });
      if (contentTimer) clearTimeout(contentTimer);
      contentTimer = setTimeout(
        () => void persist({ content_json: content }),
        AUTOSAVE_DELAY_MS
      );
    },
    reset: () => {
      if (contentTimer) clearTimeout(contentTimer);
      if (titleTimer) clearTimeout(titleTimer);
      contentTimer = null;
      titleTimer = null;
      set({ docId: null, title: "", saveState: "idle" });
    },
  };
});
