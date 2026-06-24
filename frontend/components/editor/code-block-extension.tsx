"use client";
// Notion-style code block: syntax highlighting (lowlight/highlight.js) plus a
// header with a searchable language picker and a copy button. Built on
// CodeBlockLowlight — the base handles tokenisation/decorations; we only add the
// chrome via a React NodeView. Labels come through extension options (node views
// render outside the next-intl provider).
import { CodeBlockLowlight } from "@tiptap/extension-code-block-lowlight";
import {
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import { Check, ChevronDown, Copy } from "lucide-react";
import { common, createLowlight } from "lowlight";
import { useEffect, useMemo, useRef, useState } from "react";

export const lowlight = createLowlight(common);

/** One indent level (Tab / Shift-Tab inside a code block). */
const INDENT = "  ";

type CodeLabels = { searchPlaceholder: string; copy: string; copied: string };

// Pretty display names for the highlight.js ids; fall back to a capitalised id.
const LANG_LABELS: Record<string, string> = {
  plaintext: "Plain Text",
  javascript: "JavaScript",
  typescript: "TypeScript",
  jsx: "JSX",
  tsx: "TSX",
  csharp: "C#",
  cpp: "C++",
  c: "C",
  css: "CSS",
  scss: "SCSS",
  less: "Less",
  html: "HTML",
  xml: "XML",
  json: "JSON",
  yaml: "YAML",
  sql: "SQL",
  php: "PHP",
  bash: "Bash",
  shell: "Shell",
  go: "Go",
  rust: "Rust",
  python: "Python",
  ruby: "Ruby",
  java: "Java",
  kotlin: "Kotlin",
  swift: "Swift",
  markdown: "Markdown",
  graphql: "GraphQL",
  objectivec: "Objective-C",
  vbnet: "VB.NET",
  ini: "INI / TOML",
  perl: "Perl",
  lua: "Lua",
  r: "R",
  makefile: "Makefile",
  diff: "Diff",
  wasm: "WebAssembly",
  arduino: "Arduino",
};

function labelFor(id: string): string {
  return LANG_LABELS[id] ?? id.charAt(0).toUpperCase() + id.slice(1);
}

function CodeBlockView(props: NodeViewProps) {
  const { node, updateAttributes, extension } = props;
  const labels = extension.options.labels as CodeLabels;
  const lang = (node.attrs.language as string) || "plaintext";

  const languages = useMemo(() => {
    const all = (lowlight.listLanguages() as string[]).sort((a, b) =>
      labelFor(a).localeCompare(labelFor(b)),
    );
    return ["plaintext", ...all.filter((l) => l !== "plaintext")];
  }, []);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      requestAnimationFrame(() => searchRef.current?.focus());
    }
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return languages;
    return languages.filter(
      (l) => l.includes(q) || labelFor(l).toLowerCase().includes(q),
    );
  }, [languages, query]);

  const copy = () => {
    const done = () => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    };
    // navigator.clipboard is undefined in insecure contexts — guard, and fall
    // back to a hidden-textarea execCommand so copy still works (and never
    // throws ".then() of undefined").
    if (navigator.clipboard?.writeText) {
      navigator.clipboard
        .writeText(node.textContent)
        .then(done)
        .catch(() => {});
      return;
    }
    try {
      const ta = document.createElement("textarea");
      ta.value = node.textContent;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      done();
    } catch {
      /* clipboard unavailable — silently no-op */
    }
  };

  return (
    <NodeViewWrapper className="tiptap-codeblock group relative my-3">
      {/* Header: language picker + copy. Not part of the editable content. */}
      <div
        contentEditable={false}
        className="flex items-center justify-between rounded-t-lg border border-b-0 bg-muted/60 px-2 py-1"
      >
        <div className="relative">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            {labelFor(lang)}
            <ChevronDown className="h-3 w-3" />
          </button>
          {open && (
            <>
              <div
                className="fixed inset-0 z-40"
                onMouseDown={() => setOpen(false)}
              />
              <div className="absolute left-0 top-full z-50 mt-1 w-56 overflow-hidden rounded-lg border bg-popover shadow-md">
                <div className="p-1.5">
                  <input
                    ref={searchRef}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={labels.searchPlaceholder}
                    className="w-full rounded-md border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
                <div className="max-h-60 overflow-y-auto p-1 text-sm">
                  {filtered.map((l) => (
                    <button
                      key={l}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        updateAttributes({ language: l });
                        setOpen(false);
                      }}
                      className={`flex w-full items-center justify-between rounded-md px-2 py-1 text-left hover:bg-accent ${
                        l === lang ? "text-foreground" : "text-muted-foreground"
                      }`}
                    >
                      {labelFor(l)}
                      {l === lang && <Check className="h-3.5 w-3.5" />}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        <button
          type="button"
          onClick={copy}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus:opacity-100 group-hover:opacity-100"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
          {copied ? labels.copied : labels.copy}
        </button>
      </div>

      <pre className="tiptap-codeblock-pre m-0 rounded-b-lg rounded-t-none">
        <NodeViewContent
          as={"code" as "div"}
          className={`hljs language-${lang}`}
        />
      </pre>
    </NodeViewWrapper>
  );
}

export const CodeBlock = CodeBlockLowlight.extend<{ labels: CodeLabels }>({
  addOptions() {
    return {
      ...this.parent?.(),
      lowlight,
      defaultLanguage: "plaintext",
      labels: {
        searchPlaceholder: "Search language…",
        copy: "Copy",
        copied: "Copied",
      },
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockView);
  },

  // Inside a code block, Tab indents (and Shift-Tab outdents) like a real code
  // editor instead of escaping to the next block. Multi-line selections shift
  // every touched line.
  addKeyboardShortcuts() {
    const handleIndent = (outdent: boolean) => {
      const { editor, name } = this;
      if (!editor.isActive(name)) return false;
      const { state } = editor;
      const { from, to, empty } = state.selection;

      // Simple case: just insert indentation at the caret.
      if (!outdent && empty) {
        return editor.commands.insertContent(INDENT);
      }

      return editor
        .chain()
        .command(({ tr }) => {
          const $from = state.doc.resolve(from);
          const blockStart = $from.start();
          const text = $from.parent.textContent;
          const selStart = from - blockStart;
          const selEnd = to - blockStart;

          // Offsets of every line start within the block's text.
          const lineStarts = [0];
          for (let i = 0; i < text.length; i++) {
            if (text[i] === "\n") lineStarts.push(i + 1);
          }
          const touched = lineStarts.filter((ls, idx) => {
            const le =
              idx + 1 < lineStarts.length
                ? lineStarts[idx + 1] - 1
                : text.length;
            return ls <= selEnd && le >= selStart;
          });

          // Apply from the last line up so earlier positions stay valid.
          let changed = false;
          for (let i = touched.length - 1; i >= 0; i--) {
            const pos = blockStart + touched[i];
            if (outdent) {
              let n = 0;
              while (n < INDENT.length && text[touched[i] + n] === " ") n++;
              if (n === 0 && text[touched[i]] === "\t") n = 1;
              if (n > 0) {
                tr.delete(pos, pos + n);
                changed = true;
              }
            } else {
              tr.insertText(INDENT, pos);
              changed = true;
            }
          }
          return changed;
        })
        .run();
    };

    return {
      ...this.parent?.(),
      Tab: () => handleIndent(false),
      "Shift-Tab": () => handleIndent(true),
    };
  },
});
