"use client";
// Tables with a numbered caption above + a live "List of Tables" (表目錄).
// Structure: tableBlock { tableCaption, table } where `table` is the standard
// @tiptap/extension-table grid (editable cells). The caption is auto-numbered
// "表 N." by document order (mirrors figures). TableList scans the doc.
//
// Labels come via extension options (node views render outside the i18n provider).
import { mergeAttributes, Node } from "@tiptap/core";
import {
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  useEditorState,
  type NodeViewProps,
} from "@tiptap/react";
import type { Editor } from "@tiptap/core";

type CaptionLabels = { tableWord: string };
type TableListLabels = { tableWord: string; title: string; empty: string; untitled: string };

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    tableBlock: {
      insertTableBlock: (opts?: { rows?: number; cols?: number }) => ReturnType;
      insertTableList: () => ReturnType;
    };
  }
}

/** 1-based number of the tableBlock that owns the caption at `captionPos`. */
function tableNumberAt(editor: Editor, captionPos: number | undefined): number {
  const order: number[] = [];
  editor.state.doc.descendants((node, p) => {
    if (node.type.name === "tableBlock") order.push(p);
    return true;
  });
  // The caption is the tableBlock's first child, so block pos = captionPos - 1.
  const idx = order.indexOf((captionPos ?? 0) - 1);
  return idx >= 0 ? idx + 1 : order.length + 1;
}

/** Every table's caption text, in document order. */
function collectTables(editor: Editor): { caption: string }[] {
  const out: { caption: string }[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === "tableBlock") {
      let caption = "";
      node.forEach((child) => {
        if (child.type.name === "tableCaption") caption = child.textContent;
      });
      out.push({ caption });
    }
    return true;
  });
  return out;
}

function TableCaptionView(props: NodeViewProps) {
  const { editor, getPos, extension } = props;
  const labels = extension.options.labels as CaptionLabels;
  const number = useEditorState({
    editor,
    selector: ({ editor }) => tableNumberAt(editor, getPos()),
  });
  return (
    <NodeViewWrapper as="div" className="tiptap-table-caption mb-1 text-sm">
      <span contentEditable={false} className="mr-1 font-medium text-foreground">
        {labels.tableWord} {number}.
      </span>
      <NodeViewContent as={"span" as "div"} className="text-muted-foreground" />
    </NodeViewWrapper>
  );
}

export const TableCaption = Node.create<{ labels: CaptionLabels }>({
  name: "tableCaption",
  content: "inline*",
  selectable: false,

  addOptions() {
    return { labels: { tableWord: "Table" } };
  },

  parseHTML() {
    return [{ tag: "figcaption[data-table-caption]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["figcaption", mergeAttributes(HTMLAttributes, { "data-table-caption": "" }), 0];
  },

  addNodeView() {
    return ReactNodeViewRenderer(TableCaptionView);
  },
});

export const TableBlock = Node.create({
  name: "tableBlock",
  group: "block",
  content: "tableCaption table",
  isolating: true,

  parseHTML() {
    return [{ tag: "div[data-table-block]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-table-block": "", class: "tiptap-table-block" }),
      0,
    ];
  },

  addCommands() {
    return {
      insertTableBlock:
        ({ rows = 3, cols = 3 } = {}) =>
        ({ chain }) => {
          const cell = (header: boolean) => ({
            type: header ? "tableHeader" : "tableCell",
            content: [{ type: "paragraph" }],
          });
          const row = (header: boolean) => ({
            type: "tableRow",
            content: Array.from({ length: cols }, () => cell(header)),
          });
          const body = Array.from({ length: Math.max(1, rows - 1) }, () => row(false));
          return chain()
            .focus()
            .insertContent({
              type: this.name,
              content: [
                { type: "tableCaption" },
                { type: "table", content: [row(true), ...body] },
              ],
            })
            .run();
        },
      insertTableList:
        () =>
        ({ chain }) =>
          chain().focus().insertContent({ type: "tableList" }).run(),
    };
  },
});

function TableListView(props: NodeViewProps) {
  const { editor, extension } = props;
  const labels = extension.options.labels as TableListLabels;
  const tables = useEditorState({
    editor,
    selector: ({ editor }) => collectTables(editor),
    equalityFn: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  });
  return (
    <NodeViewWrapper
      as="div"
      contentEditable={false}
      className="tiptap-table-list my-4 rounded-lg border bg-muted/30 p-3"
    >
      <p className="mb-1.5 text-sm font-semibold">{labels.title}</p>
      {tables.length === 0 ? (
        <p className="text-sm text-muted-foreground">{labels.empty}</p>
      ) : (
        <ol className="flex flex-col gap-0.5 text-sm">
          {tables.map((tbl, i) => (
            <li key={i}>
              <span className="font-medium">
                {labels.tableWord} {i + 1}.
              </span>{" "}
              <span className={tbl.caption ? "" : "text-muted-foreground italic"}>
                {tbl.caption || labels.untitled}
              </span>
            </li>
          ))}
        </ol>
      )}
    </NodeViewWrapper>
  );
}

export const TableList = Node.create<{ labels: TableListLabels }>({
  name: "tableList",
  group: "block",
  atom: true,
  selectable: true,

  addOptions() {
    return {
      labels: { tableWord: "Table", title: "List of Tables", empty: "No tables yet.", untitled: "(untitled)" },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-table-list]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-table-list": "" })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(TableListView);
  },
});
