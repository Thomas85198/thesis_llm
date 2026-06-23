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
  DocumentConflictError,
  snapshotDocument,
  updateDocument,
  type DraftDefect,
  type ProseMirrorDoc,
} from "@/lib/api";
import { type CitationStyle } from "@/lib/citation-format";
import { type SlashItem } from "@/components/editor/slash-command";

const AUTOSAVE_DELAY_MS = 1200;
// Auto-snapshot a version at most this often, so the 20-version autosave window
// covers a meaningful span (~40 min) instead of the last few keystrokes.
const SNAPSHOT_THROTTLE_MS = 120000;
// Autosave-failure backoff: a thesis draft is irreplaceable, so we retry
// indefinitely (capped at the last delay) until the save lands. The badge shows
// "retrying" the whole time and the beforeunload guard keeps the tab from closing.
const RETRY_DELAYS_MS = [2000, 5000, 15000, 30000];

export type SaveState = "idle" | "saving" | "saved" | "retrying" | "error";

type EditorStore = {
  docId: string | null;
  title: string;
  saveState: SaveState;
  /** True from the first edit until a save fully lands — drives the
   * beforeunload guard so an untouched doc never warns, but a pending /
   * retrying / failed save does. */
  dirty: boolean;
  /** The document was modified elsewhere (another tab/device); autosave is
   * paused until the user reloads-latest or force-overwrites. */
  conflict: boolean;
  /** Re-sync after the user resolves a conflict (server's fresh updated_at). */
  markSynced: (updatedAt: string) => void;
  /** Bind the store to a freshly-loaded document. */
  init: (docId: string, title: string, updatedAt?: string | null) => void;
  /** Rename (debounced autosave of title only). */
  setTitle: (title: string) => void;
  /** Queue a content autosave (debounced; resets on each keystroke). */
  queueContentSave: (content: ProseMirrorDoc) => void;
  /** Retry a failed autosave immediately (badge click). */
  retryNow: () => void;
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
  /** When set, the panel auto-runs this instruction on open (defect "AI fix"
   * path) instead of waiting for the author to pick a preset. */
  rewritePreset: string | null;
  openRewrite: (
    text: string,
    from: number,
    to: number,
    presetInstruction?: string,
  ) => void;
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

  // ----- Version history -----
  versionsOpen: boolean;
  openVersions: () => void;
  closeVersions: () => void;

  // ----- Keyboard shortcuts help -----
  shortcutsOpen: boolean;
  openShortcuts: () => void;
  closeShortcuts: () => void;

  // ----- Find & Replace -----
  findOpen: boolean;
  openFind: () => void;
  closeFind: () => void;

  // ----- Knowledge graph (deep check) -----
  kgOpen: boolean;
  openKG: () => void;
  closeKG: () => void;

  // ----- Writing lint (rule-based, no token) -----
  lintOpen: boolean;
  openLint: () => void;
  closeLint: () => void;

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
// Failed-save retry bookkeeping. `pendingRetry` merges the fields that haven't
// landed yet; a fresh debounced save for a field supersedes its stale retry.
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryAttempt = 0;
let pendingRetry: { title?: string; content_json?: ProseMirrorDoc } = {};
// Throttle gate for auto-snapshots (reset when a new document is opened).
let lastSnapshotAt = 0;
// Optimistic-concurrency token: the updated_at this tab last synced to. Sent on
// every save so a stale write (another tab moved the doc on) is rejected, not
// silently clobbered.
let lastKnownUpdatedAt: string | null = null;
// Serialize saves: the title and content debounces must never PUT concurrently,
// or one would carry a stale token and self-conflict. Chaining keeps them in
// order so each save sees the previous save's fresh updated_at.
let saveChain: Promise<void> = Promise.resolve();

export const useEditorStore = create<EditorStore>((set, get) => {
  function clearRetry() {
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
    retryAttempt = 0;
    pendingRetry = {};
  }

  function enqueue(body: { title?: string; content_json?: ProseMirrorDoc }) {
    saveChain = saveChain.then(() => persist(body));
    return saveChain;
  }

  function scheduleRetry() {
    if (retryTimer) return; // already queued
    const delay =
      RETRY_DELAYS_MS[Math.min(retryAttempt, RETRY_DELAYS_MS.length - 1)];
    retryTimer = setTimeout(() => {
      retryTimer = null;
      retryAttempt += 1;
      const body = { ...pendingRetry };
      if (Object.keys(body).length) void enqueue(body);
    }, delay);
  }

  async function persist(body: {
    title?: string;
    content_json?: ProseMirrorDoc;
  }) {
    const docId = get().docId;
    if (!docId) return;
    // While a conflict is unresolved, pause autosaves — saving again would just
    // 409 again (and risk clobbering). The conflict banner drives resolution.
    if (get().conflict) return;
    set({ saveState: "saving" });
    try {
      const res = await updateDocument(docId, {
        ...body,
        expected_updated_at: lastKnownUpdatedAt,
      });
      if (res.updated_at) lastKnownUpdatedAt = res.updated_at;
      // Drop the fields that just landed; anything still pending keeps retrying.
      for (const k of Object.keys(body))
        delete pendingRetry[k as keyof typeof pendingRetry];
      // Throttled version snapshot of the content that just saved. Fire-and-
      // forget: a failed snapshot must never block or fail an autosave.
      if (
        body.content_json &&
        Date.now() - lastSnapshotAt > SNAPSHOT_THROTTLE_MS
      ) {
        lastSnapshotAt = Date.now();
        void snapshotDocument(docId, body.content_json).catch(() => {});
      }
      if (Object.keys(pendingRetry).length === 0) {
        clearRetry();
        set({ saveState: "saved", dirty: false });
      } else {
        set({ saveState: "retrying" });
        scheduleRetry();
      }
    } catch (e) {
      if (e instanceof DocumentConflictError) {
        // Not transient — another writer moved the doc on. Stop retrying and
        // surface the conflict so the user can reload or overwrite.
        pendingRetry = { ...pendingRetry, ...body };
        if (retryTimer) clearTimeout(retryTimer);
        retryTimer = null;
        set({ saveState: "error", conflict: true, dirty: true });
        return;
      }
      console.error("autosave failed, will retry", e);
      pendingRetry = { ...pendingRetry, ...body };
      set({ saveState: "retrying", dirty: true });
      scheduleRetry();
    }
  }

  return {
    docId: null,
    title: "",
    saveState: "idle",
    dirty: false,
    conflict: false,
    init: (docId, title, updatedAt = null) => {
      if (contentTimer) clearTimeout(contentTimer);
      if (titleTimer) clearTimeout(titleTimer);
      clearRetry();
      lastSnapshotAt = 0; // fresh doc → allow an early baseline snapshot
      lastKnownUpdatedAt = updatedAt; // sync token for optimistic concurrency
      set({ docId, title, saveState: "idle", dirty: false, conflict: false });
    },
    setTitle: (title) => {
      set({ title, saveState: "idle", dirty: true });
      if (titleTimer) clearTimeout(titleTimer);
      titleTimer = setTimeout(() => void enqueue({ title }), AUTOSAVE_DELAY_MS);
    },
    queueContentSave: (content) => {
      set({ saveState: "idle", dirty: true });
      if (contentTimer) clearTimeout(contentTimer);
      contentTimer = setTimeout(
        () => void enqueue({ content_json: content }),
        AUTOSAVE_DELAY_MS,
      );
    },
    retryNow: () => {
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
      const body = { ...pendingRetry };
      if (Object.keys(body).length) void enqueue(body);
    },
    // Conflict resolution: after the user reloads-latest or force-overwrites,
    // the component calls this with the server's fresh updated_at to re-sync.
    markSynced: (ts) => {
      lastKnownUpdatedAt = ts;
      clearRetry();
      set({ conflict: false, saveState: "saved", dirty: false });
    },
    reset: () => {
      if (contentTimer) clearTimeout(contentTimer);
      if (titleTimer) clearTimeout(titleTimer);
      contentTimer = null;
      titleTimer = null;
      clearRetry();
      lastKnownUpdatedAt = null;
      // citationStyle is a global preference — keep it across documents; just
      // make sure the panel isn't left open when switching docs.
      set({
        docId: null,
        title: "",
        saveState: "idle",
        dirty: false,
        conflict: false,
        citePanelOpen: false,
        citeClaim: "",
        citeAnchor: null,
        citeReplaceKey: null,
        rewriteOpen: false,
        rewriteText: "",
        rewriteRange: null,
        rewritePreset: null,
        outlineOpen: false,
        exportOpen: false,
        versionsOpen: false,
        shortcutsOpen: false,
        findOpen: false,
        kgOpen: false,
        lintOpen: false,
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
    rewritePreset: null,
    openRewrite: (rewriteText, from, to, presetInstruction) =>
      set((s) => ({
        rewriteOpen: true,
        rewriteText,
        rewriteRange: { from, to },
        rewritePreset: presetInstruction ?? null,
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

    // ----- Version history -----
    versionsOpen: false,
    openVersions: () => set({ versionsOpen: true }),
    closeVersions: () => set({ versionsOpen: false }),

    // ----- Keyboard shortcuts help -----
    shortcutsOpen: false,
    openShortcuts: () => set({ shortcutsOpen: true }),
    closeShortcuts: () => set({ shortcutsOpen: false }),

    // ----- Find & Replace -----
    findOpen: false,
    openFind: () => set({ findOpen: true }),
    closeFind: () => set({ findOpen: false }),

    // ----- Knowledge graph -----
    kgOpen: false,
    openKG: () => set({ kgOpen: true }),
    closeKG: () => set({ kgOpen: false }),

    // ----- Writing lint -----
    lintOpen: false,
    openLint: () => set({ lintOpen: true }),
    closeLint: () => set({ lintOpen: false }),

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
