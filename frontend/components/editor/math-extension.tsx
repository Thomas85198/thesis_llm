"use client";
// Math nodes (inline + block) rendered with KaTeX. The LaTeX source is stored as
// a node attr; clicking the rendered math reveals an input to edit it, and it
// re-renders on blur. Invalid LaTeX shows inline (throwOnError:false) instead of
// crashing. Labels come via extension options (node views render outside the
// next-intl provider).
import { mergeAttributes, Node, nodeInputRule } from "@tiptap/core";
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import katex from "katex";
import "katex/dist/katex.min.css";
import { useEffect, useMemo, useRef, useState } from "react";

type MathLabels = { placeholder: string; done: string };

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    math: {
      insertMathInline: (latex?: string) => ReturnType;
      insertMathBlock: (latex?: string) => ReturnType;
    };
  }
}

// Users often paste LaTeX wrapped in delimiters (\[ \], \( \), $$ $$, $ $).
// KaTeX wants the bare body (it applies display/inline mode itself), so strip a
// single matching outer pair — otherwise e.g. "\[ \begin{vmatrix}… \]" errors.
function stripMathDelimiters(src: string): string {
  const s = src.trim();
  const pairs: [string, string][] = [
    ["\\[", "\\]"],
    ["\\(", "\\)"],
    ["$$", "$$"],
    ["$", "$"],
  ];
  for (const [open, close] of pairs) {
    if (
      s.length >= open.length + close.length &&
      s.startsWith(open) &&
      s.endsWith(close)
    ) {
      return s.slice(open.length, s.length - close.length).trim();
    }
  }
  return s;
}

function MathView(props: NodeViewProps) {
  const { node, updateAttributes, extension, selected, editor, getPos } = props;
  const display = extension.name === "mathBlock";
  const labels = extension.options.labels as MathLabels;
  const latex = (node.attrs.latex as string) || "";
  const [editing, setEditing] = useState(latex === "");
  const inputRef = useRef<HTMLInputElement>(null);
  // One-shot guard: clicking Done unmounts the input, whose onBlur would
  // otherwise fire a second confirmAndExit and clobber the newline behaviour.
  const exitedRef = useRef(false);

  // Focus the input on entering edit mode; defer a frame so it wins the focus
  // race against the insert command's editor.focus().
  useEffect(() => {
    if (!editing) return;
    exitedRef.current = false;
    const id = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => cancelAnimationFrame(id);
  }, [editing]);

  const html = useMemo(() => {
    try {
      return katex.renderToString(stripMathDelimiters(latex), {
        displayMode: display,
        throwOnError: false,
      });
    } catch {
      return "";
    }
  }, [latex, display]);

  // Confirm the LaTeX and move the caret back into the editor *after* the node,
  // so the cursor doesn't vanish. For a block, Enter also opens a fresh line
  // below (reusing a following empty paragraph if there already is one).
  const confirmAndExit = (newline: boolean) => {
    if (exitedRef.current) return;
    exitedRef.current = true;
    setEditing(false);
    const pos = typeof getPos === "function" ? getPos() : null;
    if (pos == null) {
      editor.commands.focus();
      return;
    }
    const after = pos + node.nodeSize;
    const docEnd = editor.state.doc.content.size;
    if (newline && display) {
      const next = editor.state.doc.resolve(Math.min(after, docEnd)).nodeAfter;
      if (next && next.type.name === "paragraph" && next.content.size === 0) {
        editor
          .chain()
          .focus()
          .setTextSelection(after + 1)
          .run();
      } else {
        editor
          .chain()
          .focus()
          .insertContentAt(after, { type: "paragraph" })
          .setTextSelection(after + 1)
          .run();
      }
    } else {
      editor.chain().focus().setTextSelection(Math.min(after, docEnd)).run();
    }
  };

  // The editor row (LaTeX input + Done) — rendered inline, right next to the
  // display so the two stay together (Notion / most note apps do this).
  const editorRow = (
    <span
      contentEditable={false}
      className="flex items-center gap-2 rounded-xl border bg-popover p-2 text-left shadow-lg"
    >
      <input
        ref={inputRef}
        value={latex}
        onChange={(e) => updateAttributes({ latex: e.target.value })}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") {
            e.preventDefault();
            confirmAndExit(display);
          } else if (e.key === "Escape") {
            e.preventDefault();
            confirmAndExit(false);
          }
        }}
        onBlur={() => confirmAndExit(false)}
        placeholder={labels.placeholder}
        spellCheck={false}
        className="w-[26rem] max-w-[70vw] rounded-md bg-muted/50 px-2.5 py-1.5 font-mono text-sm text-foreground placeholder:text-muted-foreground/70 focus:outline-none"
      />
      <button
        type="button"
        onMouseDown={(e) => {
          e.preventDefault();
          confirmAndExit(display);
        }}
        className="flex shrink-0 items-center gap-1 rounded-md bg-primary px-2.5 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
      >
        {labels.done}
        <span aria-hidden>↵</span>
      </button>
    </span>
  );

  const preview = (
    <span
      contentEditable={false}
      onClick={() => setEditing(true)}
      className="cursor-pointer"
      {...(latex
        ? { dangerouslySetInnerHTML: { __html: html } }
        : {
            children: (
              <span className="text-muted-foreground">
                {labels.placeholder}
              </span>
            ),
          })}
    />
  );

  if (display) {
    // Block math: large centred display, editor row flows directly beneath it.
    return (
      <NodeViewWrapper
        as="div"
        className={`tiptap-math my-3 flex flex-col items-center gap-2 ${
          selected || editing ? "rounded-lg bg-primary/5" : ""
        }`}
      >
        <div className="w-full py-2 text-center text-xl leading-relaxed">
          {preview}
        </div>
        {editing && editorRow}
      </NodeViewWrapper>
    );
  }

  // Inline math: the editor row floats just below the inline node.
  return (
    <NodeViewWrapper
      as="span"
      className={`tiptap-math relative inline-block align-middle ${
        selected || editing ? "rounded bg-primary/10" : ""
      }`}
    >
      {preview}
      {editing && (
        <span className="absolute left-0 top-full z-50 mt-1">{editorRow}</span>
      )}
    </NodeViewWrapper>
  );
}

export const MathInline = Node.create<{ labels: MathLabels }>({
  name: "mathInline",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addOptions() {
    return { labels: { placeholder: "LaTeX, e.g. E=mc^2", done: "Done" } };
  },

  addAttributes() {
    return { latex: { default: "" } };
  },

  parseHTML() {
    return [{ tag: "span[data-math-inline]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, { "data-math-inline": "" }),
      `$${HTMLAttributes.latex || ""}$`,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(MathView);
  },

  addInputRules() {
    // Typing "$x$" turns into inline math.
    return [
      nodeInputRule({
        find: /\$([^$\n]+)\$$/,
        type: this.type,
        getAttributes: (match) => ({ latex: match[1] }),
      }),
    ];
  },

  addCommands() {
    return {
      insertMathInline:
        (latex = "") =>
        ({ chain }) =>
          chain()
            .focus()
            .insertContent({ type: this.name, attrs: { latex } })
            .run(),
      insertMathBlock:
        (latex = "") =>
        ({ chain }) =>
          chain()
            .focus()
            .insertContent({ type: "mathBlock", attrs: { latex } })
            .run(),
    };
  },
});

export const MathBlock = Node.create<{ labels: MathLabels }>({
  name: "mathBlock",
  group: "block",
  atom: true,
  selectable: true,

  addOptions() {
    return {
      labels: { placeholder: "LaTeX, e.g. \\int_0^1 x\\,dx", done: "Done" },
    };
  },

  addAttributes() {
    return { latex: { default: "" } };
  },

  parseHTML() {
    return [{ tag: "div[data-math-block]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-math-block": "" }),
      `$$${HTMLAttributes.latex || ""}$$`,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(MathView);
  },

  addCommands() {
    return {
      insertMathBlock:
        (latex = "") =>
        ({ chain }) =>
          chain()
            .focus()
            .insertContent({ type: this.name, attrs: { latex } })
            .run(),
      insertMathInline:
        (latex = "") =>
        ({ chain }) =>
          chain()
            .focus()
            .insertContent({ type: "mathInline", attrs: { latex } })
            .run(),
    };
  },
});
