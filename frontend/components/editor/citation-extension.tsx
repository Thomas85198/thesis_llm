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
import type { KeyboardEvent } from "react";

import {
  citeKey,
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

// citeKey → 1-based number by first appearance, computed once per document
// version. Keyed on the doc node (ProseMirror makes a fresh doc per change), so
// the WeakMap auto-invalidates and every chip shares one O(n) scan instead of
// re-scanning per chip (was O(n²)). Keying by citeKey (not openalexId) means
// unlinked chips group + number correctly too.
const numberingCache = new WeakMap<object, Map<string, number>>();

function citationNumber(editor: Editor, key: string): number {
  const doc = editor.state.doc;
  let map = numberingCache.get(doc);
  if (!map) {
    map = new Map<string, number>();
    doc.descendants((node) => {
      if (node.type.name === "citation") {
        const k = citeKey(node.attrs as CitationAttrs);
        if (k && !map!.has(k)) map!.set(k, map!.size + 1);
      }
      return true;
    });
    numberingCache.set(doc, map);
  }
  return map.get(key) ?? map.size + 1;
}

function CitationChip({ node, editor, getPos }: NodeViewProps) {
  const attrs = node.attrs as CitationAttrs;
  const style = useEditorStore((s) => s.citationStyle);
  const number = isNumberedStyle(style)
    ? citationNumber(editor, citeKey(attrs))
    : 0;
  const label = inTextLabel(attrs, style, number);
  const tooltip = attrs.unlinked
    ? `${attrs.raw || attrs.authors}（待補來源，點擊找來源）`
    : `${attrs.title}` +
      (attrs.authors ? ` — ${attrs.authors}` : "") +
      (attrs.year ? ` (${attrs.year})` : "");
  // Linked → open the source; unlinked → open Smart Citation to find a source,
  // seeded with the marker text and pointed at this chip so picking a result
  // replaces it in place.
  const activate = () => {
    if (attrs.unlinked) {
      const pos = typeof getPos === "function" ? getPos() : null;
      const query = (
        attrs.raw || `${attrs.authors} ${attrs.year ?? ""}`
      ).trim();
      useEditorStore
        .getState()
        .openCitePanel(query, pos ?? editor.state.selection.to, citeKey(attrs));
      return;
    }
    const href = referenceHref(attrs);
    if (href) window.open(href, "_blank", "noopener,noreferrer");
  };
  return (
    <NodeViewWrapper
      as="span"
      className={`tiptap-citation${attrs.unlinked ? " tiptap-citation-unlinked" : ""}`}
      title={tooltip}
      data-doi={attrs.doi}
      role="button"
      tabIndex={0}
      aria-label={tooltip}
      onClick={activate}
      onKeyDown={(e: KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          activate();
        }
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
      unlinked: { default: false },
      kind: { default: "academic" },
      raw: { default: "" },
      narrative: { default: false },
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
          return chain().insertContentAt(at, { type: this.name, attrs }).run();
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
