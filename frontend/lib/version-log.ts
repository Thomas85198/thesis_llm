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

export type ChangeType = "feat" | "fix" | "perf" | "docs" | "chore";

export interface ChangeEntry {
  type: ChangeType;
  text: string;
}

export interface VersionEntry {
  version: string; // "3.1.0"
  date: string; // ISO date "2026-05-20"，基線版本可留空字串
  title: string;
  summary?: string;
  changes: ChangeEntry[];
}

export const CHANGE_TYPE_META: Record<
  ChangeType,
  { label: string; className: string }
> = {
  feat: { label: "新功能", className: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  fix: { label: "修復", className: "bg-amber-100 text-amber-700 border-amber-200" },
  perf: { label: "效能", className: "bg-sky-100 text-sky-700 border-sky-200" },
  docs: { label: "文件", className: "bg-violet-100 text-violet-700 border-violet-200" },
  chore: { label: "雜項", className: "bg-slate-100 text-slate-600 border-slate-200" },
};

// 最新版本放最前面。
export const VERSION_LOG: VersionEntry[] = [
  {
    version: "3.2.0",
    date: "2026-05-20",
    title: "新版本自動偵測與更新提示",
    summary:
      "已開啟的分頁若停留在舊版前端，會自動偵測到新版部署並跳出更新橫幅，避免使用者一直用到舊版。",
    changes: [
      {
        type: "feat",
        text: "新增 /version 端點與前端版本 watcher：以 bundle 內建版本比對伺服器當前部署版本，偵測到不一致時於畫面底部顯示不可關閉的更新橫幅，使用者點「立即更新」即重新整理。",
      },
      {
        type: "feat",
        text: "版本檢查時機：分頁重新聚焦（focus / visibilitychange）時立即檢查，平常每 60 秒輪詢一次。",
      },
    ],
  },
  {
    version: "3.1.0",
    date: "2026-05-20",
    title: "PDF OCR 容錯與版本紀錄頁",
    summary:
      "解決部分 LaTeX 論文（無 ToUnicode CMap 的 Type 3 字型）複製出來是亂碼、導致 LLM 抽取失敗的問題。",
    changes: [
      {
        type: "feat",
        text: "新增 PDF 亂碼偵測 + tesseract OCR fallback（chi_tra + eng）：原生抽取若偵測到 glyph-cipher 亂碼，自動改用 OCR 還原文字，並保留每段文字的頁碼與 bbox 座標。",
      },
      {
        type: "feat",
        text: "PDF 文字抽取移至背景任務，OCR（30 頁約 3–5 分鐘）不再阻塞上傳的 HTTP 請求。",
      },
      {
        type: "feat",
        text: "處理進度新增即時提示：「PDF 解析中…」→ 偵測到亂碼時切換為「PDF 字型無法直接讀取，改用 OCR 辨識中（約需 3-5 分鐘）」。",
      },
      {
        type: "feat",
        text: "新增「版本紀錄」頁面，定義三碼語意化版本號規則。",
      },
      {
        type: "fix",
        text: "修正 garble 偵測閾值：原本「真字元比例 + 噪音比例」雙條件會漏判置換式亂碼（字母被位移成其他字母，字母比例仍高），改為單看 backtick/asterisk 等噪音字元比例 > 3%。",
      },
      {
        type: "chore",
        text: "backend Docker image 加裝 tesseract-ocr 與 chi-tra / chi-sim / eng 語言包，並設定 TESSDATA_PREFIX。",
      },
    ],
  },
  {
    version: "3.0.0",
    date: "2026-05-09",
    title: "系統基線：Knowledge Graph + LLM 論文檢核",
    summary:
      "以 EDU/Entity/RST/FRU 四層結構 + Neo4j KG + 13 條 REL 規則自動找學術論文的結構性缺陷。",
    changes: [
      {
        type: "feat",
        text: "論文抽取 EDU / Entity / RST / FRU 四層結構並寫入 Neo4j Knowledge Graph。",
      },
      {
        type: "feat",
        text: "13 條 REL 規則檢核（Cypher 找候選 + LLM 判讀），輸出邏輯缺陷與修改建議。",
      },
      {
        type: "feat",
        text: "Human-as-judge 標註介面（per-defect correct/wrong/partial）+ Phase 2 few-shot 回饋迴路。",
      },
      {
        type: "feat",
        text: "KG 視覺化、規則統計、PDF 原文對位檢視、SQLite 持久化與 token/成本紀錄。",
      },
    ],
  },
];

// 對外顯示的目前版本，恆等於 VERSION_LOG 最新一筆。
export const CURRENT_VERSION = VERSION_LOG[0].version;
