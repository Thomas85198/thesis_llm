"use client";
// Inline defect underlines. Given a list of {text, severity} (the evidence
// sentences returned by the Thesis Critic), this draws a red/amber wavy
// underline under each matching span in the document — so structural defects
// show up at the point of writing, not in an after-the-fact report.
//
// Matching is per text node (evidence is sentence-level, normally within one
// node); evidence spanning multiple nodes is skipped (rare).
import { Extension } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export type DefectMark = { text: string; severity: string };

type DefectState = {
  marks: DefectMark[];
  active: string | null; // the focused defect's sentence — persistent strong highlight
  hover: string | null; // hovered card's sentence — transient highlight
  deco: DecorationSet;
};

const key = new PluginKey<DefectState>("defectHighlight");

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    defectHighlight: {
      setDefectHighlights: (marks: DefectMark[]) => ReturnType;
      clearDefectHighlights: () => ReturnType;
      /** Persistently highlight + scroll to a defect's sentence (stays until
       * another is focused or highlights are cleared — not a vanishing selection). */
      focusDefect: (text: string) => ReturnType;
      /** Light, transient highlight as the user hovers a defect card. */
      setHoverDefect: (text: string | null) => ReturnType;
      /** Drop the focused/hovered highlight (e.g. when the panel closes), but
       * keep the severity underlines. */
      clearDefectFocus: () => ReturnType;
    };
  }
}

function findSpan(
  doc: PMNode,
  needle: string,
): { from: number; to: number } | null {
  const n = needle.trim();
  if (n.length < 4) return null;
  let found: { from: number; to: number } | null = null;
  doc.descendants((node, pos) => {
    if (found || !node.isText || !node.text) return;
    const idx = node.text.indexOf(n);
    if (idx >= 0) found = { from: pos + idx, to: pos + idx + n.length };
    return true;
  });
  return found;
}

function eachOccurrence(
  doc: PMNode,
  needle: string,
  cb: (from: number, to: number) => void,
): void {
  const n = needle.trim();
  if (n.length < 4) return;
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    let idx = node.text.indexOf(n);
    while (idx >= 0) {
      cb(pos + idx, pos + idx + n.length);
      idx = node.text.indexOf(n, idx + n.length);
    }
    return true;
  });
}

function buildDecorations(
  doc: PMNode,
  marks: DefectMark[],
  active: string | null,
  hover: string | null,
): DecorationSet {
  const decos: Decoration[] = [];
  // Severity underlines first (overview), then the hover + active backgrounds on
  // top so the focused/hovered sentence clearly stands out.
  for (const m of marks)
    eachOccurrence(doc, m.text, (from, to) =>
      decos.push(
        Decoration.inline(from, to, {
          class: `tiptap-defect tiptap-defect-${m.severity}`,
        }),
      ),
    );
  if (hover)
    eachOccurrence(doc, hover, (from, to) =>
      decos.push(Decoration.inline(from, to, { class: "tiptap-defect-hover" })),
    );
  if (active)
    eachOccurrence(doc, active, (from, to) =>
      decos.push(
        Decoration.inline(from, to, { class: "tiptap-defect-active" }),
      ),
    );
  return DecorationSet.create(doc, decos);
}

const EMPTY: DefectState = {
  marks: [],
  active: null,
  hover: null,
  deco: DecorationSet.empty,
};

export const DefectHighlight = Extension.create({
  name: "defectHighlight",

  addProseMirrorPlugins() {
    return [
      new Plugin<DefectState>({
        key,
        state: {
          init: () => EMPTY,
          apply(tr, prev) {
            const meta = tr.getMeta(key) as Partial<DefectState> | undefined;
            if (meta) {
              const marks = meta.marks ?? prev.marks;
              const active =
                "active" in meta ? (meta.active ?? null) : prev.active;
              const hover = "hover" in meta ? (meta.hover ?? null) : prev.hover;
              return {
                marks,
                active,
                hover,
                deco: buildDecorations(tr.doc, marks, active, hover),
              };
            }
            if (tr.docChanged)
              return { ...prev, deco: prev.deco.map(tr.mapping, tr.doc) };
            return prev;
          },
        },
        props: {
          decorations(state) {
            return key.getState(state)?.deco;
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
          if (dispatch)
            dispatch(tr.setMeta(key, { marks, active: null, hover: null }));
          return true;
        },
      clearDefectHighlights:
        () =>
        ({ tr, dispatch }) => {
          if (dispatch)
            dispatch(tr.setMeta(key, { marks: [], active: null, hover: null }));
          return true;
        },
      setHoverDefect:
        (text) =>
        ({ tr, dispatch }) => {
          if (dispatch) dispatch(tr.setMeta(key, { hover: text }));
          return true;
        },
      clearDefectFocus:
        () =>
        ({ tr, dispatch }) => {
          if (dispatch)
            dispatch(tr.setMeta(key, { active: null, hover: null }));
          return true;
        },
      focusDefect:
        (text) =>
        ({ editor, tr, dispatch }) => {
          const span = findSpan(editor.state.doc, text);
          if (!span) return false;
          if (dispatch) {
            dispatch(
              tr
                .setMeta(key, { active: text.trim() })
                .setSelection(TextSelection.create(tr.doc, span.from, span.to))
                .scrollIntoView(),
            );
            editor.view.focus();
          }
          return true;
        },
    };
  },
});
