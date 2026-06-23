"use client";

import {
  EditorContent,
  useEditor,
  useEditorState,
  type Editor,
} from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { NodeSelection } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import {
  Table,
  TableCell,
  TableHeader,
  TableRow,
} from "@tiptap/extension-table";
import {
  BookText,
  Bold,
  Code,
  Download,
  Heading1,
  Heading2,
  Heading3,
  Image as ImageIcon,
  Images,
  BadgeCheck,
  History,
  Italic,
  Keyboard,
  Link2,
  List,
  ListOrdered,
  ListTree,
  Loader2,
  Minus,
  Pilcrow,
  Quote,
  Redo2,
  Replace,
  Search,
  ShieldAlert,
  Sigma,
  Sparkles,
  Strikethrough,
  Table as TableIcon,
  TableProperties,
  Undo2,
  Variable,
  Wand2,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Autocomplete } from "@/components/editor/autocomplete-extension";
import { BlockHandle } from "@/components/editor/block-handle";
import { CodeBlock } from "@/components/editor/code-block-extension";
import { Citation } from "@/components/editor/citation-extension";
import { CitationPanel } from "@/components/editor/citation-panel";
import { DefectHighlight } from "@/components/editor/defect-highlight";
import { DefectPanel } from "@/components/editor/defect-panel";
import { ExportPanel } from "@/components/editor/export-panel";
import { Figure, FigureList } from "@/components/editor/figure-extension";
import { ReferenceList } from "@/components/editor/reference-list-extension";
import { TableOfContents } from "@/components/editor/toc-extension";
import { MathBlock, MathInline } from "@/components/editor/math-extension";
import { ConflictBanner } from "@/components/editor/conflict-banner";
import { FindReplaceBar } from "@/components/editor/find-replace-bar";
import { OutlinePanel } from "@/components/editor/outline-panel";
import { SearchReplace } from "@/components/editor/search-replace-extension";
import { RewritePanel } from "@/components/editor/rewrite-panel";
import { ShortcutsHelp } from "@/components/editor/shortcuts-help";
import { VersionHistoryPanel } from "@/components/editor/version-history";
import { WordCount } from "@/components/editor/word-count";
import {
  TableBlock,
  TableCaption,
  TableList,
} from "@/components/editor/table-extension";
import {
  SlashCommand,
  type SlashItem,
} from "@/components/editor/slash-command";
import { TableToolbar } from "@/components/editor/table-toolbar";
import { SlashMenu } from "@/components/editor/slash-menu";
import { Button } from "@/components/ui/button";
import {
  ChatRateLimitError,
  checkDraft,
  relinkCitations,
  streamAutocomplete,
  uploadImage,
  verifyCitation,
  type EditorDoc,
  type ProseMirrorDoc,
} from "@/lib/api";
import {
  CITATION_STYLES,
  CITATION_STYLE_LABEL,
  type CitationStyle,
} from "@/lib/citation-format";
import { useEditorStore, type SaveState } from "@/lib/editor-store";
import { cn } from "@/lib/utils";

// Auto ghost text: wait ~1s after typing stops, only fire at a word/sentence
// boundary, and require a little context first — keeps it from popping up on
// every mid-word pause. Manual trigger (⌘/Ctrl+J) bypasses all of this.
const AUTOCOMPLETE_DEBOUNCE_MS = 1000;
const AUTOCOMPLETE_MIN_CHARS = 6;
const AUTOCOMPLETE_BOUNDARY = /[\s。．！？!?,，、；;：:）)】」』.]/;

/** AI ghost-text mode: smart auto + hotkey / hotkey-only / off. */
type AiMode = "auto" | "manual" | "off";

type OutlineItem = { level: number; text: string; pos: number };

/** Toolbar button derived state — recomputed on every editor transaction. */
type ToolbarState = {
  bold: boolean;
  italic: boolean;
  strike: boolean;
  code: boolean;
  h1: boolean;
  h2: boolean;
  h3: boolean;
  bullet: boolean;
  ordered: boolean;
  quote: boolean;
  canUndo: boolean;
  canRedo: boolean;
  outline: OutlineItem[];
};

function readToolbarState(editor: Editor): ToolbarState {
  const outline: OutlineItem[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "heading") {
      outline.push({
        level: node.attrs.level as number,
        text: node.textContent || "—",
        pos,
      });
    }
    return true;
  });
  return {
    bold: editor.isActive("bold"),
    italic: editor.isActive("italic"),
    strike: editor.isActive("strike"),
    code: editor.isActive("code"),
    h1: editor.isActive("heading", { level: 1 }),
    h2: editor.isActive("heading", { level: 2 }),
    h3: editor.isActive("heading", { level: 3 }),
    bullet: editor.isActive("bulletList"),
    ordered: editor.isActive("orderedList"),
    quote: editor.isActive("blockquote"),
    canUndo: editor.can().undo(),
    canRedo: editor.can().redo(),
    outline,
  };
}

function SaveBadge({ state }: { state: SaveState }) {
  const t = useTranslations("editor");
  const retryNow = useEditorStore((s) => s.retryNow);
  const label: Record<SaveState, string> = {
    idle: t("save.idle"),
    saving: t("save.saving"),
    saved: t("save.saved"),
    retrying: t("save.retrying"),
    error: t("save.error"),
  };
  const color: Record<SaveState, string> = {
    idle: "text-muted-foreground",
    saving: "text-muted-foreground",
    saved: "text-emerald-600 dark:text-emerald-400",
    retrying: "text-amber-600 dark:text-amber-400",
    error: "text-destructive",
  };
  // While retrying/failed, the badge is a button: click to retry immediately.
  if (state === "retrying" || state === "error") {
    return (
      <button
        type="button"
        onClick={retryNow}
        title={t("save.retryNow")}
        className={cn(
          "text-xs tabular-nums underline-offset-2 hover:underline",
          color[state],
        )}
      >
        {label[state]}
      </button>
    );
  }
  return (
    <span className={cn("text-xs tabular-nums", color[state])}>
      {label[state]}
    </span>
  );
}

function ToolbarButton({
  active,
  disabled,
  onClick,
  label,
  children,
}: {
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant={active ? "secondary" : "ghost"}
      size="icon"
      className="h-8 w-8"
      aria-label={label}
      aria-pressed={active}
      title={label}
      disabled={disabled}
      // Keep focus in the editor so the command applies to the current selection.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

// The sentence a citation at `pos` supports: the text of its paragraph up to the
// chip, trimmed to the last sentence. Used as the claim for verification.
function claimAtPos(editor: Editor, pos: number): string {
  const $pos = editor.state.doc.resolve(pos);
  const paraStart = pos - $pos.parentOffset;
  const before = editor.state.doc.textBetween(paraStart, pos, " ", " ");
  const parts = before.split(/(?<=[。！？!?.])\s*/).filter(Boolean);
  return (
    (parts[parts.length - 1] || before).trim() || $pos.parent.textContent.trim()
  );
}

// Split the doc into section text blocks at each top-level heading (level ≤ 2),
// each block = its heading line + the content up to the next heading. Used for
// per-section incremental defect checking (only changed sections re-run). Text
// before the first heading is its own section; a heading-less doc → one block.
function splitIntoSections(editor: Editor, maxChars: number): string[] {
  const out: string[] = [];
  let cur: string[] = [];
  const flush = () => {
    const text = cur.join("\n").trim();
    if (text) out.push(text.slice(0, maxChars));
    cur = [];
  };
  editor.state.doc.forEach((node) => {
    const isBreak =
      node.type.name === "heading" && (node.attrs.level ?? 1) <= 2;
    if (isBreak) flush();
    const t = node.textContent;
    if (t) cur.push(t);
  });
  flush();
  return out;
}

export function TiptapEditor({ doc }: { doc: EditorDoc }) {
  const t = useTranslations("editor");
  const locale = useLocale();
  const init = useEditorStore((s) => s.init);
  const reset = useEditorStore((s) => s.reset);
  const setTitle = useEditorStore((s) => s.setTitle);
  const queueContentSave = useEditorStore((s) => s.queueContentSave);
  const title = useEditorStore((s) => s.title);
  const saveState = useEditorStore((s) => s.saveState);
  const openCitePanel = useEditorStore((s) => s.openCitePanel);
  const openRewrite = useEditorStore((s) => s.openRewrite);
  const openOutline = useEditorStore((s) => s.openOutline);
  const openExport = useEditorStore((s) => s.openExport);
  const openVersions = useEditorStore((s) => s.openVersions);
  const openShortcuts = useEditorStore((s) => s.openShortcuts);
  const openFind = useEditorStore((s) => s.openFind);
  const openDefects = useEditorStore((s) => s.openDefects);
  const setDefects = useEditorStore((s) => s.setDefects);
  const setDefectLoading = useEditorStore((s) => s.setDefectLoading);
  const citationStyle = useEditorStore((s) => s.citationStyle);
  const setCitationStyle = useEditorStore((s) => s.setCitationStyle);

  const [aiMode, setAiMode] = useState<AiMode>("auto");

  // Autocomplete plumbing lives in refs so the editor's onUpdate (a stable
  // closure created once) always reads the latest values without having to
  // re-create the editor instance.
  const aiModeRef = useRef(aiMode);
  const editorRef = useRef<Editor | null>(null);
  // True while a block is being dragged (via the ⠿ handle), plus a short tail
  // after drop — used to keep the selection bubble menu from flashing on the
  // transient selection a drag produces.
  const draggingRef = useRef(false);
  const dragResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const acTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const acAbort = useRef<AbortController | null>(null);
  useEffect(() => {
    aiModeRef.current = aiMode;
  }, [aiMode]);

  const cancelAutocomplete = useCallback(() => {
    if (acTimer.current) {
      clearTimeout(acTimer.current);
      acTimer.current = null;
    }
    if (acAbort.current) {
      acAbort.current.abort();
      acAbort.current = null;
    }
  }, []);

  // Fire one suggestion request now. Shared by the debounced auto path and the
  // manual hotkey; streams ghost text into the editor.
  const requestSuggestion = useCallback(
    (ed: Editor) => {
      if (!ed.state.selection.empty) return; // only at a collapsed cursor
      const head = ed.state.selection.head;
      const textBefore = ed.state.doc.textBetween(0, head, "\n", " ");
      if (!textBefore.trim()) return;
      const headings: string[] = [];
      ed.state.doc.descendants((node) => {
        if (node.type.name === "heading") headings.push(node.textContent);
        return true;
      });
      const controller = new AbortController();
      acAbort.current = controller;
      let acc = "";
      void streamAutocomplete(
        {
          doc_id: doc.doc_id,
          text_before: textBefore,
          title: useEditorStore.getState().title,
          outline: headings.join(" / ").slice(0, 2000),
          locale,
        },
        (delta) => {
          // A keystroke during streaming aborts the controller — ignore late
          // deltas so we never re-show a stale suggestion.
          if (controller.signal.aborted) return;
          acc += delta;
          ed.commands.setSuggestion(acc);
        },
        controller.signal,
      ).catch(() => {
        /* network/abort — best-effort, just no suggestion */
      });
    },
    [doc.doc_id, locale],
  );

  // Auto path: debounced and gated on a word/sentence boundary (whitespace or
  // punctuation before the cursor) so suggestions stop popping up mid-word on
  // every pause. Manual mode skips this entirely (hotkey only).
  const triggerAutocomplete = useCallback(
    (ed: Editor) => {
      cancelAutocomplete(); // each keystroke cancels the pending request + timer
      if (aiModeRef.current !== "auto") return;
      if (!ed.state.selection.empty) return;
      const before = ed.state.doc.textBetween(
        0,
        ed.state.selection.head,
        "\n",
        " ",
      );
      if (before.trim().length < AUTOCOMPLETE_MIN_CHARS) return;
      if (!AUTOCOMPLETE_BOUNDARY.test(before.slice(-1))) return;
      acTimer.current = setTimeout(
        () => requestSuggestion(ed),
        AUTOCOMPLETE_DEBOUNCE_MS,
      );
    },
    [cancelAutocomplete, requestSuggestion],
  );

  // Manual trigger (⌘/Ctrl+J): suggest right now, regardless of boundary.
  const manualTrigger = useCallback(() => {
    if (aiModeRef.current === "off") return;
    const ed = editorRef.current;
    if (ed) {
      cancelAutocomplete();
      requestSuggestion(ed);
    }
  }, [cancelAutocomplete, requestSuggestion]);
  const manualTriggerRef = useRef(manualTrigger);
  useEffect(() => {
    manualTriggerRef.current = manualTrigger;
  }, [manualTrigger]);

  // onUpdate captures this once; route through a ref so callback identity
  // changes don't force the editor to rebuild.
  const triggerRef = useRef(triggerAutocomplete);
  useEffect(() => {
    triggerRef.current = triggerAutocomplete;
  }, [triggerAutocomplete]);

  // Guard against losing unsaved work: if an autosave is still pending /
  // retrying / failed when the tab closes or navigates away, fire the browser's
  // native "leave site?" confirmation. Reads `dirty` live so an untouched doc
  // never warns. Registered once; no re-binding on every keystroke.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (useEditorStore.getState().dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  // Image upload: the slash item opens a hidden file picker; on pick we upload
  // and insert a figure node at the cursor.
  const fileInputRef = useRef<HTMLInputElement>(null);
  const openImagePicker = useCallback(() => fileInputRef.current?.click(), []);
  const handleImageSelected = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = ""; // allow re-picking the same file
      if (!file) return;
      try {
        const src = await uploadImage(file);
        editorRef.current?.chain().focus().insertFigure({ src }).run();
      } catch (err) {
        toast.error(String(err));
      }
    },
    [],
  );

  // Relink: rebuild an imported paper's plain-text references into live citations
  // (high-confidence OpenAlex matches), so they show up in the citation panel.
  const [relinking, setRelinking] = useState(false);
  const handleRelinkCitations = useCallback(async () => {
    const ed = editorRef.current;
    if (!ed) return;
    setRelinking(true);
    const tid = toast.loading(t("citation.relinking"));
    try {
      const { content_json, stats } = await relinkCitations(
        doc.doc_id,
        ed.getJSON(),
      );
      ed.commands.setContent(content_json);
      toast.success(
        t("citation.relinkDone", {
          linked: stats.intext_linked,
          matched: stats.matched,
        }),
        { id: tid },
      );
    } catch (e) {
      toast.error(String(e), { id: tid });
    } finally {
      setRelinking(false);
    }
  }, [doc.doc_id, t]);

  // Defect check: run the Thesis Critic on the whole draft (heavy, on demand) →
  // list defects in the panel + underline the cited sentences inline.
  // A monotonic token guards against a slow earlier check (e.g. a selection)
  // landing *after* a newer one and clobbering its results; an AbortController
  // actively cancels the previous in-flight check when a new one starts.
  const checkTokenRef = useRef(0);
  const checkAbortRef = useRef<AbortController | null>(null);
  const cancelCheck = useCallback(() => {
    checkTokenRef.current += 1; // invalidate the in-flight result
    checkAbortRef.current?.abort();
    setDefectLoading(false);
  }, [setDefectLoading]);
  const handleCheckDefects = useCallback(async () => {
    const ed = editorRef.current;
    if (!ed) return;
    const MAX_CHECK_CHARS = 20000;
    const sel = ed.state.selection;
    const selected = sel.empty
      ? ""
      : ed.state.doc.textBetween(sel.from, sel.to, "\n", " ").trim();
    // A selection checks just that passage. Otherwise split the whole doc by its
    // top-level headings into sections, so re-checking only re-runs (and re-pays
    // for) the sections whose text changed — the backend caches per section.
    let payload: { text: string } | { sections: string[] };
    if (selected) {
      payload = { text: selected.slice(0, MAX_CHECK_CHARS) };
      if (selected.length > MAX_CHECK_CHARS)
        toast.warning(t("defect.selectionTrimmed"));
    } else {
      const sections = splitIntoSections(ed, MAX_CHECK_CHARS);
      if (!sections.length) {
        toast.error(t("defect.needsText"));
        return;
      }
      payload = { sections };
    }
    const token = ++checkTokenRef.current;
    checkAbortRef.current?.abort(); // cancel any check still running
    const ac = new AbortController();
    checkAbortRef.current = ac;
    openDefects();
    setDefectLoading(true);
    // Keep the previous results visible while the new check runs — don't blank
    // the panel — so cancelling (or a slow check) leaves the old defects in place.
    try {
      const defects = await checkDraft(doc.doc_id, payload, locale, ac.signal);
      if (checkTokenRef.current !== token) return; // superseded by a newer check
      setDefects(defects);
      ed.commands.setDefectHighlights(
        defects.flatMap((d) =>
          d.evidence.map((e) => ({ text: e, severity: d.severity })),
        ),
      );
    } catch (e) {
      if ((e as Error)?.name === "AbortError") return; // superseded / cancelled
      if (checkTokenRef.current !== token) return;
      if (e instanceof ChatRateLimitError)
        toast.error(t("defect.rateLimited", { seconds: e.retryAfter }));
      else toast.error(String(e));
    } finally {
      if (checkTokenRef.current === token) setDefectLoading(false);
    }
  }, [doc.doc_id, locale, t, openDefects, setDefects, setDefectLoading]);

  // Verify every linked citation's claim support (the "traffic light"): for each
  // chip, take the sentence it supports + the source abstract and ask the model
  // whether it actually backs the claim, then color the chip 🟢/🟡/🔴. On-demand
  // (LLM cost), bounded concurrency, and bails out cleanly on a rate limit.
  const [verifyingCites, setVerifyingCites] = useState(false);
  const handleVerifyCitations = useCallback(async () => {
    const ed = editorRef.current;
    if (!ed || verifyingCites) return;
    const targets: {
      pos: number;
      openalexId: string;
      title: string;
      abstract: string;
    }[] = [];
    ed.state.doc.descendants((node, pos) => {
      if (
        node.type.name === "citation" &&
        node.attrs.openalexId &&
        !node.attrs.unlinked
      ) {
        targets.push({
          pos,
          openalexId: node.attrs.openalexId,
          title: node.attrs.title || "",
          abstract: node.attrs.abstract || "",
        });
      }
    });
    if (!targets.length) {
      toast.info(t("verify.none"));
      return;
    }
    setVerifyingCites(true);
    let done = 0;
    let problems = 0;
    let stopped = false;
    let idx = 0;
    const worker = async () => {
      while (idx < targets.length && !stopped) {
        const tg = targets[idx++];
        try {
          const v = await verifyCitation(
            doc.doc_id,
            claimAtPos(ed, tg.pos),
            tg.title,
            tg.abstract, // stored on the chip → no OpenAlex round-trip
            locale,
            tg.openalexId, // fallback re-fetch if the chip predates abstract storage
          );
          ed.commands.setCitationVerdict(tg.pos, v.verdict);
          if (v.verdict === "unsupported" || v.verdict === "partial")
            problems++;
        } catch (e) {
          if (e instanceof ChatRateLimitError) stopped = true;
        }
        done++;
      }
    };
    try {
      await Promise.all(
        Array.from({ length: Math.min(4, targets.length) }, worker),
      );
      if (stopped) toast.error(t("verify.rateLimited"));
      else toast.success(t("verify.done", { count: done, problems }));
    } finally {
      setVerifyingCites(false);
    }
  }, [doc.doc_id, locale, t, verifyingCites]);

  // Slash menu items. `command` deletes the "/query" range, then applies the
  // block change. Memoized per locale (useEditor captures it on mount).
  const slashItems = useMemo<SlashItem[]>(
    () => [
      // NOTE: the "/query" text is already removed centrally (slash-command.tsx)
      // before these run, so each command only applies its block change.
      {
        title: t("slash.text"),
        hint: t("slash.textHint"),
        icon: Pilcrow,
        keywords: ["text", "paragraph", "p", "文字", "段落", "內文"],
        command: ({ editor }) => editor.chain().focus().setParagraph().run(),
      },
      {
        title: t("slash.h1"),
        icon: Heading1,
        keywords: ["h1", "heading", "title", "標題"],
        command: ({ editor }) =>
          editor.chain().focus().setNode("heading", { level: 1 }).run(),
      },
      {
        title: t("slash.h2"),
        icon: Heading2,
        keywords: ["h2", "heading", "標題"],
        command: ({ editor }) =>
          editor.chain().focus().setNode("heading", { level: 2 }).run(),
      },
      {
        title: t("slash.h3"),
        icon: Heading3,
        keywords: ["h3", "heading", "標題"],
        command: ({ editor }) =>
          editor.chain().focus().setNode("heading", { level: 3 }).run(),
      },
      {
        title: t("slash.bullet"),
        icon: List,
        keywords: ["bullet", "list", "ul", "項目", "清單"],
        command: ({ editor }) =>
          editor.chain().focus().toggleBulletList().run(),
      },
      {
        title: t("slash.ordered"),
        icon: ListOrdered,
        keywords: ["number", "ordered", "ol", "編號", "清單"],
        command: ({ editor }) =>
          editor.chain().focus().toggleOrderedList().run(),
      },
      {
        title: t("slash.quote"),
        icon: Quote,
        keywords: ["quote", "blockquote", "引言", "引用"],
        command: ({ editor }) =>
          editor.chain().focus().toggleBlockquote().run(),
      },
      {
        title: t("slash.code"),
        icon: Code,
        keywords: ["code", "程式", "程式碼"],
        command: ({ editor }) => editor.chain().focus().toggleCodeBlock().run(),
      },
      {
        title: t("slash.divider"),
        icon: Minus,
        keywords: ["divider", "hr", "rule", "分隔線", "分隔"],
        command: ({ editor }) =>
          editor.chain().focus().setHorizontalRule().run(),
      },
      {
        title: t("slash.image"),
        hint: t("slash.imageHint"),
        icon: ImageIcon,
        keywords: ["image", "img", "picture", "photo", "圖", "圖片", "照片"],
        command: () => openImagePicker(),
      },
      {
        title: t("slash.toc"),
        icon: ListTree,
        keywords: ["toc", "contents", "outline", "目錄", "大綱"],
        command: ({ editor }) =>
          editor.chain().focus().insertTableOfContents().run(),
      },
      {
        title: t("slash.figureList"),
        icon: Images,
        keywords: ["figures", "list", "圖目錄", "目錄"],
        command: ({ editor }) =>
          editor.chain().focus().insertFigureList().run(),
      },
      {
        title: t("slash.referenceList"),
        icon: BookText,
        keywords: [
          "references",
          "bibliography",
          "參考文獻",
          "書目",
          "引用清單",
        ],
        command: ({ editor }) =>
          editor.chain().focus().insertReferenceList().run(),
      },
      {
        title: t("slash.mathInline"),
        icon: Variable,
        keywords: [
          "math",
          "inline",
          "equation",
          "latex",
          "數學",
          "行內",
          "公式",
        ],
        command: ({ editor }) =>
          editor.chain().focus().insertMathInline().run(),
      },
      {
        title: t("slash.mathBlock"),
        icon: Sigma,
        keywords: [
          "math",
          "block",
          "equation",
          "latex",
          "數學",
          "區塊",
          "公式",
        ],
        command: ({ editor }) => editor.chain().focus().insertMathBlock().run(),
      },
      {
        title: t("slash.table"),
        icon: TableIcon,
        keywords: ["table", "grid", "表格", "表"],
        command: ({ editor }) =>
          editor.chain().focus().insertTableBlock().run(),
      },
      {
        title: t("slash.tableList"),
        icon: TableProperties,
        keywords: ["tables", "list", "表目錄", "目錄"],
        command: ({ editor }) => editor.chain().focus().insertTableList().run(),
      },
    ],
    [t, openImagePicker],
  );

  const editor = useEditor({
    extensions: [
      // Disable StarterKit's plain codeBlock in favour of our Notion-style
      // CodeBlock (syntax highlighting + language picker + copy).
      StarterKit.configure({ codeBlock: false }),
      CodeBlock.configure({
        labels: {
          searchPlaceholder: t("code.searchPlaceholder"),
          copy: t("code.copy"),
          copied: t("code.copied"),
        },
      }),
      // (StarterKit already provides TrailingNode, which keeps a paragraph after
      // the last block so trailing atom blocks stay escapable/deletable.)
      Autocomplete,
      Citation.configure({
        verdictLabels: {
          supports: t("verify.supports"),
          partial: t("verify.partial"),
          unsupported: t("verify.unsupported"),
        },
      }),
      Figure.configure({
        labels: {
          figureWord: t("figure.word"),
          captionPlaceholder: t("figure.captionPlaceholder"),
        },
      }),
      FigureList.configure({
        labels: {
          figureWord: t("figure.word"),
          title: t("figureList.title"),
          empty: t("figureList.empty"),
          untitled: t("figure.untitled"),
        },
      }),
      ReferenceList.configure({
        labels: {
          title: t("refList.title"),
          empty: t("refList.empty"),
          toText: t("refList.toText"),
        },
      }),
      TableOfContents.configure({
        labels: {
          title: t("toc.title"),
          empty: t("toc.empty"),
          untitled: t("figure.untitled"),
        },
      }),
      MathInline.configure({
        labels: {
          placeholder: t("math.inlinePlaceholder"),
          done: t("math.done"),
        },
      }),
      MathBlock.configure({
        labels: {
          placeholder: t("math.blockPlaceholder"),
          done: t("math.done"),
        },
      }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      TableBlock,
      DefectHighlight,
      TableCaption.configure({ labels: { tableWord: t("table.word") } }),
      TableList.configure({
        labels: {
          tableWord: t("table.word"),
          title: t("tableList.title"),
          empty: t("tableList.empty"),
          untitled: t("figure.untitled"),
        },
      }),
      // items are only invoked when the user types "/", never during render —
      // the ref-access heuristic misfires on the image item's file picker.
      // eslint-disable-next-line react-hooks/refs
      SlashCommand.configure({ items: slashItems }),
      SearchReplace,
    ],
    content: doc.content_json,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: "tiptap-content focus:outline-none",
        "aria-label": t("editorAria"),
      },
      // ⌘/Ctrl+J manually requests a ghost-text suggestion (Jenni-style).
      // ⌘/Ctrl+F opens the in-editor Find & Replace bar (not the browser's).
      handleKeyDown: (_view, event) => {
        const mod = event.metaKey || event.ctrlKey;
        if (event.key.toLowerCase() === "j" && mod) {
          event.preventDefault();
          manualTriggerRef.current();
          return true;
        }
        if (event.key.toLowerCase() === "f" && mod && !event.shiftKey) {
          event.preventDefault();
          useEditorStore.getState().openFind();
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor }) => {
      queueContentSave(editor.getJSON() as ProseMirrorDoc);
      triggerRef.current(editor);
    },
  });

  // Keep a ref to the editor for callbacks created before useEditor returns.
  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  // Block-drag plumbing. The ⠿ grip is portaled outside the editor DOM, so the
  // native dragend never reaches prosemirror-dropcursor (its listeners live on
  // editor.dom) — the drop line then lingers on the plugin's 5s fallback timer.
  // Forward a synthetic dragend so it clears in ~20ms. Also suppress the bubble
  // menu during the drag and for a brief tail afterwards.
  useEffect(() => {
    if (!editor) return;
    const onDragStart = () => {
      draggingRef.current = true;
      document.body.classList.remove("is-drag-ended");
      if (dragResetTimer.current) clearTimeout(dragResetTimer.current);
    };
    const onDragEnd = () => {
      // Hide the drop line now (CSS), and also nudge the plugin to remove the
      // node — its own fast-removal events never reach the portaled handle.
      document.body.classList.add("is-drag-ended");
      editor.view.dom.dispatchEvent(new Event("dragend"));
      if (dragResetTimer.current) clearTimeout(dragResetTimer.current);
      dragResetTimer.current = setTimeout(() => {
        draggingRef.current = false;
      }, 200);
    };
    document.addEventListener("dragstart", onDragStart, true);
    document.addEventListener("dragend", onDragEnd, true);
    return () => {
      document.removeEventListener("dragstart", onDragStart, true);
      document.removeEventListener("dragend", onDragEnd, true);
      document.body.classList.remove("is-drag-ended");
      if (dragResetTimer.current) clearTimeout(dragResetTimer.current);
    };
  }, [editor]);

  // Bind store to this document on mount; clear timers on unmount.
  useEffect(() => {
    init(doc.doc_id, doc.title, doc.updated_at);
    return () => {
      reset();
      cancelAutocomplete();
    };
  }, [doc.doc_id, doc.title, init, reset, cancelAutocomplete]);

  // Turning AI off kills any in-flight suggestion immediately.
  useEffect(() => {
    if (aiMode === "off" && editor) {
      cancelAutocomplete();
      editor.commands.clearSuggestion();
    }
  }, [aiMode, editor, cancelAutocomplete]);

  const tb = useEditorState({
    editor,
    selector: ({ editor }) => (editor ? readToolbarState(editor) : null),
    // Avoid re-rendering the toolbar + left outline on every transaction when
    // the derived state is unchanged (readToolbarState builds a fresh object).
    equalityFn: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  });

  if (!editor) return null;

  const goToHeading = (pos: number) => {
    editor
      .chain()
      .focus()
      .setTextSelection(pos + 1)
      .scrollIntoView()
      .run();
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 gap-6 px-4 py-6 sm:px-6">
      {/* Outline */}
      <aside className="hidden w-56 shrink-0 lg:block">
        <div className="sticky top-20">
          <h2 className="mb-2 px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("outline.find")}
          </h2>
          {tb && tb.outline.length > 0 ? (
            <nav className="flex flex-col gap-0.5">
              {tb.outline.map((h, i) => (
                <button
                  key={`${h.pos}-${i}`}
                  onClick={() => goToHeading(h.pos)}
                  className="truncate rounded px-2 py-1 text-left text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  style={{ paddingLeft: `${0.5 + (h.level - 1) * 0.75}rem` }}
                >
                  {h.text}
                </button>
              ))}
            </nav>
          ) : (
            <p className="px-2 text-sm text-muted-foreground/60">
              {t("outlineEmpty")}
            </p>
          )}
        </div>
      </aside>

      {/* Editor column */}
      <div className="relative flex min-w-0 flex-1 flex-col">
        <FindReplaceBar editor={editor} />
        <ConflictBanner editor={editor} docId={doc.doc_id} />
        {/* Title + save status */}
        <div className="mb-4 flex items-center gap-3">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("titlePlaceholder")}
            className="min-w-0 flex-1 bg-transparent text-2xl font-semibold outline-none placeholder:text-muted-foreground/50"
            aria-label={t("titleAria")}
          />
          <WordCount editor={editor} />
          <SaveBadge state={saveState} />
        </div>

        {/* Toolbar */}
        <div className="sticky top-14 z-10 mb-3 flex flex-wrap items-center gap-0.5 rounded-lg border bg-background/95 p-1 backdrop-blur">
          <ToolbarButton
            active={tb?.h1}
            label={t("tools.h1")}
            onClick={() =>
              editor.chain().focus().toggleHeading({ level: 1 }).run()
            }
          >
            <Heading1 className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            active={tb?.h2}
            label={t("tools.h2")}
            onClick={() =>
              editor.chain().focus().toggleHeading({ level: 2 }).run()
            }
          >
            <Heading2 className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            active={tb?.h3}
            label={t("tools.h3")}
            onClick={() =>
              editor.chain().focus().toggleHeading({ level: 3 }).run()
            }
          >
            <Heading3 className="h-4 w-4" />
          </ToolbarButton>
          <div className="mx-1 h-5 w-px bg-border" />
          <ToolbarButton
            active={tb?.bold}
            label={t("tools.bold")}
            onClick={() => editor.chain().focus().toggleBold().run()}
          >
            <Bold className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            active={tb?.italic}
            label={t("tools.italic")}
            onClick={() => editor.chain().focus().toggleItalic().run()}
          >
            <Italic className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            active={tb?.strike}
            label={t("tools.strike")}
            onClick={() => editor.chain().focus().toggleStrike().run()}
          >
            <Strikethrough className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            active={tb?.code}
            label={t("tools.code")}
            onClick={() => editor.chain().focus().toggleCode().run()}
          >
            <Code className="h-4 w-4" />
          </ToolbarButton>
          <div className="mx-1 h-5 w-px bg-border" />
          <ToolbarButton
            active={tb?.bullet}
            label={t("tools.bullet")}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
          >
            <List className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            active={tb?.ordered}
            label={t("tools.ordered")}
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
          >
            <ListOrdered className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            active={tb?.quote}
            label={t("tools.quote")}
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
          >
            <Quote className="h-4 w-4" />
          </ToolbarButton>
          <div className="mx-1 h-5 w-px bg-border" />
          <ToolbarButton
            disabled={!tb?.canUndo}
            label={t("tools.undo")}
            onClick={() => editor.chain().focus().undo().run()}
          >
            <Undo2 className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            disabled={!tb?.canRedo}
            label={t("tools.redo")}
            onClick={() => editor.chain().focus().redo().run()}
          >
            <Redo2 className="h-4 w-4" />
          </ToolbarButton>
          <div className="mx-1 h-5 w-px bg-border" />
          <ToolbarButton label={t("outline.find")} onClick={openOutline}>
            <ListTree className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            label={t("citation.find")}
            onClick={() => openCitePanel("", editor.state.selection.to)}
          >
            <Search className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            label={t("citation.relink")}
            onClick={handleRelinkCitations}
            disabled={relinking}
          >
            {relinking ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Link2 className="h-4 w-4" />
            )}
          </ToolbarButton>
          <select
            value={citationStyle}
            onChange={(e) => setCitationStyle(e.target.value as CitationStyle)}
            title={t("citation.styleLabel")}
            aria-label={t("citation.styleLabel")}
            className="h-8 rounded-md border bg-background px-1.5 text-xs font-medium text-foreground"
          >
            {CITATION_STYLES.map((s) => (
              <option key={s} value={s}>
                {CITATION_STYLE_LABEL[s]}
              </option>
            ))}
          </select>
          <ToolbarButton label={t("versions.find")} onClick={openVersions}>
            <History className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton label={t("export.find")} onClick={openExport}>
            <Download className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton label={t("defect.find")} onClick={handleCheckDefects}>
            <ShieldAlert className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            label={t("verify.find")}
            disabled={verifyingCites}
            onClick={handleVerifyCitations}
          >
            {verifyingCites ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <BadgeCheck className="h-4 w-4" />
            )}
          </ToolbarButton>
          <ToolbarButton label={t("find.title")} onClick={openFind}>
            <Replace className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton label={t("shortcuts.title")} onClick={openShortcuts}>
            <Keyboard className="h-4 w-4" />
          </ToolbarButton>
          <div className="mx-1 h-5 w-px bg-border" />
          <Button
            type="button"
            variant={aiMode === "off" ? "ghost" : "secondary"}
            size="sm"
            className="h-8 gap-1.5 px-2 text-xs"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() =>
              setAiMode(
                aiMode === "auto"
                  ? "manual"
                  : aiMode === "manual"
                    ? "off"
                    : "auto",
              )
            }
            title={t("ai.cycleHint")}
          >
            <Sparkles className="h-4 w-4" />
            {t(`ai.mode.${aiMode}`)}
          </Button>
          {aiMode !== "off" && (
            <span className="ml-1 hidden text-xs text-muted-foreground sm:inline">
              {aiMode === "auto" ? t("ai.hintAuto") : t("ai.hintManual")}
            </span>
          )}
        </div>

        {/* Content */}
        <div className="rounded-lg border bg-background p-6 sm:p-8">
          <EditorContent editor={editor} />
          <BlockHandle editor={editor} />
        </div>
      </div>

      {/* Cursor inside a table → row/column editing toolbar */}
      <BubbleMenu
        editor={editor}
        pluginKey="tableMenu"
        shouldShow={({ editor }) =>
          !draggingRef.current && editor.isActive("table")
        }
      >
        <TableToolbar editor={editor} />
      </BubbleMenu>

      {/* Select a sentence → find a citation for it (not inside tables — the
          table toolbar takes over there) */}
      <BubbleMenu
        editor={editor}
        pluginKey="textMenu"
        // Small debounce so it settles instead of flashing during selection drags.
        updateDelay={300}
        // Only for real text selections — not when a node (e.g. an image/figure)
        // is selected, nor during/just-after a block drag, where "rewrite"/"cite"
        // make no sense.
        shouldShow={({ editor }) => {
          if (draggingRef.current) return false;
          const { selection } = editor.state;
          if (selection.empty || selection instanceof NodeSelection)
            return false;
          if (editor.isActive("table")) return false;
          return (
            editor.state.doc.textBetween(selection.from, selection.to).trim()
              .length > 0
          );
        }}
      >
        <div className="flex items-center gap-1 rounded-lg border bg-popover p-1 shadow-md">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 px-2 text-xs"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              const { from, to } = editor.state.selection;
              const text = editor.state.doc.textBetween(from, to, " ").trim();
              if (text) openRewrite(text, from, to);
            }}
          >
            <Wand2 className="h-3.5 w-3.5" />
            {t("rewrite.find")}
          </Button>
          <div className="h-5 w-px bg-border" />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 px-2 text-xs"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              const { from, to } = editor.state.selection;
              const claim = editor.state.doc.textBetween(from, to, " ").trim();
              if (claim) openCitePanel(claim, to);
            }}
          >
            <Search className="h-3.5 w-3.5" />
            {t("citation.find")}
          </Button>
        </div>
      </BubbleMenu>

      <CitationPanel editor={editor} docId={doc.doc_id} />
      <RewritePanel editor={editor} docId={doc.doc_id} />
      <OutlinePanel editor={editor} docId={doc.doc_id} />
      <ExportPanel editor={editor} />
      <VersionHistoryPanel editor={editor} docId={doc.doc_id} />
      <ShortcutsHelp />
      <DefectPanel editor={editor} onCancel={cancelCheck} />
      <SlashMenu />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        className="hidden"
        onChange={handleImageSelected}
      />
    </div>
  );
}
