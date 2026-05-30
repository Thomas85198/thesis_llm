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
    version: "3.7.0",
    date: "2026-05-31",
    title: "介面專業化與分析等待體驗：全域任務追蹤、行動優先、各頁一致",
    summary:
      "整體介面收斂得更專業：header 只留 logo＋版本、隱藏報告用的系統說明、去除贅字與裝飾性 emoji，並用共用 PageHeader 讓每頁標題同高同格式。上傳頁改為行動優先的單欄聚焦設計（拖放上傳、大按鈕、手機漢堡選單），把規則說明移到規則統計頁。長時間分析新增全域任務追蹤：切頁籤不再丟失進度、完成跳瀏覽器通知＋分頁標題閃爍＋header pill，離開上傳頁會先確認。KG 缺陷卡也補上人類評分機制。",
    changes: [
      {
        type: "feat",
        text: "介面專業化：header 改為 logo＋版本徽章（移除文字 wordmark），nav 隱藏「系統說明」（/about 仍可直達），about/changelog 等頁去除裝飾性 emoji 與過量灰字、放大字級，整體視覺更收斂。",
      },
      {
        type: "feat",
        text: "上傳頁行動優先改版：改為單欄聚焦的拖放上傳卡、加大按鈕與點擊區、修正大片空白；新增 <sm 的手機漢堡選單。原本的「13 條 REL 規則」說明面板移到規則統計頁，讓上傳畫面保持乾淨。",
      },
      {
        type: "feat",
        text: "分析任務全域追蹤：上傳後輪詢與進度提升為全域 Context，切頁籤／重整不再丟失進度；分析完成觸發瀏覽器通知（安全內容下）＋分頁標題閃爍＋header「分析完成」pill，使用者可離開去做別的事再回來。",
      },
      {
        type: "feat",
        text: "導覽守衛與偏好持久化：分析進行中離開上傳頁會先 confirm（已在其他頁則不再打擾）、關閉分頁有 beforeunload 警告；完成 pill 數分鐘未操作自動關閉；通知偏好存於瀏覽器。",
      },
      {
        type: "feat",
        text: "各頁標題一致：新增共用 PageHeader 元件，統一所有頁面標題的高度、字級與排版格式。",
      },
      {
        type: "feat",
        text: "KG 缺陷卡加人類評分：知識圖譜 FRU 層「涉及此段落的缺陷」卡片補上判對／部分對／誤判標註，與結果頁共用同一套 judgment API 與統計。",
      },
      {
        type: "fix",
        text: "修正完成通知無限重跳（輪詢未在完成後停止）、導覽守衛在非上傳頁誤觸發；PDF 無法解析時改為優雅降級卡片（可重新載入／下載原始檔），不再顯示裸紅錯誤。",
      },
    ],
  },
  {
    version: "3.6.0",
    date: "2026-05-30",
    title: "知識圖譜頁大改版：章節分組卡片、缺陷連動、原文就地定位",
    summary:
      "Entity 與 FRU 兩層從力導向圖改為依章節分組的卡片視圖，點選可在右側焦點面板看細節；焦點面板裡的任一原始句子都能就地開右側抽屜跳到 PDF 對應位置並 highlight，不離開圖譜頁。同步移除介面殘留的「v3」字樣、換上簡約的新 app icon。",
    changes: [
      {
        type: "feat",
        text: "Entity 層：力導向圖改為依章節（Abstract→…→未分類）分組的可收合卡片並支援型別篩選；點實體在焦點面板顯示 1-hop 關係小圖（incoming｜實體｜outgoing）與證據句。無關係的實體以名稱比對 EDU 全文補上代表章節（未分類由 83→5）。",
      },
      {
        type: "feat",
        text: "FRU 層：序列流程圖改為依章節分組卡片 + function 篩選；點 FRU 顯示 summary、涵蓋的 EDU 原文、以及涉及此段落的缺陷（以 fru.edu_ids ∩ defect.evidence_edu_ids 連動）。",
      },
      {
        type: "feat",
        text: "原文就地定位：焦點面板每個原始句子旁新增定位鈕，點擊在同頁右側寬抽屜內嵌 PDF、自動捲到該句所在頁並 highlight，不再跳離圖譜頁。",
      },
      {
        type: "chore",
        text: "移除介面（分頁標題 / about / README / 後端 FastAPI title）殘留的「v3」字樣，新增簡約的「文件＋勾選」app icon 並用於 header。",
      },
    ],
  },
  {
    version: "3.5.0",
    date: "2026-05-30",
    title: "移除 Phase 2 few-shot 回饋迴路，改為純人工評估",
    summary:
      "拿掉「同規則累積 ≥3 筆判定就注入 prompt 當 few-shot 範例」的回饋迴路。學長的人工判定（correct / partial / wrong）保留，但只用於量化 precision 與匯出 ground truth，不再回寫進 prompt——每次檢核都是獨立 zero-shot，結果可重現。",
    changes: [
      {
        type: "feat",
        text: "移除 few-shot 注入：rules.check_rule 不再讀取過去判定組 examples_block，checker prompt 拿掉 {examples_block}，並刪除 db.get_judgment_examples 與 rules._build_examples_block。規則檢核一律 zero-shot。",
      },
      {
        type: "feat",
        text: "人工檢查機制保留：缺陷標註（✅判對 / 🤔部分對 / ❌誤判）、per-rule soft precision 統計、judgments 匯出（ground truth）、eval summary 全數不變。",
      },
      {
        type: "docs",
        text: "stats 頁移除「Phase 2」欄與 few-shot / zero-shot 說明；about 頁第 8 節由「Phase 2 回饋迴路」改為「人工評估機制」，移除回饋迴路時序圖與 in-context learning 文獻條目。",
      },
    ],
  },
  {
    version: "3.4.0",
    date: "2026-05-25",
    title: "論文標題自動偵測",
    summary:
      "上傳時不必再手動輸入標題：系統會用 LLM 從論文首頁讀出真正的標題，使用者留空即可（想覆寫再手動填）。",
    changes: [
      {
        type: "feat",
        text: "標題自動偵測：抽取後以 gpt-5.4-mini 讀論文第一頁前約 1500 字取得標題（一次極輕量呼叫，成本可忽略），使用者未填標題時自動套用，偵測失敗才退回檔名。",
      },
      {
        type: "feat",
        text: "上傳表單標題欄改為選填覆寫，提示「留空則自動偵測」。",
      },
    ],
  },
  {
    version: "3.3.0",
    date: "2026-05-25",
    title: "分析效能大幅優化：平行化 + 規則瘦身",
    summary:
      "章節抽取與 13 條規則檢核改為平行執行，並精簡規則判定輸出，整篇分析從約 9 分鐘降到約 2 分鐘、成本同步下降；判定結果與舊版一致（已用固定圖譜 A/B 跨 4 篇驗證無退步）。",
    changes: [
      {
        type: "perf",
        text: "分析 pipeline 平行化：章節抽取（EDU/ER/RST·FRU）與 13 條 REL 規則改用 thread pool 同時送出（OPENAI_MAX_WORKERS，預設 6），整篇處理時間約 9 分鐘 → 約 2 分鐘（約 5×），結果保序可重現。",
      },
      {
        type: "perf",
        text: "規則判定輸出瘦身：verdict schema 只在「違規」時才填細節欄位，非違規不再產生廢棄文字，rule_check 階段 output token 約 −43%、時間約 −35%。",
      },
      {
        type: "chore",
        text: "新增單元測試（亂碼偵測 / 抽取路由 / singleton 併發）與 thread-safe singleton；文件精簡為 SYSTEM / DB_SCHEMA / TODO 三份核心並補效能說明。",
      },
    ],
  },
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
