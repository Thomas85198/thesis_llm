"use client";
// Inline defect underlines. Given a list of {text, severity} (the evidence
// sentences returned by the Thesis Critic), this draws a red/amber wavy
// underline under each matching span in the document — so structural defects
// show up at the point of writing, not in an after-the-fact report.
//
// Matching is per text node (evidence is sentence-level, normally within one
// node); evidence spanning multiple nodes is skipped (rare).
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export type DefectMark = { text: string; severity: string };

const key = new PluginKey<DecorationSet>("defectHighlight");

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    defectHighlight: {
      setDefectHighlights: (marks: DefectMark[]) => ReturnType;
      clearDefectHighlights: () => ReturnType;
      /** Select + scroll to the first occurrence of `text`. */
      focusDefect: (text: string) => ReturnType;
    };
  }
}

function buildDecorations(doc: import("@tiptap/pm/model").Node, marks: DefectMark[]): DecorationSet {
  if (marks.length === 0) return DecorationSet.empty;
  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    const text = node.text;
    for (const m of marks) {
      const needle = m.text.trim();
      if (needle.length < 4) continue;
      const idx = text.indexOf(needle);
      if (idx >= 0) {
        decos.push(
          Decoration.inline(pos + idx, pos + idx + needle.length, {
            class: `tiptap-defect tiptap-defect-${m.severity}`,
          })
        );
      }
    }
    return true;
  });
  return DecorationSet.create(doc, decos);
}

export const DefectHighlight = Extension.create({
  name: "defectHighlight",

  addStorage() {
    return { marks: [] as DefectMark[] };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, old) {
            const next = tr.getMeta(key) as DefectMark[] | undefined;
            if (next) return buildDecorations(tr.doc, next);
            return old.map(tr.mapping, tr.doc);
          },
        },
        props: {
          decorations(state) {
            return key.getState(state);
          },
        },
      }),
    ];
  },

  addCommands() {
    return {
      setDefectHighlights:
        (marks) =>
        ({ tr, dispatch }) => {
          this.storage.marks = marks;
          if (dispatch) dispatch(tr.setMeta(key, marks));
          return true;
        },
      clearDefectHighlights:
        () =>
        ({ tr, dispatch }) => {
          this.storage.marks = [];
          if (dispatch) dispatch(tr.setMeta(key, []));
          return true;
        },
      focusDefect:
        (text) =>
        ({ editor, chain }) => {
          const needle = text.trim();
          if (needle.length < 4) return false;
          let found: { from: number; to: number } | null = null;
          editor.state.doc.descendants((node, pos) => {
            if (found || !node.isText || !node.text) return;
            const idx = node.text.indexOf(needle);
            if (idx >= 0) found = { from: pos + idx, to: pos + idx + needle.length };
            return true;
          });
          if (!found) return false;
          return chain().focus().setTextSelection(found).scrollIntoView().run();
        },
    };
  },
});
