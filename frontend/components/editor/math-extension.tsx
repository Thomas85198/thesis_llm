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
import { useMemo, useState } from "react";

type MathLabels = { placeholder: string };

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    math: {
      insertMathInline: (latex?: string) => ReturnType;
      insertMathBlock: (latex?: string) => ReturnType;
    };
  }
}

function MathView(props: NodeViewProps) {
  const { node, updateAttributes, extension, selected } = props;
  const display = extension.name === "mathBlock";
  const labels = extension.options.labels as MathLabels;
  const latex = (node.attrs.latex as string) || "";
  const [editing, setEditing] = useState(latex === "");

  const html = useMemo(() => {
    try {
      return katex.renderToString(latex, { displayMode: display, throwOnError: false });
    } catch {
      return "";
    }
  }, [latex, display]);

  const Wrapper = display ? "div" : "span";
  return (
    <NodeViewWrapper
      as={Wrapper}
      className={`tiptap-math ${display ? "my-3 block text-center" : "inline-block align-middle"} ${
        selected ? "rounded bg-primary/10" : ""
      }`}
    >
      {editing ? (
        <input
          autoFocus
          value={latex}
          onChange={(e) => updateAttributes({ latex: e.target.value })}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter" || e.key === "Escape") {
              e.preventDefault();
              setEditing(false);
            }
          }}
          onBlur={() => setEditing(false)}
          placeholder={labels.placeholder}
          contentEditable={false}
          className={`rounded border bg-muted/40 px-2 py-0.5 font-mono text-sm focus:outline-none ${
            display ? "w-full max-w-lg text-center" : "min-w-[6rem]"
          }`}
        />
      ) : (
        <span
          contentEditable={false}
          onClick={() => setEditing(true)}
          className="cursor-pointer"
          {...(latex
            ? { dangerouslySetInnerHTML: { __html: html } }
            : { children: <span className="text-muted-foreground">{labels.placeholder}</span> })}
        />
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
    return { labels: { placeholder: "LaTeX, e.g. E=mc^2" } };
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
          chain().focus().insertContent({ type: this.name, attrs: { latex } }).run(),
      insertMathBlock:
        (latex = "") =>
        ({ chain }) =>
          chain().focus().insertContent({ type: "mathBlock", attrs: { latex } }).run(),
    };
  },
});

export const MathBlock = Node.create<{ labels: MathLabels }>({
  name: "mathBlock",
  group: "block",
  atom: true,
  selectable: true,

  addOptions() {
    return { labels: { placeholder: "LaTeX, e.g. \\int_0^1 x\\,dx" } };
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
          chain().focus().insertContent({ type: this.name, attrs: { latex } }).run(),
      insertMathInline:
        (latex = "") =>
        ({ chain }) =>
          chain().focus().insertContent({ type: "mathInline", attrs: { latex } }).run(),
    };
  },
});
