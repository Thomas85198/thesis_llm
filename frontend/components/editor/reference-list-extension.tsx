"use client";
// Auto-generated bibliography. A block atom that scans the document for citation
// chips and renders a live, style-aware reference list (mirrors FigureList /
// TableList). Distinct sources by first appearance (deduped by citeKey), so the
// numbers line up with the in-text markers; unresolved ("待補來源") citations are
// left out — they're not complete references yet (the panel surfaces those).
//
// Labels come via extension options (node views render outside the i18n provider).
import { mergeAttributes, Node } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  useEditorState,
  type NodeViewProps,
} from "@tiptap/react";

import {
  citeKey,
  fullReference,
  type CitationAttrs,
} from "@/lib/citation-format";
import { useEditorStore } from "@/lib/editor-store";

type RefListLabels = { title: string; empty: string; toText: string };

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    referenceList: {
      insertReferenceList: () => ReturnType;
    };
  }
}

/** Distinct resolved citations in document order (deduped by citeKey). */
function collectResolved(editor: Editor): CitationAttrs[] {
  const seen = new Set<string>();
  const out: CitationAttrs[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === "citation") {
      const a = node.attrs as CitationAttrs;
      if (a.unlinked) return true; // not a complete reference yet
      const k = citeKey(a);
      if (k && !seen.has(k)) {
        seen.add(k);
        out.push(a);
      }
    }
    return true;
  });
  return out;
}

function ReferenceListView(props: NodeViewProps) {
  const { editor, node, getPos } = props;
  const labels = props.extension.options.labels as RefListLabels;
  const style = useEditorStore((s) => s.citationStyle);
  const refs = useEditorState({
    editor,
    selector: ({ editor }) => collectResolved(editor),
    equalityFn: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  });

  // Freeze the auto-list into plain editable paragraphs: the user takes over —
  // reorder/edit freely; it no longer auto-updates. (Best of both: auto-build,
  // then hand off for manual control.)
  const convertToText = () => {
    const pos = typeof getPos === "function" ? getPos() : null;
    if (pos == null) return;
    const paras =
      refs.length === 0
        ? [{ type: "paragraph" }]
        : refs.map((r, i) => ({
            type: "paragraph",
            content: [{ type: "text", text: fullReference(r, style, i + 1) }],
          }));
    editor
      .chain()
      .focus()
      .insertContentAt({ from: pos, to: pos + node.nodeSize }, paras)
      .run();
  };

  return (
    <NodeViewWrapper
      as="div"
      contentEditable={false}
      className="tiptap-reference-list group relative my-4"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="font-semibold">{labels.title}</p>
        {refs.length > 0 && (
          <button
            type="button"
            onClick={convertToText}
            className="shrink-0 rounded px-1.5 py-0.5 text-xs text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus:opacity-100 group-hover:opacity-100"
          >
            {labels.toText}
          </button>
        )}
      </div>
      {refs.length === 0 ? (
        <p className="text-sm text-muted-foreground">{labels.empty}</p>
      ) : (
        <ol className="tiptap-reference-list-ol flex flex-col gap-1.5">
          {refs.map((r, i) => (
            <li key={citeKey(r)} className="break-words leading-relaxed">
              {fullReference(r, style, i + 1)}
            </li>
          ))}
        </ol>
      )}
    </NodeViewWrapper>
  );
}

export const ReferenceList = Node.create<{ labels: RefListLabels }>({
  name: "referenceList",
  group: "block",
  atom: true,
  selectable: true,

  addOptions() {
    return {
      labels: {
        title: "References",
        empty: "No citations yet.",
        toText: "Convert to text",
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-reference-list]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-reference-list": "" }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ReferenceListView);
  },

  addCommands() {
    return {
      insertReferenceList:
        () =>
        ({ chain }) =>
          chain().focus().insertContent({ type: this.name }).run(),
    };
  },
});
