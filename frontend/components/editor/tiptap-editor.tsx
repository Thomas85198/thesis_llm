"use client";

import {
  EditorContent,
  useEditor,
  useEditorState,
  type Editor,
} from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
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
  Sparkles,
  Strikethrough,
  Undo2,
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
import { OutlinePanel } from "@/components/editor/outline-panel";
import { RewritePanel } from "@/components/editor/rewrite-panel";
import { SlashCommand, type SlashItem } from "@/components/editor/slash-command";
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

const AUTOCOMPLETE_DEBOUNCE_MS = 600;

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

  const [aiEnabled, setAiEnabled] = useState(true);

  // Autocomplete plumbing lives in refs so the editor's onUpdate (a stable
  // closure created once) always reads the latest values without having to
  // re-create the editor instance.
  const aiEnabledRef = useRef(aiEnabled);
  const acTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const acAbort = useRef<AbortController | null>(null);
  useEffect(() => {
    aiEnabledRef.current = aiEnabled;
  }, [aiEnabled]);

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

  const triggerAutocomplete = useCallback(
    (ed: Editor) => {
      // Each keystroke cancels the pending request + timer, then re-arms.
      cancelAutocomplete();
      if (!aiEnabledRef.current) return;
      if (!ed.state.selection.empty) return; // only at a collapsed cursor
      acTimer.current = setTimeout(() => {
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
      }, AUTOCOMPLETE_DEBOUNCE_MS);
    },
    [cancelAutocomplete, doc.doc_id, locale]
  );

  // onUpdate captures this once; route through a ref so callback identity
  // changes don't force the editor to rebuild.
  const triggerRef = useRef(triggerAutocomplete);
  useEffect(() => {
    triggerRef.current = triggerAutocomplete;
  }, [triggerAutocomplete]);

  // Image upload: the slash item opens a hidden file picker; on pick we upload
  // and insert a figure node at the cursor.
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<Editor | null>(null);
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
    if (!aiEnabled && editor) {
      cancelAutocomplete();
      editor.commands.clearSuggestion();
    }
  }, [aiEnabled, editor, cancelAutocomplete]);

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
          <ToolbarButton
            active={aiEnabled}
            label={aiEnabled ? t("ai.on") : t("ai.off")}
            onClick={() => setAiEnabled((v) => !v)}
          >
            <Sparkles className="h-4 w-4" />
          </ToolbarButton>
          {aiEnabled && (
            <span className="ml-1 hidden text-xs text-muted-foreground sm:inline">
              {t("ai.hint")}
            </span>
          )}
        </div>

        {/* Content */}
        <div className="rounded-lg border bg-background p-6 sm:p-8">
          <EditorContent editor={editor} />
        </div>
      </div>

      {/* Select a sentence → find a citation for it */}
      <BubbleMenu
        editor={editor}
        shouldShow={({ editor }) => !editor.state.selection.empty}
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
