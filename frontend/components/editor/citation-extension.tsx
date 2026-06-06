"use client";
// Citation as an inline atom Node (not a Mark): the in-text marker's *text* is
// rendered by a React NodeView from the stored metadata, so flipping the global
// citation style (APA ⇄ numeric) just re-renders every chip — it never rewrites
// document text. Numeric labels come from each distinct source's first-appearance
// order in the doc, so duplicate cites of one work share a number.
import { mergeAttributes, Node } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";

import {
  inTextLabel,
  isNumberedStyle,
  referenceHref,
  type CitationAttrs,
} from "@/lib/citation-format";
import { useEditorStore } from "@/lib/editor-store";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    citation: {
      /** Insert a citation chip at `pos` (defaults to the selection end). */
      insertCitation: (attrs: CitationAttrs, pos?: number) => ReturnType;
      /** Refresh every chip's attrs from a fresh-by-openalexId map (rotted links
       * etc.). Returns true if any chip changed. */
      refreshCitations: (byId: Record<string, CitationAttrs>) => ReturnType;
    };
  }
}

/** 1-based number of a source by first appearance among all citation nodes. */
function citationNumber(editor: Editor, openalexId: string): number {
  const order: string[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === "citation") {
      const id = node.attrs.openalexId as string;
      if (id && !order.includes(id)) order.push(id);
    }
    return true;
  });
  const idx = order.indexOf(openalexId);
  return idx === -1 ? order.length + 1 : idx + 1;
}

function CitationChip({ node, editor }: NodeViewProps) {
  const attrs = node.attrs as CitationAttrs;
  const style = useEditorStore((s) => s.citationStyle);
  const number = isNumberedStyle(style)
    ? citationNumber(editor, attrs.openalexId)
    : 0;
  const label = inTextLabel(attrs, style, number);
  const tooltip =
    `${attrs.title}` +
    (attrs.authors ? ` — ${attrs.authors}` : "") +
    (attrs.year ? ` (${attrs.year})` : "");
  return (
    <NodeViewWrapper
      as="span"
      className="tiptap-citation"
      title={tooltip}
      data-doi={attrs.doi}
      onClick={() => {
        const href = referenceHref(attrs);
        if (href) window.open(href, "_blank", "noopener,noreferrer");
      }}
    >
      {label}
    </NodeViewWrapper>
  );
}

export const Citation = Node.create({
  name: "citation",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      openalexId: { default: "" },
      authors: { default: "" },
      year: { default: null },
      title: { default: "" },
      venue: { default: "" },
      doi: { default: "" },
      oaUrl: { default: "" },
      url: { default: "" },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-citation]" }];
  },

  renderHTML({ HTMLAttributes }) {
    // Static fallback for SSR / copy-paste / getHTML(). The live editor renders
    // the NodeView instead; persistence rides on getJSON() (attrs preserved).
    return [
      "span",
      mergeAttributes(HTMLAttributes, { "data-citation": "" }),
      "[cite]",
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(CitationChip);
  },

  addCommands() {
    return {
      insertCitation:
        (attrs, pos) =>
        ({ chain, state }) => {
          const at = pos ?? state.selection.to;
          return chain()
            .insertContentAt(at, { type: this.name, attrs })
            .run();
        },

      refreshCitations:
        (byId) =>
        ({ tr, state, dispatch }) => {
          let changed = false;
          // Attrs-only updates don't shift positions, so iterating the original
          // doc while writing into `tr` is safe.
          state.doc.descendants((node, pos) => {
            if (node.type.name !== this.name) return;
            const next = byId[node.attrs.openalexId as string];
            if (next) {
              tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...next });
              changed = true;
            }
          });
          if (changed && dispatch) dispatch(tr);
          return changed;
        },
    };
  },
});
