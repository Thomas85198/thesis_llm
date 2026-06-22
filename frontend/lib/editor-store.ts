// Editor-mode document state + debounced autosave (Zustand).
//
// The rest of the app uses React Context, but the writing editor has
// high-frequency state (every keystroke) that we don't want re-rendering the
// whole tree — a Zustand store keeps autosave bookkeeping out of React's render
// path. Content and title each have their own debounce so a content-only
// autosave never clobbers a title rename and vice versa (matches the backend's
// partial PUT).
import { create } from "zustand";

import {
  updateDocument,
  type DraftDefect,
  type ProseMirrorDoc,
} from "@/lib/api";
import { type CitationStyle } from "@/lib/citation-format";
import { type SlashItem } from "@/components/editor/slash-command";

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

  // ----- Smart Citation -----
  /** Global in-text citation style; flipping it re-renders every chip. */
  citationStyle: CitationStyle;
  setCitationStyle: (style: CitationStyle) => void;
  /** Citation side panel: open state + the initial query + insert pos. The
   * nonce bumps on every open so the panel body remounts (resets its query
   * box and results) even when reopened with the same claim. */
  citePanelOpen: boolean;
  citeClaim: string;
  citeAnchor: number | null;
  /** When opened from an unlinked citation: its citeKey, so picking a source
   * relinks every matching unlinked chip in place instead of inserting anew. */
  citeReplaceKey: string | null;
  citeNonce: number;
  openCitePanel: (
    claim: string,
    anchor: number,
    replaceKey?: string | null,
  ) => void;
  /** Toggle resolve/edit mode while the panel stays open (no remount) — used by
   * "edit reference" to retarget the manual form at an existing citation. */
  setCiteReplaceKey: (key: string | null) => void;
  closeCitePanel: () => void;

  // ----- AI rewrite -----
  /** Rewrite panel: open state + the selected passage and its doc range, so
   * Accept can replace exactly what was highlighted. Nonce remounts the body. */
  rewriteOpen: boolean;
  rewriteText: string;
  rewriteRange: { from: number; to: number } | null;
  rewriteNonce: number;
  openRewrite: (text: string, from: number, to: number) => void;
  closeRewrite: () => void;

  // ----- Outline -----
  /** Outline generator panel. Nonce remounts the body on each open. */
  outlineOpen: boolean;
  outlineNonce: number;
  openOutline: () => void;
  closeOutline: () => void;

  // ----- Export -----
  exportOpen: boolean;
  openExport: () => void;
  closeExport: () => void;

  // ----- Defect check (Thesis Critic on the draft) -----
  defectOpen: boolean;
  defectLoading: boolean;
  defects: DraftDefect[];
  openDefects: () => void;
  closeDefects: () => void;
  setDefectLoading: (loading: boolean) => void;
  setDefects: (defects: DraftDefect[]) => void;

  // ----- Slash command menu -----
  /** Driven by the slash-command suggestion plugin; rendered by <SlashMenu>. */
  slashOpen: boolean;
  slashItems: SlashItem[];
  slashIndex: number;
  slashRect: DOMRect | null;
  /** Commit the chosen item (the suggestion plugin's `command`). */
  slashCommand: ((item: SlashItem) => void) | null;
  openSlash: (a: {
    items: SlashItem[];
    command: (item: SlashItem) => void;
    rect: DOMRect | null;
  }) => void;
  updateSlash: (a: {
    items: SlashItem[];
    command: (item: SlashItem) => void;
    rect: DOMRect | null;
  }) => void;
  moveSlash: (delta: number) => void;
  setSlashIndex: (i: number) => void;
  pickSlash: (i?: number) => void;
  closeSlash: () => void;
};

let contentTimer: ReturnType<typeof setTimeout> | null = null;
let titleTimer: ReturnType<typeof setTimeout> | null = null;

export const useEditorStore = create<EditorStore>((set, get) => {
  async function persist(body: {
    title?: string;
    content_json?: ProseMirrorDoc;
  }) {
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
        AUTOSAVE_DELAY_MS,
      );
    },
    reset: () => {
      if (contentTimer) clearTimeout(contentTimer);
      if (titleTimer) clearTimeout(titleTimer);
      contentTimer = null;
      titleTimer = null;
      // citationStyle is a global preference — keep it across documents; just
      // make sure the panel isn't left open when switching docs.
      set({
        docId: null,
        title: "",
        saveState: "idle",
        citePanelOpen: false,
        citeClaim: "",
        citeAnchor: null,
        citeReplaceKey: null,
        rewriteOpen: false,
        rewriteText: "",
        rewriteRange: null,
        outlineOpen: false,
        exportOpen: false,
        defectOpen: false,
        defects: [],
        defectLoading: false,
      });
    },

    // ----- Smart Citation -----
    citationStyle: "apa",
    setCitationStyle: (citationStyle) => set({ citationStyle }),
    citePanelOpen: false,
    citeClaim: "",
    citeAnchor: null,
    citeReplaceKey: null,
    citeNonce: 0,
    openCitePanel: (citeClaim, citeAnchor, citeReplaceKey = null) =>
      set((s) => ({
        citePanelOpen: true,
        citeClaim,
        citeAnchor,
        citeReplaceKey,
        citeNonce: s.citeNonce + 1,
      })),
    setCiteReplaceKey: (citeReplaceKey) => set({ citeReplaceKey }),
    closeCitePanel: () => set({ citePanelOpen: false }),

    // ----- AI rewrite -----
    rewriteOpen: false,
    rewriteText: "",
    rewriteRange: null,
    rewriteNonce: 0,
    openRewrite: (rewriteText, from, to) =>
      set((s) => ({
        rewriteOpen: true,
        rewriteText,
        rewriteRange: { from, to },
        rewriteNonce: s.rewriteNonce + 1,
      })),
    closeRewrite: () => set({ rewriteOpen: false }),

    // ----- Outline -----
    outlineOpen: false,
    outlineNonce: 0,
    openOutline: () =>
      set((s) => ({ outlineOpen: true, outlineNonce: s.outlineNonce + 1 })),
    closeOutline: () => set({ outlineOpen: false }),

    // ----- Export -----
    exportOpen: false,
    openExport: () => set({ exportOpen: true }),
    closeExport: () => set({ exportOpen: false }),

    // ----- Defect check -----
    defectOpen: false,
    defectLoading: false,
    defects: [],
    openDefects: () => set({ defectOpen: true }),
    closeDefects: () => set({ defectOpen: false }),
    setDefectLoading: (defectLoading) => set({ defectLoading }),
    setDefects: (defects) => set({ defects }),

    // ----- Slash command menu -----
    slashOpen: false,
    slashItems: [],
    slashIndex: 0,
    slashRect: null,
    slashCommand: null,
    openSlash: ({ items, command, rect }) =>
      set({
        slashOpen: true,
        slashItems: items,
        slashCommand: command,
        slashRect: rect,
        slashIndex: 0,
      }),
    updateSlash: ({ items, command, rect }) =>
      set((s) => ({
        slashItems: items,
        // Refresh the command each update: it closes over the suggestion's
        // current range, which grows as the user types "/query". Keeping the
        // onStart command meant deleteRange only removed "/", leaving the query.
        slashCommand: command,
        slashRect: rect,
        slashIndex: Math.min(s.slashIndex, Math.max(0, items.length - 1)),
      })),
    moveSlash: (delta) =>
      set((s) => {
        const n = s.slashItems.length;
        return n === 0 ? {} : { slashIndex: (s.slashIndex + delta + n) % n };
      }),
    setSlashIndex: (slashIndex) => set({ slashIndex }),
    pickSlash: (i) => {
      const s = get();
      const item = s.slashItems[i ?? s.slashIndex];
      if (item && s.slashCommand) s.slashCommand(item);
    },
    closeSlash: () =>
      set({
        slashOpen: false,
        slashItems: [],
        slashCommand: null,
        slashRect: null,
      }),
  };
});
