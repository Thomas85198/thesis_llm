/**
 * editor-store 自動儲存核心邏輯測試（docs/TODO.md E5——v4.17 後最易
 * regression 的區域）：debounce、部分 PUT、跨文件汙染防護（E1/B6 的
 * 回歸鎖）、409 衝突暫停、失敗退避重試。
 *
 * updateDocument/snapshotDocument 一律 mock；用 fake timers 驅動 debounce。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/api")>();
  return {
    ...actual,
    updateDocument: vi.fn(),
    snapshotDocument: vi.fn().mockResolvedValue(undefined),
  };
});

import {
  snapshotDocument,
  updateDocument,
  DocumentConflictError,
} from "@/lib/api";
import { useEditorStore } from "./editor-store";

const mockUpdate = vi.mocked(updateDocument);
const mockSnapshot = vi.mocked(snapshotDocument);
const DEBOUNCE = 1200;

/** 讓 microtask（save chain 的 promise 鏈）有機會跑完。 */
async function flush() {
  await vi.advanceTimersByTimeAsync(0);
}

beforeEach(() => {
  vi.useFakeTimers();
  mockUpdate.mockReset();
  mockSnapshot.mockClear();
  mockUpdate.mockResolvedValue({ updated_at: "2026-07-14T00:00:00Z" } as never);
  useEditorStore.getState().reset();
  useEditorStore.getState().init("doc:A", "標題A", "2026-07-13T00:00:00Z");
});

afterEach(() => {
  useEditorStore.getState().reset();
  vi.useRealTimers();
});

describe("debounced autosave", () => {
  it("coalesces rapid keystrokes into one PUT with the latest content", async () => {
    const s = useEditorStore.getState();
    s.queueContentSave({ type: "doc", v: 1 } as never);
    await vi.advanceTimersByTimeAsync(300);
    s.queueContentSave({ type: "doc", v: 2 } as never);
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const [docId, body] = mockUpdate.mock.calls[0];
    expect(docId).toBe("doc:A");
    expect(body.content_json).toEqual({ type: "doc", v: 2 });
    expect(body.title).toBeUndefined(); // content-only 部分 PUT
    expect(useEditorStore.getState().saveState).toBe("saved");
    expect(useEditorStore.getState().dirty).toBe(false);
  });

  it("title and content debounce independently (partial PUTs)", async () => {
    const s = useEditorStore.getState();
    s.setTitle("新標題");
    s.queueContentSave({ type: "doc" } as never);
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    expect(mockUpdate).toHaveBeenCalledTimes(2);
    const bodies = mockUpdate.mock.calls.map(([, b]) => b);
    expect(bodies.some((b) => b.title === "新標題" && !b.content_json)).toBe(
      true,
    );
    expect(bodies.some((b) => b.content_json && !b.title)).toBe(true);
  });

  it("carries the optimistic-concurrency token and refreshes it", async () => {
    const s = useEditorStore.getState();
    s.queueContentSave({ type: "doc" } as never);
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    expect(mockUpdate.mock.calls[0][1].expected_updated_at).toBe(
      "2026-07-13T00:00:00Z",
    );
    s.queueContentSave({ type: "doc", v: 2 } as never);
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    expect(mockUpdate.mock.calls[1][1].expected_updated_at).toBe(
      "2026-07-14T00:00:00Z", // 上一次成功回傳的 updated_at
    );
  });
});

describe("跨文件汙染防護（B6 回歸鎖）", () => {
  it("switching documents cancels the pending debounce entirely", async () => {
    const s = useEditorStore.getState();
    s.queueContentSave({ type: "doc", from: "A" } as never);
    s.init("doc:B", "標題B"); // debounce 未到期就切換文件
    await vi.advanceTimersByTimeAsync(DEBOUNCE * 2);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("a chained save that runs after the switch is dropped, not written into the new doc", async () => {
    const s = useEditorStore.getState();
    // 第一個 save 卡住（模擬慢網路），第二個排進 chain
    let releaseFirst!: () => void;
    mockUpdate.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseFirst = () =>
            resolve({ updated_at: "2026-07-14T00:00:01Z" } as never);
        }),
    );
    s.setTitle("A的標題");
    s.queueContentSave({ type: "doc", from: "A" } as never);
    await vi.advanceTimersByTimeAsync(DEBOUNCE); // 兩個 save 依序進 chain，第一個開始執行
    useEditorStore.getState().init("doc:B", "標題B"); // 第一個還沒回來就切文件
    releaseFirst();
    await flush();
    // 只有第一個 PUT 打出去（對 doc:A）；chain 裡第二個因 docId 不符被丟棄
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate.mock.calls[0][0]).toBe("doc:A");
  });
});

describe("409 衝突", () => {
  it("pauses autosave until markSynced", async () => {
    const s = useEditorStore.getState();
    mockUpdate.mockRejectedValueOnce(
      new DocumentConflictError("2026-07-15T00:00:00Z"),
    );
    s.queueContentSave({ type: "doc" } as never);
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    expect(useEditorStore.getState().conflict).toBe(true);
    expect(useEditorStore.getState().saveState).toBe("error");

    // 衝突未解時，後續 autosave 一律不打 API
    s.queueContentSave({ type: "doc", v: 2 } as never);
    await vi.advanceTimersByTimeAsync(DEBOUNCE * 2);
    expect(mockUpdate).toHaveBeenCalledTimes(1);

    // 解衝突後恢復
    useEditorStore.getState().markSynced("2026-07-15T00:00:00Z");
    expect(useEditorStore.getState().conflict).toBe(false);
    s.queueContentSave({ type: "doc", v: 3 } as never);
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    expect(mockUpdate).toHaveBeenCalledTimes(2);
    expect(mockUpdate.mock.calls[1][1].expected_updated_at).toBe(
      "2026-07-15T00:00:00Z",
    );
  });
});

describe("失敗退避重試", () => {
  it("retries after backoff and lands the pending fields", async () => {
    const s = useEditorStore.getState();
    mockUpdate.mockRejectedValueOnce(new Error("network down"));
    s.queueContentSave({ type: "doc", v: 1 } as never);
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    expect(useEditorStore.getState().saveState).toBe("retrying");
    expect(useEditorStore.getState().dirty).toBe(true);

    await vi.advanceTimersByTimeAsync(2000); // RETRY_DELAYS_MS[0]
    await flush();
    expect(mockUpdate).toHaveBeenCalledTimes(2);
    expect(mockUpdate.mock.calls[1][1].content_json).toEqual({
      type: "doc",
      v: 1,
    });
    expect(useEditorStore.getState().saveState).toBe("saved");
    expect(useEditorStore.getState().dirty).toBe(false);
  });

  it("retryNow flushes the pending save immediately", async () => {
    const s = useEditorStore.getState();
    mockUpdate.mockRejectedValueOnce(new Error("boom"));
    s.queueContentSave({ type: "doc" } as never);
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    useEditorStore.getState().retryNow();
    await flush();
    expect(mockUpdate).toHaveBeenCalledTimes(2);
  });
});
