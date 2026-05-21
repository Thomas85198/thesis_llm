# 實作計畫：從「論文審查」到「論文協作編輯 + 可 merge 的缺失建議」

> 目標：把現在「針對寫好的論文做唯讀審查」的系統，擴充成「可匯入 LaTeX / .md / Word / txt，在系統內編輯，並像 git commit 一樣同意 merge 缺失建議」的協作編輯系統。
>
> 本文件對齊 2026-05-14 當下 `feat/openai-deploy` 分支的真實程式碼結構。

---

## 一、核心設計決策

後面所有 phase 都建立在這四個決策上。

### 決策 A：定位模型 — bbox → 字元 offset

現在整套靠 PDF 的 `(page, bbox)` 定位 EDU，但 LaTeX / .md / Word 沒有 bbox。

解法：讓 `EDU` 同時帶 `char_start / char_end`，指向**原始碼**的字元位置。

- `pipeline.py` 的 `Span` 早就有 `char_start / char_end`。
- `_locate_edu_in_spans()` 內部已算出 `approx_char`（`pipeline.py:200`）— 只要一併回傳即可。
- PDF 模式保留 bbox，文字模式用 char offset，**兩者並存、向後相容**。

### 決策 B：可編輯來源變成一等公民

新增「文件來源」儲存層。

- PDF 維持**唯讀審查模式**（現有產品不動）。
- LaTeX / .md / docx / txt 進入**編輯模式**。
- 前端依 `papers.format` 分流到不同檢視器。

### 決策 C：`suggestion`（散文）→ `proposed_edit`（結構化 patch）

這是「能不能 merge」的關鍵。現在 `Defect.suggestion` 是自然語言散文，無法被 merge。

`Defect` 新增結構化欄位：

```python
class ProposedEdit(BaseModel):
    edit_type: Literal["replace", "insert_after", "insert_before"]
    anchor_edu_ids: list[str]   # 依附在哪些 EDU；offset 由後端從 EDU 推導，不信任 LLM 給的數字
    original_text: str          # 取代前的原文切片 → 用於衝突偵測 & 套用時 fuzzy 重新定位
    replacement_text: str       # LLM 產出的新文字
    is_generative: bool         # true = 需作者補寫的草稿骨架；false = 機械式可一鍵套用
    rationale: str              # 一句話說明這個改動
```

### 決策 D：merge / 版本語意

「同意 merge」= 把 patch 套進來源 → 版本號 +1 → 寫進 `edit_history`。

- **版本化用版本表，不用真 git**：對論文 demo 來說 git subprocess 太重，版本表就能提供 diff / revert / 歷史。
- 每個版本各自擁有一份 `AnalysisResult`（見 Phase 2 的 schema 遷移）。

---

## 二、分階段實作

每個 phase 都能獨立交付價值。

### Phase 0 — 定位地基（後端，低風險，UX 不變）

| 動作 | 檔案 |
|---|---|
| `EDU` schema 加 `char_start: int \| None`、`char_end: int \| None` | `backend/app/schemas.py:21` |
| `_locate_edu_in_spans()` 多回傳 char 區間（內部已算 `approx_char`） | `backend/app/pipeline.py:163` |
| `extract_edus()` 填入新欄位 | `backend/app/pipeline.py:242` |
| 前端 `EDU` type 同步加欄位 | `frontend/lib/api.ts:31` |

`results.result_json` 是 schemaless JSON，舊資料讀回來新欄位是 `None`，**不需 DB migration**。
先做這個，因為後面全部依賴文字 offset 定位。

### Phase 1 — 多格式匯入（後端）

| 動作 | 說明 |
|---|---|
| `extract_spans_from_bytes()` 支援 `.md` `.tex` `.docx` | `pipeline.py:62`。`.md / .txt` 走現成文字路徑；`.docx` 用 `python-docx` / `mammoth` 轉成文字 + 段落 offset |
| LaTeX 處理策略 | **不要硬剝 macro**。把輕度清理版（`\cite{}` → `[cite]` 等）餵給 LLM 做分析，但用 `_locate_edu_in_spans()` 既有的 **fuzzy matcher** 把 EDU 文字錨回**原始 .tex 來源**的 offset。重用現有機制，避開「清理版 ↔ 原始版 offset 對映」的地獄 |
| section splitter 加 pattern | `pipeline.py:35` 的 `SECTION_PATTERNS` 加 `\section{}`、Markdown `#` 標題 |
| 存原始來源 | `papers` 加 `format` 欄位；來源文字進 Phase 2 的版本表 |

⚠️ 最難的一塊是 LaTeX 的 offset 錨定，靠「fuzzy match 回原始碼」化解。docx 編輯會丟格式 → import 時轉 markdown，匯出時以 .md 為主、.docx 標示為 lossy。

### Phase 2 — 可編輯來源 + 版本歷史（後端 + 前端編輯器）

**DB migration**（沿用 `db.py:126` 的 `_migrate` PRAGMA 模式）：

```sql
CREATE TABLE document_versions (
    paper_id       TEXT NOT NULL,
    version        INTEGER NOT NULL,
    source_text    TEXT NOT NULL,
    parent_version INTEGER,
    edit_summary   TEXT,           -- "手動編輯" / "套用 defect:xxx"
    created_at     TEXT NOT NULL,
    PRIMARY KEY (paper_id, version)
);
```

- `results` 主鍵由 `paper_id` 改為 `(paper_id, version)` — 改稿後 EDU / defect id 會重排，**每個版本擁有自己的 `AnalysisResult`**。
- `defect_judgments` 同步加 `version` 欄位。

| 新端點 | 用途 |
|---|---|
| `GET /api/papers/{id}/source` | 取目前來源 + format + version |
| `PUT /api/papers/{id}/source` | 存手動編輯 → 版本 +1 |
| `GET /api/papers/{id}/versions` | 版本歷史 |

**前端**：editable 格式用 **CodeMirror 6**（內建 LaTeX / Markdown mode）取代 `PdfViewer`；`result-view.tsx:216` 依 `format` 分流。編輯器用 `char_start / char_end` 做 EDU range 的 decoration 高亮（取代 bbox highlight）。

### Phase 3 — 結構化 patch：讓 Defect 帶可 merge 的修改（後端）

| 動作 | 檔案 |
|---|---|
| `Defect` 加 `proposed_edit: ProposedEdit \| None` | `schemas.py:104` |
| `VERDICT_SCHEMA` + `CROSS_SECTION_SCHEMA` 加 `proposed_edit` 欄位 | `rules.py:32`、`rules.py:236` |
| `checker.md` / `cross_section.md` prompt 擴充 | 指示 LLM：局部可修的 → 具體 patch + `is_generative=false`；缺東西的（缺證據、缺拆解）→ 產「待補草稿骨架」+ `is_generative=true` |
| 後端推導 offset | **不信任 LLM 給的數字**。LLM 只給 `anchor_edu_ids` + `replacement_text`，後端從 EDU 的 `char_start / char_end` 算 target 區間，`original_text` 從來源切片填入 |

⚠️ 誠實的 UX：13 條 REL 規則大多是「缺了某個東西」（NakedClaim 等），這類 `is_generative=true`，按鈕要寫「插入待補草稿」而非「一鍵修正」。

### Phase 4 — Merge 工作流：「git commit」體驗（後端 + 前端）

| 新端點 | 行為 |
|---|---|
| `POST /api/papers/{id}/defects/{defect_id}/apply` | 套用 `proposed_edit` → 新版本 → 寫 `edit_history` → 標記 defect `merged` |
| `POST .../reject` | 標記略過。**直接複用 `defect_judgments` 的 `wrong` verdict** — accept / reject 概念上就是 judgment，基礎建設已在 `db.py:333` |

**關鍵：避開 cascading offset 問題** — 套用 patch A 後，後面所有 patch 的 offset 都位移了。解法：套用時**不信任舊 offset**，改用 `original_text` 在當前來源裡 fuzzy 重新定位；對不上就回 `409 conflict` 讓使用者處理。這樣多重 merge 不會互相破壞。

**前端**：`DefectPanel` 卡片加 diff 視圖（紅刪／綠增）+「✓ 同意並套用」「✗ 略過」。套用後編輯器來源即時更新、版本號跳動、卡片收合成「已套用 ✓」。這就是 git diff hunk 的 accept 體驗。

### Phase 5 — 增量重新分析（後端）：閉環

改稿後 defects 就過期了，需要重跑。全跑太貴 → **section 級快取**：

| 動作 | 說明 |
|---|---|
| `section_cache` 表，key = section 文字 hash | 只重抽取 / 重檢核「文字 hash 變了」的章節 |
| `build_paper_graph()` 改成查 cache | `pipeline.py:520`，沿用現有 file-hash cache 思路（`routes.py:147`）做到 section 粒度 |
| cross-section pass | 任一章節變動才重跑；純排版改動可跳過 |
| `POST /api/papers/{id}/reanalyze` | 對當前版本觸發（增量）重分析 |

前端加「重新分析」鈕，顯示哪些章節變動了。

### Phase 6 — 收尾（選配）

匯出回原格式、「整章一鍵接受」批次 merge、版本間 diff 檢視、（若要）改成真 git backing 拿 blame / revert。

---

## 三、風險清單

| 風險 | 出現在 | 緩解 |
|---|---|---|
| LaTeX offset 錨定 | Phase 1 | 重用既有 fuzzy matcher 錨回原始碼 |
| 多重 merge 的 offset 連鎖位移 | Phase 4 | 套用時用 `original_text` 重新定位，不信舊 offset |
| 多數規則是「缺東西」、無法乾淨 merge | Phase 3 | `is_generative` 旗標 + 不同按鈕文案 |
| 每次改稿重分析的成本 | Phase 5 | section 級快取（必須做，否則每輪編輯 = 一次完整 pipeline 費用） |
| docx 編輯丟格式 | Phase 1 | import 轉 markdown，匯出標示 lossy |
| 改稿後 EDU / defect id 重排 → judgment orphan | Phase 2 | `results` 改為版本範圍 `(paper_id, version)` |

---

## 四、執行順序與相依

```
Phase 0 ──→ Phase 1 ──→ Phase 2 ──→ Phase 3 ──→ Phase 4 ──→ Phase 5
（地基）   （匯入）    （編輯器）   （patch）   （merge）   （增量重分析）
```

- Phase 0 + 1 完成：能匯入新格式並看到分析結果（仍唯讀）。
- Phase 2 完成：能編輯。
- Phase 3 + 4 完成：才有「同意 merge」。
- Phase 5 完成：變成可持續迭代的真正寫作循環。

**最小可動 demo = Phase 0 → 4**；Phase 5 是讓它好用的關鍵，但可後補。
