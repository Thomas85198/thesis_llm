/**
 * lint.ts 規則式文法檢查測試（docs/TODO.md E5）——用最小 ProseMirror
 * schema 造文件，驗證三條規則的偵測位置與修正內容（位置錯了「一鍵修正」
 * 會改到錯的字）。
 */
import { Schema } from "@tiptap/pm/model";
import { describe, expect, it } from "vitest";

import { lintDoc, type LintIssue } from "./lint";

const schema = new Schema({
  nodes: {
    doc: { content: "paragraph+" },
    paragraph: { content: "text*" },
    text: {},
  },
});

function docOf(...paras: string[]) {
  return schema.node(
    "doc",
    null,
    paras.map((t) => schema.node("paragraph", null, t ? [schema.text(t)] : [])),
  );
}

function apply(text: string, issue: LintIssue, docStart = 1): string {
  // paragraph 內容從 pos 1 開始；把 issue 範圍換成 replacement 驗證修正正確
  const from = issue.from - docStart;
  const to = issue.to - docStart;
  return text.slice(0, from) + issue.replacement + text.slice(to);
}

describe("halfPunct（半形標點貼著中文）", () => {
  it("detects and fixes , ; : ! ? ( ) next to CJK", () => {
    const text = "結果,顯示";
    const issues = lintDoc(docOf(text));
    expect(issues).toHaveLength(1);
    expect(issues[0].type).toBe("halfPunct");
    expect(apply(text, issues[0])).toBe("結果，顯示");
  });
  it("leaves half-width punctuation inside pure Latin alone", () => {
    expect(lintDoc(docOf("see Smith, 2020 (p. 3)"))).toHaveLength(0);
  });
});

describe("pangu（中英之間補空格）", () => {
  it("flags CJK-Latin adjacency in both orders", () => {
    const text = "使用LLM分析";
    const issues = lintDoc(docOf(text)).filter((i) => i.type === "pangu");
    expect(issues).toHaveLength(2); // 用L 與 M分
    expect(apply(text, issues[0])).toBe("使用 LLM分析");
  });
  it("already-spaced text is clean", () => {
    expect(lintDoc(docOf("使用 LLM 分析"))).toHaveLength(0);
  });
});

describe("spaceBeforePunct（全形標點前空白）", () => {
  it("drops spaces before full-width punctuation", () => {
    const text = "完成了 。";
    const issues = lintDoc(docOf(text));
    expect(issues).toHaveLength(1);
    expect(issues[0].type).toBe("spaceBeforePunct");
    expect(apply(text, issues[0])).toBe("完成了。");
  });
});

describe("lintDoc 位置與去重", () => {
  it("positions are doc-absolute across multiple paragraphs", () => {
    const doc = docOf("好的", "結果,顯示");
    const issues = lintDoc(doc);
    expect(issues).toHaveLength(1);
    // 第二段起點 = 1(第一段開) + 2(字) + 1(關) + 1(第二段開) = 5
    expect(issues[0].from).toBe(5 + 2);
    expect(doc.textBetween(issues[0].from, issues[0].to)).toBe(",");
  });
  it("overlapping issues keep the earlier one", () => {
    const issues = lintDoc(docOf("中A中"));
    // 兩個 pangu 候選重疊（中A / A中），去重後不重疊
    for (let i = 1; i < issues.length; i++) {
      expect(issues[i].from).toBeGreaterThanOrEqual(issues[i - 1].to);
    }
  });
});
