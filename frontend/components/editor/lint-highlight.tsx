// Live lint decorations + fix commands. When enabled, every doc change re-runs
// the rule-based linter (lib/lint) and underlines the issues; the panel reads
// the same issues and applies fixes. Rule-based → instant, no token cost.
import { Extension } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

import { lintDoc, type LintIssue } from "@/lib/lint";

type LintState = { enabled: boolean; deco: DecorationSet };

const key = new PluginKey<LintState>("lintHighlight");

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    lint: {
      setLintEnabled: (enabled: boolean) => ReturnType;
      focusLint: (from: number, to: number) => ReturnType;
      applyLintFix: (
        from: number,
        to: number,
        replacement: string,
      ) => ReturnType;
      applyAllLintFixes: () => ReturnType;
    };
  }
}

function build(doc: PMNode, enabled: boolean): DecorationSet {
  if (!enabled) return DecorationSet.empty;
  const decos = lintDoc(doc).map((i: LintIssue) =>
    Decoration.inline(i.from, i.to, { class: `lint lint-${i.type}` }),
  );
  return DecorationSet.create(doc, decos);
}

export const LintHighlight = Extension.create({
  name: "lintHighlight",

  addProseMirrorPlugins() {
    return [
      new Plugin<LintState>({
        key,
        state: {
          init: () => ({ enabled: false, deco: DecorationSet.empty }),
          apply(tr, prev) {
            const meta = tr.getMeta(key) as { enabled: boolean } | undefined;
            if (meta)
              return {
                enabled: meta.enabled,
                deco: build(tr.doc, meta.enabled),
              };
            if (prev.enabled && tr.docChanged)
              return { enabled: true, deco: build(tr.doc, true) };
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
      setLintEnabled:
        (enabled) =>
        ({ tr, dispatch }) => {
          if (dispatch) dispatch(tr.setMeta(key, { enabled }));
          return true;
        },
      focusLint:
        (from, to) =>
        ({ tr, dispatch, editor }) => {
          if (dispatch) {
            dispatch(
              tr
                .setSelection(TextSelection.create(tr.doc, from, to))
                .scrollIntoView(),
            );
            editor.view.focus();
          }
          return true;
        },
      applyLintFix:
        (from, to, replacement) =>
        ({ tr, dispatch }) => {
          if (dispatch) dispatch(tr.insertText(replacement, from, to));
          return true;
        },
      applyAllLintFixes:
        () =>
        ({ state, dispatch }) => {
          // Loop a few passes so overlapping issues (e.g. CJK-Latin-CJK 「與BERT與」
          // where only the first of two overlapping fixes applies per pass) all
          // clear in one click. Fixes converge — each pass strictly reduces and
          // never creates a new issue — so the bound is just a safety cap.
          const tr = state.tr;
          let applied = false;
          for (let pass = 0; pass < 6; pass++) {
            const issues = lintDoc(tr.doc).sort((a, b) => b.from - a.from);
            if (!issues.length) break;
            for (const i of issues) tr.insertText(i.replacement, i.from, i.to);
            applied = true;
          }
          if (applied && dispatch) dispatch(tr);
          return applied;
        },
    };
  },
});
