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
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import {
  Bold,
  Code,
  Download,
  Heading1,
  Heading2,
  Heading3,
  Image as ImageIcon,
  Images,
  Italic,
  List,
  ListOrdered,
  ListTree,
  Minus,
  Pilcrow,
  Quote,
  Redo2,
  Search,
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
import { Citation } from "@/components/editor/citation-extension";
import { CitationPanel } from "@/components/editor/citation-panel";
import { ExportPanel } from "@/components/editor/export-panel";
import { Figure, FigureList } from "@/components/editor/figure-extension";
import { MathBlock, MathInline } from "@/components/editor/math-extension";
import { OutlinePanel } from "@/components/editor/outline-panel";
import { RewritePanel } from "@/components/editor/rewrite-panel";
import {
  TableBlock,
  TableCaption,
  TableList,
} from "@/components/editor/table-extension";
import { SlashCommand, type SlashItem } from "@/components/editor/slash-command";
import { TableToolbar } from "@/components/editor/table-toolbar";
import { SlashMenu } from "@/components/editor/slash-menu";
import { Button } from "@/components/ui/button";
import {
  streamAutocomplete,
  uploadImage,
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
  const label: Record<SaveState, string> = {
    idle: t("save.idle"),
    saving: t("save.saving"),
    saved: t("save.saved"),
    error: t("save.error"),
  };
  const color: Record<SaveState, string> = {
    idle: "text-muted-foreground",
    saving: "text-muted-foreground",
    saved: "text-emerald-600 dark:text-emerald-400",
    error: "text-destructive",
  };
  return <span className={cn("text-xs tabular-nums", color[state])}>{label[state]}</span>;
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
  const citationStyle = useEditorStore((s) => s.citationStyle);
  const setCitationStyle = useEditorStore((s) => s.setCitationStyle);

  const [aiMode, setAiMode] = useState<AiMode>("auto");

  // Autocomplete plumbing lives in refs so the editor's onUpdate (a stable
  // closure created once) always reads the latest values without having to
  // re-create the editor instance.
  const aiModeRef = useRef(aiMode);
  const editorRef = useRef<Editor | null>(null);
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
        controller.signal
      ).catch(() => {
        /* network/abort — best-effort, just no suggestion */
      });
    },
    [doc.doc_id, locale]
  );

  // Auto path: debounced and gated on a word/sentence boundary (whitespace or
  // punctuation before the cursor) so suggestions stop popping up mid-word on
  // every pause. Manual mode skips this entirely (hotkey only).
  const triggerAutocomplete = useCallback(
    (ed: Editor) => {
      cancelAutocomplete(); // each keystroke cancels the pending request + timer
      if (aiModeRef.current !== "auto") return;
      if (!ed.state.selection.empty) return;
      const before = ed.state.doc.textBetween(0, ed.state.selection.head, "\n", " ");
      if (before.trim().length < AUTOCOMPLETE_MIN_CHARS) return;
      if (!AUTOCOMPLETE_BOUNDARY.test(before.slice(-1))) return;
      acTimer.current = setTimeout(() => requestSuggestion(ed), AUTOCOMPLETE_DEBOUNCE_MS);
    },
    [cancelAutocomplete, requestSuggestion]
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
    []
  );

  // Slash menu items. `command` deletes the "/query" range, then applies the
  // block change. Memoized per locale (useEditor captures it on mount).
  const slashItems = useMemo<SlashItem[]>(
    () => [
    { title: t("slash.text"), hint: t("slash.textHint"), icon: Pilcrow,
      keywords: ["text", "paragraph", "p", "文字", "段落", "內文"],
      command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setParagraph().run() },
    { title: t("slash.h1"), icon: Heading1, keywords: ["h1", "heading", "title", "標題"],
      command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setNode("heading", { level: 1 }).run() },
    { title: t("slash.h2"), icon: Heading2, keywords: ["h2", "heading", "標題"],
      command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setNode("heading", { level: 2 }).run() },
    { title: t("slash.h3"), icon: Heading3, keywords: ["h3", "heading", "標題"],
      command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setNode("heading", { level: 3 }).run() },
    { title: t("slash.bullet"), icon: List, keywords: ["bullet", "list", "ul", "項目", "清單"],
      command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleBulletList().run() },
    { title: t("slash.ordered"), icon: ListOrdered, keywords: ["number", "ordered", "ol", "編號", "清單"],
      command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleOrderedList().run() },
    { title: t("slash.quote"), icon: Quote, keywords: ["quote", "blockquote", "引言", "引用"],
      command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleBlockquote().run() },
    { title: t("slash.code"), icon: Code, keywords: ["code", "程式", "程式碼"],
      command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleCodeBlock().run() },
    { title: t("slash.divider"), icon: Minus, keywords: ["divider", "hr", "rule", "分隔線", "分隔"],
      command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setHorizontalRule().run() },
    { title: t("slash.image"), hint: t("slash.imageHint"), icon: ImageIcon,
      keywords: ["image", "img", "picture", "photo", "圖", "圖片", "照片"],
      command: ({ editor, range }) => { editor.chain().focus().deleteRange(range).run(); openImagePicker(); } },
    { title: t("slash.figureList"), icon: Images, keywords: ["figures", "list", "圖目錄", "目錄"],
      command: ({ editor, range }) => editor.chain().focus().deleteRange(range).insertFigureList().run() },
    { title: t("slash.mathInline"), icon: Variable,
      keywords: ["math", "inline", "equation", "latex", "數學", "行內", "公式"],
      command: ({ editor, range }) => editor.chain().focus().deleteRange(range).insertMathInline().run() },
    { title: t("slash.mathBlock"), icon: Sigma,
      keywords: ["math", "block", "equation", "latex", "數學", "區塊", "公式"],
      command: ({ editor, range }) => editor.chain().focus().deleteRange(range).insertMathBlock().run() },
    { title: t("slash.table"), icon: TableIcon, keywords: ["table", "grid", "表格", "表"],
      command: ({ editor, range }) => editor.chain().focus().deleteRange(range).insertTableBlock().run() },
    { title: t("slash.tableList"), icon: TableProperties, keywords: ["tables", "list", "表目錄", "目錄"],
      command: ({ editor, range }) => editor.chain().focus().deleteRange(range).insertTableList().run() },
    ],
    [t, openImagePicker]
  );

  const editor = useEditor({
    extensions: [
      StarterKit,
      Autocomplete,
      Citation,
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
      MathInline.configure({ labels: { placeholder: t("math.inlinePlaceholder") } }),
      MathBlock.configure({ labels: { placeholder: t("math.blockPlaceholder") } }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      TableBlock,
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
    ],
    content: doc.content_json,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: "tiptap-content focus:outline-none",
        "aria-label": t("editorAria"),
      },
      // ⌘/Ctrl+J manually requests a ghost-text suggestion (Jenni-style).
      handleKeyDown: (_view, event) => {
        if (event.key.toLowerCase() === "j" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          manualTriggerRef.current();
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

  // Bind store to this document on mount; clear timers on unmount.
  useEffect(() => {
    init(doc.doc_id, doc.title);
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
  });

  if (!editor) return null;

  const goToHeading = (pos: number) => {
    editor.chain().focus().setTextSelection(pos + 1).scrollIntoView().run();
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 gap-6 px-4 py-6 sm:px-6">
      {/* Outline */}
      <aside className="hidden w-56 shrink-0 lg:block">
        <div className="sticky top-20">
          <h2 className="mb-2 px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("outline")}
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
            <p className="px-2 text-sm text-muted-foreground/60">{t("outlineEmpty")}</p>
          )}
        </div>
      </aside>

      {/* Editor column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Title + save status */}
        <div className="mb-4 flex items-center gap-3">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("titlePlaceholder")}
            className="min-w-0 flex-1 bg-transparent text-2xl font-semibold outline-none placeholder:text-muted-foreground/50"
            aria-label={t("titleAria")}
          />
          <SaveBadge state={saveState} />
        </div>

        {/* Toolbar */}
        <div className="sticky top-14 z-10 mb-3 flex flex-wrap items-center gap-0.5 rounded-lg border bg-background/95 p-1 backdrop-blur">
          <ToolbarButton active={tb?.h1} label={t("tools.h1")} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}>
            <Heading1 className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton active={tb?.h2} label={t("tools.h2")} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
            <Heading2 className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton active={tb?.h3} label={t("tools.h3")} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>
            <Heading3 className="h-4 w-4" />
          </ToolbarButton>
          <div className="mx-1 h-5 w-px bg-border" />
          <ToolbarButton active={tb?.bold} label={t("tools.bold")} onClick={() => editor.chain().focus().toggleBold().run()}>
            <Bold className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton active={tb?.italic} label={t("tools.italic")} onClick={() => editor.chain().focus().toggleItalic().run()}>
            <Italic className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton active={tb?.strike} label={t("tools.strike")} onClick={() => editor.chain().focus().toggleStrike().run()}>
            <Strikethrough className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton active={tb?.code} label={t("tools.code")} onClick={() => editor.chain().focus().toggleCode().run()}>
            <Code className="h-4 w-4" />
          </ToolbarButton>
          <div className="mx-1 h-5 w-px bg-border" />
          <ToolbarButton active={tb?.bullet} label={t("tools.bullet")} onClick={() => editor.chain().focus().toggleBulletList().run()}>
            <List className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton active={tb?.ordered} label={t("tools.ordered")} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
            <ListOrdered className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton active={tb?.quote} label={t("tools.quote")} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
            <Quote className="h-4 w-4" />
          </ToolbarButton>
          <div className="mx-1 h-5 w-px bg-border" />
          <ToolbarButton disabled={!tb?.canUndo} label={t("tools.undo")} onClick={() => editor.chain().focus().undo().run()}>
            <Undo2 className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton disabled={!tb?.canRedo} label={t("tools.redo")} onClick={() => editor.chain().focus().redo().run()}>
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
          <ToolbarButton label={t("export.find")} onClick={openExport}>
            <Download className="h-4 w-4" />
          </ToolbarButton>
          <div className="mx-1 h-5 w-px bg-border" />
          <Button
            type="button"
            variant={aiMode === "off" ? "ghost" : "secondary"}
            size="sm"
            className="h-8 gap-1.5 px-2 text-xs"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() =>
              setAiMode(aiMode === "auto" ? "manual" : aiMode === "manual" ? "off" : "auto")
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
        </div>
      </div>

      {/* Cursor inside a table → row/column editing toolbar */}
      <BubbleMenu
        editor={editor}
        pluginKey="tableMenu"
        shouldShow={({ editor }) => editor.isActive("table")}
      >
        <TableToolbar editor={editor} />
      </BubbleMenu>

      {/* Select a sentence → find a citation for it (not inside tables — the
          table toolbar takes over there) */}
      <BubbleMenu
        editor={editor}
        pluginKey="textMenu"
        // Only for real text selections — not when a node (e.g. an image/figure)
        // is selected, where "rewrite"/"cite" make no sense.
        shouldShow={({ editor }) => {
          const { selection } = editor.state;
          if (selection.empty || selection instanceof NodeSelection) return false;
          if (editor.isActive("table")) return false;
          return (
            editor.state.doc.textBetween(selection.from, selection.to).trim().length > 0
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
