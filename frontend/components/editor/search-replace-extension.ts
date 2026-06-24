// Find & Replace for the editor: a ProseMirror plugin that highlights all
// matches of a search term (decorations), tracks a "current" match, and offers
// next/prev + replace/replace-all commands. No external dependency — works with
// the TipTap v3 / ProseMirror already in the bundle.
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";

export const searchKey = new PluginKey<SearchState>("searchReplace");

type Match = { from: number; to: number };
type SearchState = {
  term: string;
  caseSensitive: boolean;
  matches: Match[];
  current: number; // index into matches, or -1
  deco: DecorationSet;
};

function findMatches(
  doc: PMNode,
  term: string,
  caseSensitive: boolean,
): Match[] {
  const out: Match[] = [];
  if (!term) return out;
  const needle = caseSensitive ? term : term.toLowerCase();
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    const hay = caseSensitive ? node.text : node.text.toLowerCase();
    let i = 0;
    while ((i = hay.indexOf(needle, i)) !== -1) {
      out.push({ from: pos + i, to: pos + i + term.length });
      i += term.length;
    }
  });
  return out;
}

function buildDeco(
  doc: PMNode,
  matches: Match[],
  current: number,
): DecorationSet {
  if (!matches.length) return DecorationSet.empty;
  return DecorationSet.create(
    doc,
    matches.map((m, i) =>
      Decoration.inline(m.from, m.to, {
        class:
          i === current ? "search-match search-match-current" : "search-match",
      }),
    ),
  );
}

function recompute(
  doc: PMNode,
  term: string,
  caseSensitive: boolean,
  desired: number,
): SearchState {
  const matches = findMatches(doc, term, caseSensitive);
  let current = desired;
  if (!matches.length) current = -1;
  else if (current < 0 || current >= matches.length) current = 0;
  return {
    term,
    caseSensitive,
    matches,
    current,
    deco: buildDeco(doc, matches, current),
  };
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    searchReplace: {
      setSearchTerm: (term: string, caseSensitive?: boolean) => ReturnType;
      searchNext: () => ReturnType;
      searchPrev: () => ReturnType;
      replaceCurrent: (replacement: string) => ReturnType;
      replaceAll: (replacement: string) => ReturnType;
      clearSearch: () => ReturnType;
    };
  }
}

function gotoTr(
  tr: Transaction,
  state: EditorState,
  current: number,
): Transaction {
  const s = searchKey.getState(state);
  const m = s?.matches[current];
  tr = tr.setMeta(searchKey, { current });
  if (m) {
    tr = tr
      .setSelection(TextSelection.create(tr.doc, m.from, m.to))
      .scrollIntoView();
  }
  return tr;
}

export const SearchReplace = Extension.create({
  name: "searchReplace",

  addProseMirrorPlugins() {
    return [
      new Plugin<SearchState>({
        key: searchKey,
        state: {
          init: () => ({
            term: "",
            caseSensitive: false,
            matches: [],
            current: -1,
            deco: DecorationSet.empty,
          }),
          apply(tr, value, _old, newState) {
            const meta = tr.getMeta(searchKey) as
              | Partial<Pick<SearchState, "term" | "caseSensitive" | "current">>
              | undefined;
            // Nothing relevant changed → keep (but remap decorations on edits).
            if (!meta && !tr.docChanged) return value;
            const term = meta?.term ?? value.term;
            const caseSensitive = meta?.caseSensitive ?? value.caseSensitive;
            const desired = meta?.current ?? value.current;
            return recompute(newState.doc, term, caseSensitive, desired);
          },
        },
        props: {
          decorations: (state) => searchKey.getState(state)?.deco,
        },
      }),
    ];
  },

  addCommands() {
    return {
      setSearchTerm:
        (term, caseSensitive = false) =>
        ({ state, dispatch, tr }) => {
          if (dispatch)
            dispatch(
              tr.setMeta(searchKey, { term, caseSensitive, current: 0 }),
            );
          return true;
        },
      searchNext:
        () =>
        ({ state, dispatch, tr }) => {
          const s = searchKey.getState(state);
          if (!s || !s.matches.length) return false;
          const next = (s.current + 1) % s.matches.length;
          if (dispatch) dispatch(gotoTr(tr, state, next));
          return true;
        },
      searchPrev:
        () =>
        ({ state, dispatch, tr }) => {
          const s = searchKey.getState(state);
          if (!s || !s.matches.length) return false;
          const prev = (s.current - 1 + s.matches.length) % s.matches.length;
          if (dispatch) dispatch(gotoTr(tr, state, prev));
          return true;
        },
      replaceCurrent:
        (replacement) =>
        ({ state, dispatch, tr }) => {
          const s = searchKey.getState(state);
          if (!s || s.current < 0 || !s.matches[s.current]) return false;
          const { from, to } = s.matches[s.current];
          if (dispatch) dispatch(tr.insertText(replacement, from, to));
          return true;
        },
      replaceAll:
        (replacement) =>
        ({ state, dispatch, tr }) => {
          const s = searchKey.getState(state);
          if (!s || !s.matches.length) return false;
          if (dispatch) {
            // Right-to-left so earlier match positions stay valid.
            [...s.matches]
              .reverse()
              .forEach((m) => tr.insertText(replacement, m.from, m.to));
            dispatch(tr);
          }
          return true;
        },
      clearSearch:
        () =>
        ({ dispatch, tr }) => {
          if (dispatch)
            dispatch(tr.setMeta(searchKey, { term: "", current: -1 }));
          return true;
        },
    };
  },
});
