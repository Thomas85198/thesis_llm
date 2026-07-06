/**
 * Contract tests for the api.ts fetch wrapper (docs/TODO.md E5 — first
 * frontend tests; cheapest place to catch backend-contract drift).
 *
 * fetch is stubbed per-test; nothing touches the network.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  apiBase,
  deletePaper,
  fetchJob,
  fetchPaperResult,
  pdfUrl,
  pickLocalized,
  submitJudgment,
  uploadPaper,
} from "./api";

function stubFetch(status: number, body: unknown): ReturnType<typeof vi.fn> {
  const fn = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    json: async () => body,
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("pickLocalized", () => {
  it("讀取指定 locale", () => {
    expect(pickLocalized({ "zh-Hant": "中", en: "EN" }, "en")).toBe("EN");
  });

  it("locale 缺頁時退回 zh-Hant", () => {
    expect(pickLocalized({ "zh-Hant": "中" }, "en")).toBe("中");
  });

  it("zh-Hant 也沒有時退回任意值", () => {
    expect(pickLocalized({ ja: "日" }, "en")).toBe("日");
  });

  it("容忍 legacy 純字串", () => {
    expect(pickLocalized("legacy", "en")).toBe("legacy");
  });

  it("null/undefined 回空字串", () => {
    expect(pickLocalized(null, "en")).toBe("");
    expect(pickLocalized(undefined, "en")).toBe("");
  });
});

describe("GET wrapper contract", () => {
  it("組出正確路徑並帶 no-store", async () => {
    const fetchMock = stubFetch(200, { status: "done" });

    await fetchJob("job:123");

    expect(fetchMock).toHaveBeenCalledWith(`${apiBase}/api/jobs/job%3A123`, {
      cache: "no-store",
    });
  });

  it("paper id 的冒號會被 encodeURIComponent", async () => {
    const fetchMock = stubFetch(200, {});

    await fetchPaperResult("paper:abc123");

    expect(fetchMock.mock.calls[0][0]).toBe(
      `${apiBase}/api/papers/paper%3Aabc123/result`,
    );
  });

  it("非 2xx 時丟出含 status 與回應內文的錯誤", async () => {
    stubFetch(404, "paper not found");

    await expect(fetchJob("job:x")).rejects.toThrow(/404.*paper not found/);
  });
});

describe("uploadPaper", () => {
  it("以 multipart 送出 file 與可選 title", async () => {
    const fetchMock = stubFetch(200, { job_id: "j", paper_id: "p" });
    const file = new File(["內容"], "t.pdf", { type: "application/pdf" });

    await uploadPaper(file, "我的標題");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${apiBase}/api/upload`);
    expect(init.method).toBe("POST");
    const fd = init.body as FormData;
    expect(fd.get("file")).toBe(file);
    expect(fd.get("title")).toBe("我的標題");
  });

  it("未給 title 時不送 title 欄位", async () => {
    const fetchMock = stubFetch(200, { job_id: "j", paper_id: "p" });

    await uploadPaper(new File(["x"], "t.pdf"));

    const fd = fetchMock.mock.calls[0][1].body as FormData;
    expect(fd.get("title")).toBeNull();
  });

  it("失敗時錯誤帶後端內文", async () => {
    stubFetch(413, "file too large");

    await expect(uploadPaper(new File(["x"], "t.pdf"))).rejects.toThrow(
      /file too large/,
    );
  });
});

describe("寫入類呼叫", () => {
  it("deletePaper 用 DELETE 打對路徑", async () => {
    const fetchMock = stubFetch(200, {});

    await deletePaper("paper:doomed");

    expect(fetchMock).toHaveBeenCalledWith(
      `${apiBase}/api/papers/paper%3Adoomed`,
      { method: "DELETE" },
    );
  });

  it("submitJudgment POST JSON body", async () => {
    const fetchMock = stubFetch(200, {});

    await submitJudgment("paper:p1", {
      defect_id: "d1",
      rule_id: "REL-01",
      verdict: "correct",
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${apiBase}/api/papers/paper%3Ap1/judgments`);
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body)).toEqual({
      defect_id: "d1",
      rule_id: "REL-01",
      verdict: "correct",
    });
  });
});

describe("pdfUrl", () => {
  it("回傳完整可用的 URL（含 encode）", () => {
    expect(pdfUrl("paper:p1")).toBe(`${apiBase}/api/papers/paper%3Ap1/pdf`);
  });
});
