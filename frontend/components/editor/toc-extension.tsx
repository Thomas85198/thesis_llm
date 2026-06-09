"use client";
// TableOfContents (目錄) — a live table of contents that scans every heading and
// renders a clickable, level-indented outline; clicking an entry scrolls to that
// heading. Auto-updates as headings change, mirroring FigureList / TableList.
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

type TocLabels = { title: string; empty: string; untitled: string };

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    tableOfContents: {
      insertTableOfContents: () => ReturnType;
    };
  }
}

// Directory headings (目錄/圖目錄/表目錄…) are skipped — a TOC shouldn't list
// itself or the figure/table lists.
const DIR_TITLES =
  /^(目錄|目次|圖目錄|圖次|表目錄|表次|table of contents|contents|list of figures|list of tables)$/i;

function isDirectoryHeading(node: { type: { name: string }; textContent: string }): boolean {
  return node.type.name === "heading" && DIR_TITLES.test(node.textContent.trim());
}

/** Every content heading in document order, with its level and text. */
function collectHeadings(editor: Editor): { level: number; text: string }[] {
  const out: { level: number; text: string }[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === "heading" && !isDirectoryHeading(node)) {
      out.push({ level: node.attrs.level || 1, text: node.textContent });
    }
    return true;
  });
  return out;
}

function TocView(props: NodeViewProps) {
  const { editor } = props;
  const labels = props.extension.options.labels as TocLabels;
  const headings = useEditorState({
    editor,
    selector: ({ editor }) => collectHeadings(editor),
    equalityFn: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  });

  // Re-resolve the position on click (live), so edits above don't stale it.
  const goTo = (index: number) => {
    let k = 0;
    let target: number | null = null;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "heading" && !isDirectoryHeading(node)) {
        if (k === index) target = pos;
        k += 1;
      }
      return true;
    });
    if (target != null) {
      editor.chain().focus().setTextSelection(target + 1).scrollIntoView().run();
    }
  };

  return (
    <NodeViewWrapper
      as="div"
      contentEditable={false}
      className="tiptap-toc my-4 rounded-lg border bg-muted/30 p-3"
    >
      <p className="mb-1.5 text-sm font-semibold">{labels.title}</p>
      {headings.length === 0 ? (
        <p className="text-sm text-muted-foreground">{labels.empty}</p>
      ) : (
        <ol className="flex flex-col gap-0.5 text-sm">
          {headings.map((h, i) => (
            <li key={i} style={{ paddingInlineStart: `${(h.level - 1) * 16}px` }}>
              <button
                type="button"
                onClick={() => goTo(i)}
                className="text-left hover:text-primary hover:underline"
              >
                <span className={h.text ? "" : "text-muted-foreground italic"}>
                  {h.text || labels.untitled}
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </NodeViewWrapper>
  );
}

export const TableOfContents = Node.create<{ labels: TocLabels }>({
  name: "tableOfContents",
  group: "block",
  atom: true,
  selectable: true,

  addOptions() {
    return { labels: { title: "Contents", empty: "No headings yet.", untitled: "(untitled)" } };
  },

  parseHTML() {
    return [{ tag: "div[data-toc]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-toc": "" })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(TocView);
  },

  addCommands() {
    return {
      insertTableOfContents:
        () =>
        ({ chain }) =>
          chain().focus().insertContent({ type: this.name }).run(),
    };
  },
});
