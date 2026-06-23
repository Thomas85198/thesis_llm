// Rule-based Chinese academic-writing lint — objective, deterministic, no LLM /
// token cost. Walks a ProseMirror doc and returns issues with their positions
// and a concrete fix (so the panel can apply it). High precision on purpose:
// only flags things that are almost always wrong in a 中文 thesis.
import type { Node as PMNode } from "@tiptap/pm/model";

export type LintType = "halfPunct" | "pangu" | "spaceBeforePunct";

export type LintIssue = {
  from: number;
  to: number;
  type: LintType;
  original: string;
  replacement: string;
};

const RE_CJK = /[㐀-䶿一-鿿]/;
const isCJK = (ch: string | undefined) => !!ch && RE_CJK.test(ch);

// Half-width punctuation → its full-width Chinese counterpart.
const FULLWIDTH: Record<string, string> = {
  ",": "，",
  ";": "；",
  ":": "：",
  "!": "！",
  "?": "？",
  "(": "（",
  ")": "）",
};

// CJK directly adjacent to a Latin letter (either order) with no space.
const RE_PANGU = /[㐀-䶿一-鿿][A-Za-z]|[A-Za-z][㐀-䶿一-鿿]/g;
// One or more spaces right before a full-width closing / sentence punctuation.
const RE_SPACE_BEFORE_PUNCT = / +(?=[，。、；：！？）」』】])/g;

function scanText(text: string, base: number, out: LintIssue[]): void {
  // 1) Half-width punctuation sitting next to CJK → should be full-width.
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const full = FULLWIDTH[ch];
    if (full && (isCJK(text[i - 1]) || isCJK(text[i + 1]))) {
      out.push({
        from: base + i,
        to: base + i + 1,
        type: "halfPunct",
        original: ch,
        replacement: full,
      });
    }
  }
  // 2) Missing space between CJK and Latin letters (盤古之白).
  let m: RegExpExecArray | null;
  RE_PANGU.lastIndex = 0;
  while ((m = RE_PANGU.exec(text))) {
    const pair = m[0];
    out.push({
      from: base + m.index,
      to: base + m.index + 2,
      type: "pangu",
      original: pair,
      replacement: `${pair[0]} ${pair[1]}`,
    });
    RE_PANGU.lastIndex = m.index + 1; // allow overlapping (中A中)
  }
  // 3) Space(s) before a full-width punctuation → drop them.
  RE_SPACE_BEFORE_PUNCT.lastIndex = 0;
  while ((m = RE_SPACE_BEFORE_PUNCT.exec(text))) {
    out.push({
      from: base + m.index,
      to: base + m.index + m[0].length,
      type: "spaceBeforePunct",
      original: m[0],
      replacement: "",
    });
  }
}

export function lintDoc(doc: PMNode): LintIssue[] {
  const out: LintIssue[] = [];
  doc.descendants((node, pos) => {
    if (node.isText && node.text) scanText(node.text, pos, out);
    return true;
  });
  // Stable order by position; drop overlaps (keep the earlier/higher-precision one).
  out.sort((a, b) => a.from - b.from || a.to - b.to);
  const deduped: LintIssue[] = [];
  let lastTo = -1;
  for (const issue of out) {
    if (issue.from >= lastTo) {
      deduped.push(issue);
      lastTo = issue.to;
    }
  }
  return deduped;
}
