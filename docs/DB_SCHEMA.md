# SQLite Schema 完整說明

> 檔案位置：[backend/data.db](../backend/data.db)
> 程式碼定義：[backend/app/db.py](../backend/app/db.py) `SCHEMA` 字串
> 共 10 張表（2026-07-13 新增 `chat_messages`）：
> - 檢核管線：`papers`（metadata）、`results`（analysis result）、`llm_calls`（cost log）、`defect_judgments`（human judgments）、`chat_messages`（論文助手對話持久化）
> - 編輯器：`documents`、`document_versions`、`paper_chunks`、`draft_check_cache`
> - 上傳稽核：`upload_events`
> 下文詳述前四張；其餘見 [backend/app/db.py](../backend/app/db.py) `SCHEMA` 字串（尚未全數展開於本文件）。

---

## 整體設計準則

| 儲存層 | 內容 | 為什麼放這裡 |
|---|---|---|
| **Neo4j** | 五種節點 + 邊（Paper / EDU / Entity / FRU / RST） | 結構性資料給 Cypher 候選查詢 |
| **SQLite (本檔)** | 論文 metadata、分析結果 JSON、成本 log、人工判定 | 流水/評估/快取資料 |
| 本地磁碟 (`backend/uploads/`) | PDF 原檔 | 二進位檔給前端拉回顯示 |
| In-memory `_jobs` | 分析中 job 狀態 | 重啟丟失無關緊要 |

---

## 表 1：`papers` — 論文中繼資料 + 上傳去重快取

**用途**：每筆代表一篇上傳過的論文。

**為什麼存 SHA-256**：上傳同一份檔案兩次，第二次直接命中 cache，回傳之前的 paper_id 不重跑 LLM。永久有效（重啟後也記得）。

| 欄位 | 型別 | 說明 |
|---|---|---|
| `paper_id` | TEXT PRIMARY KEY | 論文唯一識別，格式 `paper:xxxxxxxx`（8 hex chars） |
| `title` | TEXT | 論文標題（使用者上傳時填，沒填就用檔名） |
| `content_hash` | TEXT | 檔案內容 SHA-256，用於上傳去重快取 |
| `pdf_path` | TEXT | PDF 原檔在 `backend/uploads/` 的**檔名（basename）**，非絕對路徑（2026-07-02 校正；見 `routes.py:396`、`scripts/migrate_pdf_path.py`） |
| `created_at` | TEXT NOT NULL | 建立時間（ISO 8601 UTC） |

**索引**：`idx_papers_hash ON (content_hash)` — 加速去重查詢

**範例查詢**：
```sql
-- 看所有上傳過的論文
SELECT paper_id, title, datetime(created_at) AS created
FROM papers
ORDER BY created_at DESC;

-- 用 hash 找有沒有上傳過
SELECT paper_id, title FROM papers
WHERE content_hash = 'xxx...';
```

---

## 表 2：`results` — 完整分析結果（KG + Defects + RuleMeta）

**用途**：存每篇論文「分析完成後的整份 JSON」。

**為什麼用 JSON 不拆表**：分析結果是嵌套結構（graph 內含 edus / entities / er_triples / fru_nodes / rst_nodes、defects 內含多個欄位），拆關聯式表會碎成 6+ 張表，但讀寫永遠一次性，沒查詢需求要拆。Neo4j 那邊已經是結構化的，這裡只要能秒讀回前端就夠。

**為什麼用 ON DELETE CASCADE**：刪 paper 時自動清 result，不會留孤兒。

| 欄位 | 型別 | 說明 |
|---|---|---|
| `paper_id` | TEXT PRIMARY KEY | 對應 `papers.paper_id`，CASCADE 刪除 |
| `result_json` | TEXT NOT NULL | 完整 `AnalysisResult` JSON（含 graph + defects + rule_meta） |
| `finished_at` | TEXT NOT NULL | 分析完成時間（ISO 8601 UTC） |
| `defect_count` | INTEGER | 冗餘欄位：`len(defects)`。論文列表頁只要數字，免解整份 JSON（N+1 修正，2026-07-08） |
| `edu_count` | INTEGER | 冗餘欄位：`len(graph.edus)`，同上。舊列由 migration backfill，之後 `upsert_result` 同步維護 |

**JSON 內結構**（重點欄位）：
```
result_json = {
  paper_id, graph, defects, rule_meta
}
graph = { paper_id, title, edus[], entities[], er_triples[], fru_nodes[], rst_nodes[] }
defects[] = { id, rule_id, defect_type, severity, section, evidence_edu_ids, description, suggestion, confidence }
rule_meta[] = { rule_id, candidate_count, defect_count }   # 2026-07-02 校正：無 examples_used（schemas.py RuleRunMeta 只有這三欄，few-shot 已移除）
```

**範例查詢**（用 SQLite 的 JSON 函式抽欄位）：
```sql
-- 用 JSON 抽出每篇的缺陷數
SELECT paper_id,
       json_array_length(json_extract(result_json, '$.defects')) AS defect_count,
       json_array_length(json_extract(result_json, '$.graph.edus')) AS edu_count
FROM results;

-- 找特定論文每條規則的候選數 / 缺陷數
-- （2026-07-02 校正：原用 $.examples_used，該欄不存在——few-shot 已移除，rule_meta 只有 candidate_count/defect_count）
SELECT paper_id, value
FROM results, json_each(json_extract(result_json, '$.rule_meta'))
WHERE paper_id = 'paper:xxx'
  AND CAST(json_extract(value, '$.defect_count') AS INTEGER) > 0;
```

---

## 表 3：`llm_calls` — 每次 LLM 呼叫的 token / cost log

**用途**：Pipeline 每呼叫 OpenAI API 一次就 INSERT 一筆。

**三個用途**：
1. `/api/cost` 結算每篇論文 / 全域累積成本
2. 監控 context window 使用率
3. 找最貴的 stage / 最貴的論文 outlier

**為什麼 paper_id 允許 NULL**：未來可能有非論文相關的 system 呼叫（例如系統健康檢查、prompt validation）。

| 欄位 | 型別 | 說明 |
|---|---|---|
| `id` | INTEGER PRIMARY KEY AUTOINCREMENT | 流水號 |
| `paper_id` | TEXT | 屬於哪篇論文（可 NULL） |
| `stage` | TEXT NOT NULL | pipeline 階段；格式 `階段:section`，例如 `edu:Method` / `er:Introduction` / `rst_fru:Conclusion` / `rule_check:REL-09` / `cross_section_pass` / `chat` |
| `model` | TEXT NOT NULL | 使用的 OpenAI model id（如 `gpt-5.4` / `gpt-5.4-mini`） |
| `input_tokens` | INTEGER NOT NULL | 此次 input token 數 |
| `output_tokens` | INTEGER NOT NULL | 此次 output token 數 |
| `cache_read_tokens` | INTEGER DEFAULT 0 | 從 prompt cache 讀取的 token（便宜，每 1M 比 input 便宜 10x） |
| `cache_write_tokens` | INTEGER DEFAULT 0 | 寫入 prompt cache 的 token（首次） |
| `cost_usd` | REAL NOT NULL | 此次美元成本（依 [llm.py PRICING](../backend/app/llm.py) 計算） |
| `created_at` | TEXT NOT NULL | 呼叫時間（ISO 8601 UTC） |

**索引**：
- `idx_llm_calls_paper ON (paper_id)` — 加速「這篇論文花了多少」
- `idx_llm_calls_stage ON (stage)` — 加速「哪個 stage 最貴」

**範例查詢**：
```sql
-- 每篇論文總花費
SELECT paper_id, COUNT(*) AS calls, ROUND(SUM(cost_usd), 4) AS usd
FROM llm_calls GROUP BY paper_id ORDER BY usd DESC;

-- 各 stage 累積成本（給 demo 講「哪步最貴」）
SELECT stage, model, COUNT(*) AS calls, ROUND(SUM(cost_usd), 4) AS usd
FROM llm_calls GROUP BY stage, model ORDER BY usd DESC;

-- Context window 使用率（最大那筆要 < 80% 才安全）
SELECT paper_id, stage, model, input_tokens,
       ROUND(input_tokens * 100.0 /
         CASE WHEN model LIKE '%[1m]%' THEN 1000000 ELSE 200000 END, 1
       ) AS pct_of_window
FROM llm_calls
ORDER BY pct_of_window DESC LIMIT 10;
```

---

## 表 4：`defect_judgments` — Human-as-judge 標註（Phase 2 燃料）

**用途**：學長對每個缺陷的判定（✅判對 / 🤔部分對 / ❌誤判）。

**這張表是 Phase 2 的核心**：規則檢核時，[rules.py](../backend/app/rules.py) `check_rule` 會先用 `db.get_judgment_examples(rule_id)` 撈該規則最近 4 筆 correct + 4 筆 wrong，注入 LLM system prompt 當 few-shot calibration。詳見 [SYSTEM.md §3.6](SYSTEM.md)。

**為什麼複合主鍵 `(paper_id, defect_id)`**：同一缺陷只能有一個 verdict；學長改判會用 `ON CONFLICT DO UPDATE` 覆寫。

**為什麼 verdict 加 CHECK 約束**：髒資料會直接污染 Phase 2 注入內容（例如 "wrng" 拼錯就被無視掉），所以強制三選一。

| 欄位 | 型別 | 說明 |
|---|---|---|
| `paper_id` | TEXT NOT NULL | 缺陷所屬論文 |
| `defect_id` | TEXT NOT NULL | 缺陷 id，對應 `results.result_json` 中 defects 陣列裡的 `defect.id` |
| `rule_id` | TEXT NOT NULL | 該缺陷觸發的規則（REL-01 ~ REL-13） |
| `verdict` | TEXT NOT NULL CHECK | 必為 `correct` / `wrong` / `partial` 三選一 |
| `note` | TEXT | 學長的補充說明（選填，會跟著 verdict 一起餵給 Phase 2 LLM） |
| `created_at` | TEXT NOT NULL | 標註時間（ISO 8601 UTC） |

**主鍵 + 索引**：
- PRIMARY KEY `(paper_id, defect_id)` — 自動有索引
- `idx_judgments_rule ON (rule_id)` — 加速「這條規則被判過幾次」
- `idx_judgments_paper ON (paper_id)` — 加速「這篇被判過幾筆」

**範例查詢**：
```sql
-- per-rule 判定健康度（Phase 2 ≥3 筆才會啟動）
SELECT rule_id, COUNT(*) AS judged_n,
       SUM(CASE WHEN verdict='correct' THEN 1 ELSE 0 END) AS correct,
       SUM(CASE WHEN verdict='wrong'   THEN 1 ELSE 0 END) AS wrong,
       SUM(CASE WHEN verdict='partial' THEN 1 ELSE 0 END) AS partial,
       CASE WHEN COUNT(*) >= 3 THEN '✅ Phase 2 ON' ELSE '⏳ 樣本不足' END AS phase2_status
FROM defect_judgments
GROUP BY rule_id
ORDER BY judged_n DESC;

-- 全域 soft precision：(correct + 0.5×partial) / total
SELECT
  COUNT(*) AS total,
  ROUND((SUM(CASE WHEN verdict='correct' THEN 1 ELSE 0 END)
       + 0.5 * SUM(CASE WHEN verdict='partial' THEN 1 ELSE 0 END))
       * 1.0 / COUNT(*), 3) AS soft_precision
FROM defect_judgments;

-- 看某篇論文的所有判定
SELECT defect_id, rule_id, verdict, note, datetime(created_at) AS at
FROM defect_judgments
WHERE paper_id = 'paper:xxx'
ORDER BY created_at;
```

---

## 表之間的關係圖

### ERD（Entity-Relationship Diagram）

```mermaid
erDiagram
    papers ||--o| results : "1:1 CASCADE"
    papers ||--o{ llm_calls : "1:N (soft)"
    papers ||--o{ defect_judgments : "1:N (soft)"
    results ||..o{ defect_judgments : "邏輯關聯 (defect_id 指向 JSON 內 defects[].id)"

    papers {
        TEXT paper_id PK "格式 paper:xxxxxxxx"
        TEXT title "論文標題"
        TEXT content_hash "SHA-256，去重快取"
        TEXT pdf_path "本地 PDF 路徑"
        TEXT created_at "ISO 8601 UTC"
    }

    results {
        TEXT paper_id PK_FK "CASCADE delete with papers"
        TEXT result_json "整份 AnalysisResult JSON"
        TEXT finished_at "分析完成時間"
    }

    llm_calls {
        INTEGER id PK "自增流水號"
        TEXT paper_id "可 NULL (soft FK)"
        TEXT stage "edu/er/rst_fru/rule_check/cross_section_pass/chat"
        TEXT model "gpt-5.4 / gpt-5.4-mini 等"
        INTEGER input_tokens
        INTEGER output_tokens
        INTEGER cache_read_tokens "default 0"
        INTEGER cache_write_tokens "default 0"
        REAL cost_usd
        TEXT created_at
    }

    defect_judgments {
        TEXT paper_id PK "複合主鍵"
        TEXT defect_id PK "對應 results JSON 內 defect.id"
        TEXT rule_id "REL-01 ~ REL-13"
        TEXT verdict "CHECK: correct/wrong/partial"
        TEXT note "選填，會餵給 Phase 2 LLM"
        TEXT created_at
    }
```

### 文字版（不能 render mermaid 時看這個）

```
papers (論文 metadata + 上傳去重)
  │
  ├──◇ results (1:1 CASCADE)
  │     └─ result_json 內含 defects[]、graph、rule_meta
  │
  ├──◇ llm_calls (1:N 軟關聯，paper_id 可 NULL)
  │     └─ 每次 LLM 呼叫的 token / cost log
  │     └─ stage 區分 edu / er / rst_fru / rule_check / cross_section_pass / chat
  │
  └──◇ defect_judgments (1:N 軟關聯)
        └─ 學長判定，PK = (paper_id, defect_id)
        └─ defect_id 邏輯指向 results.result_json[defects][].id
        └─ 是 Phase 2 few-shot 注入的資料源
```

### 關係強度說明

| 關係 | 強度 | 為什麼 |
|---|---|---|
| `papers ↔ results` | **Hard FK + CASCADE** | 沒了 paper 留 result 沒意義；刪 paper 時自動清乾淨 |
| `papers ↔ llm_calls` | **軟關聯**（無 FK） | 刪 paper 時要保留 cost log 給歷史 audit / 跨 paper 統計 |
| `papers ↔ defect_judgments` | **軟關聯**（無 FK） | 同上，judgments 是 Phase 2 燃料，刪 paper 不該丟 |
| `defect_judgments ↔ results.json` | **邏輯關聯** | defect_id 在 JSON 裡，沒法用 SQL FK，靠程式層維持一致性 |

> 如果要把 cost log / judgments 也跟著刪，把 [db.py `delete_paper`](../backend/app/db.py) 改成同步 DELETE 即可。目前刻意不這樣做。

---

## 連線方式（DBeaver Community 免費版）

1. 安裝 [DBeaver](https://dbeaver.io/)
2. 選 **SQLite** driver（首次會自動下載）
3. **Path** 設成 `backend/data.db` 的絕對路徑
4. Test connection → Finish

> **Demo 防雷**：DBeaver 連 SQLite 不需要關 backend；SQLite 本身支援多 reader 並行。寫入時 backend 會短暫 lock 但 DBeaver 會自動 retry。

## 等價的 HTTP API（不想開 SQL 也行）

| SQL 查詢 | 對應 HTTP API |
|---|---|
| 看所有論文 | `GET /api/papers` |
| 看某篇結果 | `GET /api/papers/{id}/result` |
| 看某篇成本 | `GET /api/papers/{id}/cost` |
| 看全域成本 | `GET /api/cost` |
| 看某篇判定 | `GET /api/papers/{id}/judgments` |
| 看 per-rule precision | `GET /api/judgments/summary` |
| 看 13 條規則統計 | `GET /api/rules/stats` |
