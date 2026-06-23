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
    version: "4.9.0",
    date: "2026-06-23",
    changes: [
      { type: "feat" }, // 搜尋／取代（⌘F／工具列）：高亮全部＋當前、計數、大小寫、上下一個、取代/全部取代
      { type: "feat" }, // 即時字數統計（字/詞數，載入即正確）
      { type: "feat" }, // 鍵盤快捷鍵說明面板（⌘/Ctrl 依平台自適應）
    ],
  },
  {
    version: "4.8.0",
    date: "2026-06-23",
    changes: [
      { type: "feat" }, // 資料防護網：未儲存離開警告 + autosave 失敗指數退避自動重試（永不弄丟稿件）
      { type: "feat" }, // 版本歷史與還原：自動快照（保留20份）+ 手動命名版本 + 一鍵還原（還原前自動備份）
      { type: "feat" }, // 多分頁/裝置並發保護：衝突偵測 + 載入最新／保留覆蓋，本地內容存為「衝突備份」可還原
      { type: "fix" }, // content_json 大小上限（防爆庫）+ 側欄大綱標題 i18n 修正
    ],
  },
  {
    version: "4.7.0",
    date: "2026-06-22",
    changes: [
      { type: "feat" }, // 台灣論文 PDF/LaTeX 格式：標楷體+Times+14pt、第X章、章節式圖表編號、前置Roman→正文Arabic、3cm/1.5、參考文獻分組懸掛縮排
      { type: "feat" }, // 雙語封面頁（校名/系所/學位/中英題目/指導教授/研究生/日期，匯出面板填寫並記住）
      { type: "feat" }, // Word(DOCX) 對齊同套台灣格式（封面、頁碼分段、章節、圖表編號、參考文獻分組）
      { type: "feat" }, // 線上預覽依版型呈現：台灣論文版型預覽＝PDF 螢幕版
      { type: "fix" }, // 引用編號改 citeKey（Crossref/中文/未串接皆正確）、敘述式引用、參考文獻去重、長 DOI/URL 斷行
    ],
  },
  {
    version: "4.6.0",
    date: "2026-06-22",
    changes: [
      { type: "feat" }, // Crossref 加入搜尋來源（免費）：OpenAlex 為主、限流時自動退 Crossref，搜尋不再卡 429
      { type: "feat" }, // 中文論述查得到中文/台灣期刊（Crossref 用原文中文查、結果中文優先）
      { type: "fix" }, // 經典論文重複來源去重（標題+首作者、保留最高被引用）+ 無標題結果篩除
    ],
  },
  {
    version: "4.5.0",
    date: "2026-06-22",
    changes: [
      { type: "feat" }, // 純文字引用自動偵測（括號/多筆/敘述式/et al./中文分隔/網頁）＋未串接「待補來源」chip
      { type: "feat" }, // 補來源管道擴充：貼 DOI/連結（Crossref 免費）或手動填寫；參考文獻可編輯/刪除
      { type: "feat" }, // 自動書目節點 /參考文獻清單（即時更新、依格式、含網址）＋一鍵轉成文字
      { type: "fix" }, // OpenAlex 限流（429）友善提示＋自動重試；無對象時隱藏「更新連結」
      { type: "fix" }, // 編輯器找漏修復（程式碼複製、區塊把手、表格拖曳、面板捲軸/長網址換行、無障礙）
      { type: "perf" }, // 引用編號改快取（O(n²)→O(n)）、大綱/工具列重算降頻
    ],
  },
  {
    version: "4.4.0",
    date: "2026-06-21",
    changes: [
      { type: "feat" }, // Notion 風程式碼區塊（高亮/語言選單/複製/Tab 縮排）
      { type: "feat" }, // 區塊拖曳把手 ⠿（排序＋複製/刪除選單）
      { type: "feat" }, // 數學公式編輯改版（預覽放大＋內嵌輸入＋分隔符相容）
      { type: "fix" }, // Slash 指令：立即出現＋不殘留關鍵字
      { type: "fix" }, // 無標題圖/表不編號、不進目錄
      { type: "fix" }, // 側欄/互動細節（長文換行、drop 線殘留、bubble 誤觸）
    ],
  },
  {
    version: "4.3.0",
    date: "2026-06-11",
    changes: [
      { type: "feat" }, // 上傳稽核軌跡 + 後台頁
      { type: "feat" }, // 失敗即時 Email + 每日摘要
      { type: "fix" }, // 失敗保留原始檔可下載重現
    ],
  },
  {
    version: "4.2.1",
    date: "2026-06-11",
    changes: [
      { type: "fix" }, // SW 不再快取 /version：更新橫幅關不掉
    ],
  },
  {
    version: "4.2.0",
    date: "2026-06-11",
    changes: [
      { type: "feat" }, // 一鍵論文 PDF（後端 XeLaTeX）
      { type: "feat" }, // 台灣學位論文版型＋匯出版型全域化
      { type: "feat" }, // PWA：可安裝為平板 App
      { type: "fix" }, // LaTeX 匯出修穩（CJK／下載檔名）
      { type: "fix" }, // 超長論文分析失敗：EDU 分段＋截斷防禦
    ],
  },
  {
    version: "4.1.0",
    date: "2026-06-07",
    changes: [
      { type: "feat" }, // 引用紅綠燈驗證
      { type: "feat" }, // 缺陷檢查前移
      { type: "feat" }, // 語意 rerank + 相似度可視化
      { type: "feat" }, // 全文句級接地
    ],
  },
  {
    version: "4.0.0",
    date: "2026-06-06",
    changes: [
      { type: "feat" }, // 寫作編輯器模式
      { type: "feat" }, // autocomplete
      { type: "feat" }, // 改寫選單
      { type: "feat" }, // 大綱生成
      { type: "feat" }, // Smart Citation
      { type: "feat" }, // 多引用格式
      { type: "feat" }, // 匯出 DOCX/LaTeX/HTML
      { type: "feat" }, // slash + markdown
      { type: "feat" }, // 圖片+圖目錄 / 數學
      { type: "feat" }, // 表格+表目錄+工具列
      { type: "fix" }, // 品質修正合集
    ],
  },
  {
    version: "3.8.0",
    date: "2026-05-31",
    changes: [
      { type: "feat" },
      { type: "feat" },
      { type: "feat" },
      { type: "fix" },
    ],
  },
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
