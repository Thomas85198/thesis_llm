"use client";
// Figure (image + editable caption + auto number) and FigureList (a live "List
// of Figures" / 圖目錄). Figures are auto-numbered by document order; the caption
// is stored as a node attr and edited inline. FigureList scans the doc and
// renders every figure's number + caption, updating as figures change.
//
// Labels come through extension options (not useTranslations) because node views
// render outside the next-intl provider tree.
import { mergeAttributes, Node } from "@tiptap/core";
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  useEditorState,
  type NodeViewProps,
} from "@tiptap/react";
import type { Editor } from "@tiptap/core";

import { apiBase } from "@/lib/api";

/** Resolve a figure src for display. Uploaded images store a relative path
 * (/api/editor/images/…) — prepend the API base; absolute/data URLs pass through. */
function resolveSrc(src: string): string {
  if (!src) return "";
  return /^(https?:|data:|blob:)/.test(src) ? src : `${apiBase}${src}`;
}

type FigureLabels = { figureWord: string; captionPlaceholder: string };
type FigureListLabels = { figureWord: string; title: string; empty: string; untitled: string };

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    figure: {
      insertFigure: (attrs: { src: string; caption?: string }) => ReturnType;
      insertFigureList: () => ReturnType;
    };
  }
}

/** 1-based number of the figure at `pos` by document order. */
function figureNumberAt(editor: Editor, pos: number | undefined): number {
  let count = 0;
  let found = 0;
  editor.state.doc.descendants((node, p) => {
    if (node.type.name === "figure") {
      count += 1;
      if (p === pos) found = count;
    }
    return true;
  });
  return found || count + 1;
}

/** All figures in document order, with their captions. */
function collectFigures(editor: Editor): { caption: string }[] {
  const out: { caption: string }[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === "figure") out.push({ caption: node.attrs.caption || "" });
    return true;
  });
  return out;
}

function FigureView(props: NodeViewProps) {
  const { node, editor, updateAttributes, getPos, selected } = props;
  const labels = props.extension.options.labels as FigureLabels;
  const number = useEditorState({
    editor,
    selector: ({ editor }) => figureNumberAt(editor, getPos()),
  });

  return (
    <NodeViewWrapper
      as="figure"
      className={`tiptap-figure my-4 flex flex-col items-center gap-1 ${
        selected ? "rounded ring-2 ring-primary/50" : ""
      }`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={resolveSrc(node.attrs.src)}
        alt={node.attrs.caption || "figure"}
        className="max-h-[480px] max-w-full rounded border"
      />
      <figcaption
        contentEditable={false}
        className="flex w-full items-baseline justify-center gap-1.5 text-sm text-muted-foreground"
      >
        <span className="shrink-0 font-medium text-foreground">
          {labels.figureWord} {number}.
        </span>
        <input
          value={node.attrs.caption}
          onChange={(e) => updateAttributes({ caption: e.target.value })}
          onKeyDown={(e) => e.stopPropagation()}
          placeholder={labels.captionPlaceholder}
          className="w-full max-w-md border-b border-transparent bg-transparent text-center text-sm focus:border-border focus:outline-none"
        />
      </figcaption>
    </NodeViewWrapper>
  );
}

export const Figure = Node.create<{ labels: FigureLabels }>({
  name: "figure",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,

  addOptions() {
    return { labels: { figureWord: "Figure", captionPlaceholder: "Add a caption…" } };
  },

  addAttributes() {
    return {
      src: { default: "" },
      caption: { default: "" },
      alt: { default: "" },
    };
  },

  parseHTML() {
    return [{ tag: "figure[data-figure]" }];
  },

  renderHTML({ HTMLAttributes }) {
    // Static fallback (copy/paste, getHTML); the live editor uses the NodeView.
    return [
      "figure",
      mergeAttributes(HTMLAttributes, { "data-figure": "" }),
      ["img", { src: HTMLAttributes.src, alt: HTMLAttributes.caption || "" }],
      ["figcaption", {}, HTMLAttributes.caption || ""],
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(FigureView);
  },

  addCommands() {
    return {
      insertFigure:
        (attrs) =>
        ({ chain }) =>
          chain().focus().insertContent({ type: this.name, attrs }).run(),
      insertFigureList:
        () =>
        ({ chain }) =>
          chain().focus().insertContent({ type: "figureList" }).run(),
    };
  },
});

function FigureListView(props: NodeViewProps) {
  const { editor } = props;
  const labels = props.extension.options.labels as FigureListLabels;
  const figures = useEditorState({
    editor,
    selector: ({ editor }) => collectFigures(editor),
    equalityFn: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  });

  return (
    <NodeViewWrapper
      as="div"
      contentEditable={false}
      className="tiptap-figure-list my-4 rounded-lg border bg-muted/30 p-3"
    >
      <p className="mb-1.5 text-sm font-semibold">{labels.title}</p>
      {figures.length === 0 ? (
        <p className="text-sm text-muted-foreground">{labels.empty}</p>
      ) : (
        <ol className="flex flex-col gap-0.5 text-sm">
          {figures.map((f, i) => (
            <li key={i}>
              <span className="font-medium">
                {labels.figureWord} {i + 1}.
              </span>{" "}
              <span className={f.caption ? "" : "text-muted-foreground italic"}>
                {f.caption || labels.untitled}
              </span>
            </li>
          ))}
        </ol>
      )}
    </NodeViewWrapper>
  );
}

export const FigureList = Node.create<{ labels: FigureListLabels }>({
  name: "figureList",
  group: "block",
  atom: true,
  selectable: true,

  addOptions() {
    return {
      labels: { figureWord: "Figure", title: "List of Figures", empty: "No figures yet.", untitled: "(untitled)" },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-figure-list]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-figure-list": "" })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(FigureListView);
  },
});
