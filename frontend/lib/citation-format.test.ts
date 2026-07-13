/**
 * citation-format.ts 純函式測試（docs/TODO.md E5）——六種引用格式的
 * in-text 標記與參考文獻條目是前後端共用邏輯（後端 export_doc.py 鏡像
 * 這份），格式回歸會同時毀掉 chip 顯示與四種匯出格式。
 */
import { describe, expect, it } from "vitest";

import {
  citeKey,
  doiUrl,
  fullReference,
  inTextLabel,
  isNumberedStyle,
  referenceHref,
  referenceLinks,
  type CitationAttrs,
} from "./citation-format";

const BASE: CitationAttrs = {
  openalexId: "W123",
  authors: "Ashish Vaswani, Noam Shazeer, Niki Parmar",
  year: 2017,
  title: "Attention Is All You Need",
  venue: "NeurIPS",
  doi: "10.5555/3295222",
  oaUrl: "https://arxiv.org/abs/1706.03762",
  url: "https://arxiv.org/abs/1706.03762",
};

describe("citeKey", () => {
  it("prefers the OpenAlex id", () => {
    expect(citeKey(BASE)).toBe("W123");
  });
  it("falls back to normalized authors|year for unlinked chips", () => {
    expect(citeKey({ ...BASE, openalexId: "", authors: "  Lin,  C. " })).toBe(
      "lin, c.|2017",
    );
  });
});

describe("doiUrl / referenceHref / referenceLinks", () => {
  it("normalizes a bare DOI to an absolute https://doi.org link", () => {
    expect(doiUrl("10.1000/xyz")).toBe("https://doi.org/10.1000/xyz");
    expect(doiUrl("doi: 10.1000/xyz")).toBe("https://doi.org/10.1000/xyz");
    expect(doiUrl("https://doi.org/10.1/a")).toBe("https://doi.org/10.1/a");
    expect(doiUrl("")).toBe("");
  });
  it("referenceHref prefers url, falls back to DOI", () => {
    expect(referenceHref(BASE)).toBe(BASE.url);
    expect(referenceHref({ ...BASE, url: "" })).toBe(
      "https://doi.org/10.5555/3295222",
    );
  });
  it("referenceLinks pairs fulltext with DOI, falls back to source", () => {
    expect(referenceLinks(BASE).map((l) => l.kind)).toEqual([
      "fulltext",
      "doi",
    ]);
    expect(
      referenceLinks({ ...BASE, oaUrl: "", doi: "" }).map((l) => l.kind),
    ).toEqual(["source"]);
    expect(referenceLinks({ ...BASE, oaUrl: "", doi: "", url: "" })).toEqual(
      [],
    );
  });
});

describe("inTextLabel", () => {
  it("author–year styles: 1 / 2 / 3+ authors", () => {
    expect(inTextLabel({ ...BASE, authors: "Ashish Vaswani" }, "apa", 1)).toBe(
      "(Vaswani, 2017)",
    );
    expect(
      inTextLabel(
        { ...BASE, authors: "Ashish Vaswani, Noam Shazeer" },
        "apa",
        1,
      ),
    ).toBe("(Vaswani & Shazeer, 2017)");
    expect(inTextLabel(BASE, "apa", 1)).toBe("(Vaswani et al., 2017)");
  });
  it("per-style shapes", () => {
    expect(inTextLabel(BASE, "mla", 1)).toBe("(Vaswani et al.)");
    expect(inTextLabel(BASE, "chicago", 1)).toBe("(Vaswani et al. 2017)");
    expect(inTextLabel(BASE, "harvard", 1)).toBe("(Vaswani et al., 2017)");
    expect(inTextLabel(BASE, "ieee", 3)).toBe("[3]");
    expect(inTextLabel(BASE, "numeric", 7)).toBe("[7]");
  });
  it("narrative citations keep the author in prose", () => {
    const n = { ...BASE, narrative: true };
    expect(inTextLabel(n, "apa", 1)).toBe("Vaswani et al. (2017)");
    expect(inTextLabel(n, "ieee", 2)).toBe("Vaswani et al. [2]");
    expect(inTextLabel(n, "mla", 1)).toBe("Vaswani et al.");
  });
  it("missing year renders n.d.; empty authors renders Anon.", () => {
    expect(inTextLabel({ ...BASE, year: null }, "apa", 1)).toBe(
      "(Vaswani et al., n.d.)",
    );
    expect(inTextLabel({ ...BASE, authors: "" }, "apa", 1)).toBe(
      "(Anon., 2017)",
    );
  });
});

describe("fullReference", () => {
  it("numbered styles carry the [n] prefix", () => {
    expect(fullReference(BASE, "ieee", 4)).toMatch(/^\[4\] /);
    expect(fullReference(BASE, "numeric", 9)).toMatch(/^\[9\] /);
  });
  it("apa shape", () => {
    expect(fullReference(BASE, "apa", 1)).toBe(
      "Ashish Vaswani, Noam Shazeer, Niki Parmar (2017). " +
        "Attention Is All You Need. NeurIPS.",
    );
  });
  it("web source (url, no doi) appends the link", () => {
    const web = { ...BASE, doi: "", url: "https://example.com/report" };
    expect(fullReference(web, "apa", 1)).toContain(
      " https://example.com/report",
    );
  });
  it("isNumberedStyle only for ieee/numeric", () => {
    expect(isNumberedStyle("ieee")).toBe(true);
    expect(isNumberedStyle("numeric")).toBe(true);
    expect(isNumberedStyle("apa")).toBe(false);
  });
});
