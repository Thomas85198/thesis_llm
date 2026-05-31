// Single source of truth for the app version + changelog.
//
// 版本號規則（三碼語意化版本 MAJOR.MINOR.PATCH）:
//   MAJOR — 架構性大改 / 不相容的破壞性變更（例如換掉 KG schema、改 API 合約）
//   MINOR — 新增功能，向後相容（例如新增 OCR 容錯、新增頁面）
//   PATCH — bug 修復 / 小調整，不改變對外行為（例如修偵測閾值、調文案）
//
// 改版流程：每次發版時，把 CURRENT_VERSION 往上加，並在 VERSION_LOG 最前面
// 新增一筆 VersionEntry。site-header 的版本徽章與 changelog 頁都讀這支檔，
// 不要在別處再硬寫版本字串。
//
// i18n 注意：使用者可見的文字（每筆版本的 title / summary、各 change 的 text、
// CHANGE_TYPE_META 的 label）都已搬到 messages/pages/changelog.<locale>.json，
// 由 changelog 頁透過 useTranslations("changelog") 依 version + 索引取出。
// 這支檔只保留「結構」（version / date / 每筆 change 的 type）與顏色 className。

export type ChangeType = "feat" | "fix" | "perf" | "docs" | "chore";

export interface ChangeEntry {
  type: ChangeType;
}

export interface VersionEntry {
  version: string; // "3.1.0"
  date: string; // ISO date "2026-05-20"，基線版本可留空字串
  changes: ChangeEntry[];
}

// 顏色 className 留在這裡；label 由頁面從 t("changeType.<type>") 取。
export const CHANGE_TYPE_META: Record<ChangeType, { className: string }> = {
  feat: { className: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  fix: { className: "bg-amber-100 text-amber-700 border-amber-200" },
  perf: { className: "bg-sky-100 text-sky-700 border-sky-200" },
  docs: { className: "bg-violet-100 text-violet-700 border-violet-200" },
  chore: { className: "bg-slate-100 text-slate-600 border-slate-200" },
};

// 最新版本放最前面。
export const VERSION_LOG: VersionEntry[] = [
  {
    version: "3.7.0",
    date: "2026-05-31",
    changes: [
      { type: "feat" },
      { type: "feat" },
      { type: "feat" },
      { type: "feat" },
      { type: "feat" },
      { type: "feat" },
      { type: "fix" },
    ],
  },
  {
    version: "3.6.0",
    date: "2026-05-30",
    changes: [
      { type: "feat" },
      { type: "feat" },
      { type: "feat" },
      { type: "chore" },
    ],
  },
  {
    version: "3.5.0",
    date: "2026-05-30",
    changes: [{ type: "feat" }, { type: "feat" }, { type: "docs" }],
  },
  {
    version: "3.4.0",
    date: "2026-05-25",
    changes: [{ type: "feat" }, { type: "feat" }],
  },
  {
    version: "3.3.0",
    date: "2026-05-25",
    changes: [{ type: "perf" }, { type: "perf" }, { type: "chore" }],
  },
  {
    version: "3.2.0",
    date: "2026-05-20",
    changes: [{ type: "feat" }, { type: "feat" }],
  },
  {
    version: "3.1.0",
    date: "2026-05-20",
    changes: [
      { type: "feat" },
      { type: "feat" },
      { type: "feat" },
      { type: "feat" },
      { type: "fix" },
      { type: "chore" },
    ],
  },
  {
    version: "3.0.0",
    date: "2026-05-09",
    changes: [
      { type: "feat" },
      { type: "feat" },
      { type: "feat" },
      { type: "feat" },
    ],
  },
];

// 對外顯示的目前版本，恆等於 VERSION_LOG 最新一筆。
export const CURRENT_VERSION = VERSION_LOG[0].version;
