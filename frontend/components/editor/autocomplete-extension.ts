// TipTap extension that renders an inline "ghost text" AI suggestion at the
// cursor and lets the user accept it with Tab or dismiss it with Escape.
//
// The suggestion is NOT part of the document — it lives in plugin state and is
// drawn with a ProseMirror widget decoration, so it never pollutes the saved
// content or the undo history. Fetching/streaming the text is the React
// component's job; this extension just exposes commands to set/clear/accept it.
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export const autocompletePluginKey = new PluginKey<AutocompleteState>("autocomplete");

type AutocompleteState = {
  text: string | null;
  from: number | null; // doc position the ghost is anchored at
};

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    autocomplete: {
      /** Show (or update) the ghost suggestion at the current cursor. */
      setSuggestion: (text: string) => ReturnType;
      /** Remove the ghost suggestion without changing the document. */
      clearSuggestion: () => ReturnType;
      /** Insert the ghost suggestion into the document and clear it. */
      acceptSuggestion: () => ReturnType;
    };
  }
}

export const Autocomplete = Extension.create({
  name: "autocomplete",

  addProseMirrorPlugins() {
    return [
      new Plugin<AutocompleteState>({
        key: autocompletePluginKey,
        state: {
          init: () => ({ text: null, from: null }),
          apply(tr, prev) {
            const meta = tr.getMeta(autocompletePluginKey) as
              | { type: "set"; text: string }
              | { type: "clear" }
              | undefined;
            if (meta?.type === "set") {
              return { text: meta.text, from: tr.selection.head };
            }
            if (meta?.type === "clear") {
              return { text: null, from: null };
            }
            // Any actual edit (the user typed) invalidates a pending suggestion.
            if (tr.docChanged && prev.text !== null) {
              return { text: null, from: null };
            }
            // Selection moved away from the anchor → drop it.
            if (
              prev.from !== null &&
              tr.selectionSet &&
              tr.selection.head !== prev.from
            ) {
              return { text: null, from: null };
            }
            return prev;
          },
        },
        props: {
          decorations(state) {
            const ps = autocompletePluginKey.getState(state);
            if (!ps?.text || ps.from === null) return DecorationSet.empty;
            const text = ps.text;
            const widget = Decoration.widget(
              ps.from,
              () => {
                const span = document.createElement("span");
                span.className = "tiptap-ghost";
                span.textContent = text;
                return span;
              },
              { side: 1 }
            );
            return DecorationSet.create(state.doc, [widget]);
          },
        },
      }),
    ];
  },

  addCommands() {
    return {
      setSuggestion:
        (text: string) =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            dispatch(tr.setMeta(autocompletePluginKey, { type: "set", text }));
          }
          return true;
        },
      clearSuggestion:
        () =>
        ({ state, tr, dispatch }) => {
          const ps = autocompletePluginKey.getState(state);
          if (!ps?.text) return false; // nothing to clear — let the key fall through
          if (dispatch) {
            dispatch(tr.setMeta(autocompletePluginKey, { type: "clear" }));
          }
          return true;
        },
      acceptSuggestion:
        () =>
        ({ state, tr, dispatch }) => {
          const ps = autocompletePluginKey.getState(state);
          if (!ps?.text || ps.from === null) return false;
          if (dispatch) {
            dispatch(
              tr
                .insertText(ps.text, state.selection.head)
                .setMeta(autocompletePluginKey, { type: "clear" })
            );
          }
          return true;
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      // Accept on Tab; if there's no suggestion the command returns false and
      // the default Tab behaviour proceeds.
      Tab: () => this.editor.commands.acceptSuggestion(),
      Escape: () => this.editor.commands.clearSuggestion(),
    };
  },
});
