# 論文檢核系統 v3 — Demo / Report Q&A 完整報告

> 用途：demo 前複習、被老師問時的答案速查、SQL / Cypher 操作手冊。
> 所有語法都保留可複製。Demo 時 paper_id 替換成你當下分析的論文 id。
> 最後更新：2026-05-10

---

## 目錄

- [0. 系統一句話定位](#0-系統一句話定位)
- [Q1: 模型使用 + Context 預算](#q1-模型使用--context-預算)
- [Q2: KG 切割 + Neo4j 查詢操作](#q2-kg-切割--neo4j-查詢操作)
- [Q3: 學術文獻支撐](#q3-學術文獻支撐)
- [Q4: 回饋機制加強 + SQL 資料驗證](#q4-回饋機制加強--sql-資料驗證)
- [Q5: 下一步路線圖](#q5-下一步路線圖)
- [Q6: Context 爆掉怎麼確認](#q6-context-爆掉怎麼確認)
- [附錄 A: Demo 完整操作流程（10 分鐘版）](#附錄-a-demo-完整操作流程10-分鐘版)
- [附錄 B: Demo 防雷一頁速查卡](#附錄-b-demo-防雷一頁速查卡)

---

## 0. 系統一句話定位

> 上傳論文 → 自動建 Knowledge Graph → 用 13 條 REL 規則檢核 → 輸出邏輯缺陷與修改建議。

**跟「直接問 ChatGPT 改論文」的差別**：

| 維度 | 純 LLM 對話 | 本系統 |
|---|---|---|
| 結果可重現 | ❌ 每次答案不同 | ✅ KG + 規則確定性 |
| 追溯到原文位置 | ❌ 描述模糊 | ✅ 高亮 PDF 上具體句子（page + bbox） |
| 規則可由人維護 | ❌ 黑盒 | ✅ 規則寫在 YAML，學長可改 |
| 跨論文比較 | ❌ | ✅ KG 持久化於 Neo4j + SQLite |
| 投論文有方法論支撐 | ❌ | ✅ Symbolic + Neural（Neurosymbolic AI） |

---

## Q1: 模型使用 + Context 預算

### 各 Pipeline 階段的模型分配

| 階段 | 程式碼 | 模型 | Context 上限 | 為什麼這樣選 |
|---|---|---|---|---|
| **EDU 切分** | `pipeline.py extract_edus` | `model_light()` = Sonnet 4.6 | 200K | EDU 是 mechanical 切句，Sonnet 已穩；Haiku 試過會把多命題合併（違反 "elementary"） |
| **Entity-Relation** | `pipeline.py extract_er` | Sonnet 4.6 | 200K | 標 entity + binary relation，schema 嚴格，不需要 Opus 深推理 |
| **RST / FRU 標註** | `pipeline.py extract_rst_fru` | `model_heavy()` = Sonnet 4.6 (env 可改 Opus) | 200K | 修辭關係判斷比 ER 難一級，但 Sonnet 還在能力範圍 |
| **13 條規則檢核** | `rules.py check_rule` | `model_heavy()` = Sonnet 4.6 | 200K | 每條規則獨立 call，per-section 輸入小 |
| **跨章節 second pass** | `rules.py cross_section_pass` | 預設 `model_heavy()`；可由 `ANTHROPIC_MODEL_CROSS_SECTION` 升級到 Opus 1M | 200K（Sonnet 4.6）/ 1M（Opus opt-in） | 全篇 EDU 一起塞進去，REL-04/08/12 需要跨章節推理 |
| **論文助手聊天** | `chat.py` | Sonnet 4.6 | 200K | 對話成本敏感，Sonnet 夠用 |

### Context 預算（以實際論文長度估算）

| 論文長度 | EDU 數量 | per-section call 輸入 | 占 Sonnet 200K | cross-section pass 占 Opus 1M |
|---|---|---|---|---|
| 12 頁（Vaswani 2017） | ~250 | ~10K tokens | 5% | 1% |
| 30 頁 ICML paper | ~600 | ~25K | 12% | 2.5% |
| 100 頁 thesis | ~2000 | ~80K | 40% | 8% |
| 200 頁 phD | ~4000 | ~150K | **75% ⚠️** | 15% |

**Demo 防雷答案**：
1. 一般學術論文（≤100 頁）所有 stage 都安全
2. 跨章節 pass 用 Opus 4.7 1M context 是「保險」，把全篇塞進去也還剩 92%
3. Pipeline 有 hard cap：`rules.py` 截 120K 字元、`cross_section_pass` 截 400K 字元
4. SQLite `llm_calls.input_tokens` 即時追蹤，可查歷史最大值

---

## Q2: KG 切割 + Neo4j 查詢操作

### 切割流程（5 步）

```
PDF bytes (PyMuPDF)
  ↓ extract_spans_from_bytes
Spans (page + bbox 保留)              ← 每行一個 Span
  ↓ split_sections_with_spans
Sections (Abstract/Intro/Method/...)   ← regex 抓章節標題
  ↓ extract_edus (LLM)
EDUs (id, text, section, order, page, bbox)  ← 最小命題
  ↓ 每個 section 平行做 ↓
ER (Entity, Triple)   RST (nucleus+satellite)   FRU (function+EDU群+summary)
```

### Neo4j Schema（5 種節點 + 6 種邊）

> ⚠️ **屬性名注意**：Paper 節點用 `id`（不是 `paper_id`）；其他節點同時有 `id` + `paper_id`。

| 節點 | 屬性 |
|---|---|
| `Paper` | **id**, title |
| `EDU` | id, **paper_id**, text, section, order, page, bbox |
| `Entity` | id, **paper_id**, name, type (Concept/Method/Metric/Dataset/Model/Task/Claim/Other) |
| `FRU` | id, **paper_id**, function (Motivation/Claim/Evidence/MethodStep/Observation/Attribution/...), summary |
| `RST` | id, **paper_id**, rst_type (Elaboration/Cause/Result/Contrast/Evidence/Justify/Sequence/...) |

| 邊 | 意義 |
|---|---|
| `(Paper)-[:HAS_EDU]->(EDU)` | 篇章歸屬 |
| `(Entity)-[:ER {predicate, evidence_edu_id, paper_id}]->(Entity)` | binary relation（**邊型別是 `:ER`**，predicate 存在邊屬性上） |
| `(Entity)-[:MENTIONED_IN]->(EDU)` | entity 在哪個 EDU 被提到 |
| `(FRU)-[:COVERS]->(EDU)` | 修辭單位涵蓋的 EDUs |
| `(RST)-[:NUCLEUS]->(EDU)` | RST 核心 |
| `(RST)-[:SATELLITE]->(EDU)` | RST 衛星 |

### Neo4j Browser 操作流程

#### Step 1：列出所有論文，挑一個 paper_id

> ⚠️ Paper 節點屬性叫 `id` 不是 `paper_id`。其他節點才用 `paper_id`。

```cypher
MATCH (p:Paper)
RETURN p.id AS pid, p.title AS title;
```

#### Step 2：在 Browser 指令列設參數（**冒號開頭，是 Browser 指令不是 Cypher**）

```
:param pid => "paper:YOUR_ID"
```

> 之後所有 `$pid` 都會自動代入這個值。或者也可以每條 query 都把 `$pid` 換成 `'paper:YOUR_ID'` inline 跑。

#### Step 3：Demo 用的核心查詢（4 組）

##### 3.1 整篇論文 KG 全圖

```cypher
MATCH (p:Paper {id: $pid})
OPTIONAL MATCH (p)-[:HAS_EDU]->(e:EDU)
OPTIONAL MATCH (e)<-[:COVERS]-(f:FRU)
RETURN p, e, f LIMIT 200;
```

> 預設會渲染成圖。**Demo 重點**：「這是論文的所有 EDU + 所屬 FRU 的二層結構」。

##### 3.2 Claim ↔ Evidence 鄰近配對（系統的核心抽取能力）

```cypher
MATCH (claim:FRU {paper_id: $pid, function: 'Claim'})-[:COVERS]->(c_edu:EDU)
MATCH (ev:FRU {paper_id: $pid, function: 'Evidence'})-[:COVERS]->(e_edu:EDU)
WHERE abs(c_edu.order - e_edu.order) <= 5
RETURN claim.summary AS claim, c_edu.text AS claim_text,
       ev.summary AS evidence, e_edu.text AS evidence_text;
```

> **Demo 重點**：「我抓到主張和證據，並且依鄰近度配對」。對應 REL-01。

##### 3.3 REL-09 候選（Observation 沒附 Attribution）

```cypher
MATCH (obs:FRU {paper_id: $pid, function: 'Observation'})-[:COVERS]->(obs_edu:EDU)
WHERE obs_edu.section IN ['Results', 'Discussion', 'Experiment']
OPTIONAL MATCH (attr:FRU {paper_id: $pid, function: 'Attribution'})-[:COVERS]->(attr_edu:EDU)
  WHERE attr_edu.section = obs_edu.section
    AND attr_edu.order >= obs_edu.order - 3
    AND attr_edu.order <= obs_edu.order + 8
WITH obs, obs_edu, count(DISTINCT attr) AS nearby_attribution_count
WHERE nearby_attribution_count = 0
RETURN obs.summary AS observation, obs_edu.text, obs_edu.page, obs_edu.section
ORDER BY obs_edu.order;
```

> **Demo 重點**：「這就是 REL-09 的 Cypher 候選查詢，把候選交給 LLM 判讀」。對應 [SYSTEM.md §10.2](SYSTEM.md) REL-09 改 proximity check 的故事。

##### 3.4 Entity-Relation 圖（KG 視覺化截圖）

```cypher
MATCH (e1:Entity {paper_id: $pid})-[r:ER]->(e2:Entity)
RETURN e1, r, e2 LIMIT 50;
```

> **Demo 重點**：「論文的概念-關係圖，predicate 寫在 `:ER` 邊的屬性上」。直接呈現 `entities` + `er_triples`。
> 想看 predicate 文字：`RETURN e1.name, r.predicate, e2.name LIMIT 50;`

##### 3.5 進階：FRU 修辭結構分布（給展示用統計）

```cypher
MATCH (f:FRU {paper_id: $pid})
RETURN f.function AS function, count(*) AS n
ORDER BY n DESC;
```

##### 3.6 進階：每 section 的 EDU 數量分布

```cypher
MATCH (e:EDU {paper_id: $pid})
RETURN e.section AS section, count(*) AS n_edus
ORDER BY n_edus DESC;
```

### 為什麼 `$pid` 是 parameter（demo 防雷）

`$pid` 是 Cypher 的 **parameterized query**。後端 Python（`kg.py run_cypher`）跑時自動傳 `pid=paper_id`，這是 Cypher 最佳實踐：
- 防 injection
- 讓 Neo4j cache 執行計畫，重複跑同樣 query 更快

DBeaver / Neo4j Browser 是手動環境，**必須先 `:param pid => "..."` 或 inline 替換**。

---

## Q3: 學術文獻支撐

按系統設計層次，每層都要有可引用的 anchor：

| 系統設計 | 核心文獻 | 那篇結論支撐什麼 |
|---|---|---|
| **Transformer 抽取能力** | Vaswani et al. 2017 *"Attention Is All You Need"* | self-attention 在 long-range dependency 表現強 → 為什麼 EDU/ER/FRU 抽取可以靠 LLM |
| **RST 修辭結構** | Mann & Thompson 1988 *"Rhetorical Structure Theory: Toward a Functional Theory of Text Organization"* | RST 是已被驗證的論文結構理論基礎；nucleus-satellite 模型是論文修辭分析的金標準 |
| **Argument Mining 用於學術文章** | Stab & Gurevych 2017 *"Parsing Argumentation Structures in Persuasive Essays"* (CL Journal) | claim-premise-support 結構在學術寫作中可用 supervised 模型抽取 → 我們把這套換成 LLM zero-shot |
| **Knowledge Graph + LLM 結合** | Pan et al. 2024 *"Unifying Large Language Models and Knowledge Graphs: A Roadmap"* (TKDE) | KG 補強 LLM grounding；三種模式 (KG-enhanced LLM / LLM-augmented KG / **Synergistic** ← 我們屬此類) |
| **Neurosymbolic AI** | Garcez & Lamb 2020 *"Neurosymbolic AI: The 3rd Wave"* | 純 neural 缺可解釋性，純 symbolic 缺 generalization；hybrid 補兩邊弱點 |
| **In-context Learning（Phase 2 基礎）** | Brown et al. 2020 *"Language Models are Few-Shot Learners"* (GPT-3) | 模型不用 fine-tune，少量範例就能 calibrate → Phase 2 few-shot 注入直接套這個 |
| **Tool Use 強制 schema 輸出** | Schick et al. 2023 *"Toolformer"*；Anthropic Tool Use 文件 | 強制 JSON schema 顯著降 free-form hallucination → 為什麼我們不用 raw text 解析 |
| **Long-context 失準（為何要切 EDU）** | Liu et al. 2024 *"Lost in the Middle: How Language Models Use Long Contexts"* (TACL) | LLM 在長文中段落表現變差 → chunked extraction 的依據 |
| **Hallucination 緩解** | Tonmoy et al. 2024 *"A Comprehensive Survey of Hallucination Mitigation Techniques"* | grounding by retrieval / structured output / human-in-loop 都是有效手段 → 對應 KG + tool use + Human-as-judge |
| **Human-as-judge 評估法** | Chiang & Lee 2023 *"Can Large Language Models Be an Alternative to Human Evaluations?"* (ACL) | 為什麼可以用人工 ground truth 算 precision；inter-annotator agreement 是 gold standard |

### Demo 防雷台詞（一句話打包）

> 「我們不是 invent 新理論，是把 RST (Mann & Thompson 1988) + Argument Mining (Stab & Gurevych 2017) 的標註框架，套到 LLM-driven extraction（Vaswani 2017 → Brown 2020）+ KG grounding (Pan 2024) 上。每一層都有 30 年到 5 年內被引爆的文獻支撐。」

---

## Q4: 回饋機制加強 + SQL 資料驗證

### 回饋機制加強路線（4 個方向）

| 加強 | 工程量 | 效益 |
|---|---|---|
| **Phase 2 已做** — judgment few-shot inject | ✅ 完成 | LLM 學長口味 |
| **Confidence 校正分析** | 1 hr | 看 confidence 0.9+ 的 defect 是不是真的 precision 比 0.5 的高 → calibration plot |
| **代表性 sampling**（取代「最新」） | 半天 | 從 wrong examples 中找跟新 candidate 最相似的，注入更精準 |
| **規則 pair correlation** | 半天 | 例如「REL-04 觸發時，REL-12 經常也觸發」→ 暗示要合併規則 |
| **Inter-annotator agreement (Cohen's kappa)** | 半天 | 你 + 學長各標 5 篇 overlap，算 kappa；論文方法章節 must-have |

### SQL 資料驗證查詢（DBeaver / `sqlite3 backend/data.db` 都可跑）

#### 4.1 完整性：每個 paper 都要有 result + 至少一筆 llm_call

```sql
SELECT p.paper_id, p.title,
       (r.paper_id IS NOT NULL) AS has_result,
       (SELECT COUNT(*) FROM llm_calls c WHERE c.paper_id = p.paper_id) AS n_calls
FROM papers p
LEFT JOIN results r ON r.paper_id = p.paper_id
ORDER BY p.created_at DESC;
```

#### 4.2 Confidence 校正：confidence 高的真的 precision 高嗎？

```sql
WITH defects AS (
  SELECT j.paper_id, j.defect_id, j.rule_id, j.verdict,
         json_extract(value, '$.confidence') AS conf
  FROM defect_judgments j
  JOIN results r ON r.paper_id = j.paper_id
  JOIN json_each(json_extract(r.result_json, '$.defects')) ON
       json_extract(value, '$.id') = j.defect_id
)
SELECT
  CASE
    WHEN conf >= 0.8 THEN 'high (>=0.8)'
    WHEN conf >= 0.5 THEN 'mid (0.5-0.8)'
    ELSE 'low (<0.5)'
  END AS confidence_bucket,
  COUNT(*) AS n,
  ROUND(SUM(CASE WHEN verdict='correct' THEN 1 ELSE 0 END) * 1.0 / COUNT(*), 3) AS precision
FROM defects
GROUP BY confidence_bucket;
-- 預期：high bucket 的 precision 應該明顯 > low bucket
-- 若 high precision = low precision → confidence 沒用，要重 prompt
```

#### 4.3 規則健康度：哪些規則的判定樣本太少，Phase 2 還沒啟用？

```sql
SELECT rule_id, COUNT(*) AS judged_n,
       SUM(CASE WHEN verdict='correct' THEN 1 ELSE 0 END) AS correct_n,
       SUM(CASE WHEN verdict='wrong'   THEN 1 ELSE 0 END) AS wrong_n,
       SUM(CASE WHEN verdict='partial' THEN 1 ELSE 0 END) AS partial_n,
       CASE WHEN COUNT(*) >= 3 THEN '✅ Phase 2 ON' ELSE '⏳ 樣本不足' END AS status
FROM defect_judgments
GROUP BY rule_id
ORDER BY judged_n DESC;
```

#### 4.4 Cost outliers：哪些 paper 異常貴

```sql
SELECT paper_id,
       SUM(input_tokens) AS in_tok,
       SUM(output_tokens) AS out_tok,
       ROUND(SUM(cost_usd), 4) AS usd
FROM llm_calls
GROUP BY paper_id
ORDER BY usd DESC
LIMIT 10;
```

#### 4.5 規則互相關（哪些規則經常一起觸發）— 暗示是否該合併

```sql
WITH per_paper AS (
  SELECT j.paper_id, j.rule_id
  FROM defect_judgments j
  WHERE verdict = 'correct'
)
SELECT a.rule_id AS rule_a, b.rule_id AS rule_b,
       COUNT(DISTINCT a.paper_id) AS co_papers
FROM per_paper a
JOIN per_paper b
  ON a.paper_id = b.paper_id AND a.rule_id < b.rule_id
GROUP BY a.rule_id, b.rule_id
HAVING co_papers >= 3
ORDER BY co_papers DESC;
```

#### 4.6 全域 per-rule precision（給論文表格用）

```sql
SELECT rule_id,
       COUNT(*) AS judged_total,
       ROUND(
         (SUM(CASE WHEN verdict='correct' THEN 1 ELSE 0 END)
          + 0.5 * SUM(CASE WHEN verdict='partial' THEN 1 ELSE 0 END)
         ) * 1.0 / COUNT(*), 3
       ) AS soft_precision
FROM defect_judgments
GROUP BY rule_id
ORDER BY soft_precision DESC NULLS LAST;
```

---

## Q5: 下一步路線圖

| 時程 | 動作 | 為什麼 |
|---|---|---|
| **本週** | 學長標 50 筆 judgments（5-10 篇 × 10 defect/篇） | Phase 2 ablation 唯一 blocker |
| **下週** | 跑 with vs without few-shot ablation；產出表格 | 論文 main result |
| **2 週內** | Pre-annotation 評估工具：自動跑 per-rule precision、F1 報表 | 實驗章節需要的數字 |
| **2 週內** | 你 + 學長盲標 5 篇 overlap，算 Cohen's kappa | 論文方法章節 must-have |
| **3-4 週** | 跑 PeerRead 20 accept + 20 reject 做 sanity check | 論文 generalization 段落 |
| **1 個月** | Anthropic Batch API（async pipeline rewrite） | 大規模實驗成本砍半 |
| **論文前** | Inter-rule 合併分析（從 Q4.5 SQL 得到的 correlation） | 證明 13 條 MECE 設計合理 |
| **defer** | Multi-agent / Local Hybrid (Ollama) / 跨論文 entity 對齊 | demo 不需要，老師說先不嘗試 Ollama |

---

## Q6: Context 爆掉怎麼確認

### 三層保險（已實作）

**層 1：程式碼 hard cap**
- `rules.py check_rule` — `user_content[:120_000]` 字元截斷
- `rules.py cross_section_pass` — `user_content[:400_000]` 字元截斷
- `chat.py` — input cap 2000 字 + history cap 10 turns

**層 2：SQLite 即時監控**

```sql
-- 找接近 context 上限的 call（紅線：pct_of_window > 80%）
SELECT paper_id, stage, model, input_tokens,
       CASE
         WHEN model LIKE '%[1m]%'    THEN ROUND(input_tokens * 100.0 / 1000000, 2)
         WHEN model LIKE 'claude-%'  THEN ROUND(input_tokens * 100.0 / 200000, 2)
       END AS pct_of_window
FROM llm_calls
WHERE input_tokens > 50000
ORDER BY input_tokens DESC
LIMIT 20;
```

**層 3：Anthropic API 自動 throw**
超過 context 直接 400 error，pipeline catch 住會把 paper_id 標 `error` 狀態（`routes.py _run_analysis` 的 try/except）。

### Demo 防雷查詢

```sql
-- 跑這一個就知道歷史所有 papers 中哪個 stage 最接近 context limit
SELECT p.title, c.stage, c.model, c.input_tokens,
       ROUND(c.input_tokens * 100.0 /
         CASE WHEN c.model LIKE '%[1m]%' THEN 1000000 ELSE 200000 END, 1
       ) AS pct
FROM llm_calls c
JOIN papers p ON p.paper_id = c.paper_id
ORDER BY pct DESC
LIMIT 10;
```

如果有任何一行 `pct > 70%`，demo 前就要標出來，可能要拆 section 或換 1M model。

---

## 附錄 A: Demo 完整操作流程（10 分鐘版）

### 環境準備（demo 前 5 分鐘）

```bash
# Terminal 1：Neo4j
docker compose up -d
# Browser: http://localhost:7474 帳號 neo4j / 密碼 thesis_demo_pw

# Terminal 2：Backend
cd backend && source .venv/bin/activate && uvicorn main:app --reload --reload-dir app

# Terminal 3：Frontend
cd frontend && npm run dev
# Browser: http://localhost:3000
```

### Demo 走查（推薦順序）

#### 1. 系統定位（30 秒）
- 開首頁 [http://localhost:3000](http://localhost:3000)
- 講「這個系統解決什麼問題」（用 §0 一句話定位）

#### 2. 上傳論文（1 分鐘）
- 拖曳 PDF 進去（推薦 Vaswani 2017，老師熟悉）
- 講「進度條：抽 EDU → 抽 ER → 標 RST/FRU → 規則檢核」
- 講「會用 PyMuPDF 保留 PDF 座標」

#### 3. 結果頁主視圖（3 分鐘）
- PDF 高亮 + 缺陷面板雙向連結
- 點缺陷 → PDF 自動 scroll + 高亮對應段落
- 講「這就是『追溯到原文』的能力」
- 顯示 confidence 色塊：「LLM 自評信心 0-1」
- 切換分組「按嚴重度 / 按規則」

#### 4. 跨章節 second pass 缺陷（30 秒）
- 找一個有「（跨章節）」字樣的 defect
- 講「這個是 Opus 4.7 1M context 看全篇才抓到的，per-section 抓不到」

#### 5. 論文助手聊天（1 分鐘）
- 點右下角「論文助手」浮動鈕
- 問「這篇的核心 claim 是什麼？」→ 看回覆帶 `[EDU:xxx]` chip
- 點 chip → 跳 PDF 對應位置
- 講「Guardrails：scope 限定本篇、injection 防護、強制 cite」

#### 6. Knowledge Graph 視覺化（1.5 分鐘）
- 切到 KG 頁
- 切換 Entity / FRU 兩層
- 講「Entity 層是概念-關係圖；FRU 層是修辭結構」

#### 7. /stats 規則統計頁（1 分鐘）
- 切到 `/stats`
- 講「13 條規則跨論文命中率、precision、Phase 2 樣本充足度」
- 指狀態 chip：🌑 從未觸發 / ⚠️ 需檢討 / ✅ 良好 / 🔥 高頻

#### 8. Phase 2 回饋迴路（1 分鐘）
- 在 result 頁標幾個缺陷 ✅/🤔/❌
- 重新分析另一篇（或同一篇刪掉 result 重跑）
- 看 header 出現「⚙️ 參考 N 筆學長判定」綠 badge
- 講「這就是閉合的回饋迴路，學長標的東西下次 LLM 會學」

#### 9. Neo4j Browser（demo 殺手鐧，1.5 分鐘）
- 開 [http://localhost:7474](http://localhost:7474)
- 設 `:param pid => "paper:YOUR_ID"`
- 跑 §Q2 的 query 3.1（KG 全圖）→ 漂亮的圖
- 跑 query 3.4（Entity-Relation 圖）→ 講「這是論文的概念網絡」

#### 10. 收尾（30 秒）
- 切到歷史頁，講「全部持久化到 SQLite，重啟仍在」
- 講「整個系統有 30 條 LLM call，這篇花了 $0.55」（用 [`/api/papers/{id}/cost`](backend/app/routes.py)）

---

## 附錄 B: Demo 防雷一頁速查卡

| 可能被問 | 一句話答 |
|---|---|
| **「你怎麼選的模型？」** | 結構化抽取 Sonnet 4.6（夠且便宜），跨章節推理 Opus 4.7 1M（需要全篇 context） |
| **「Context 會不會爆？」** | per-section call 占 ≤12%、cross-section pass 用 1M Opus 占 ≤8%（一般論文）；SQLite 即時追蹤 |
| **「為什麼要 KG 不直接用 LLM？」** | LLM 長文表現掉（Liu 2024 Lost in the Middle），KG 結構化讓查詢確定可重現 + 規則可由人維護 |
| **「為什麼可以做 Phase 2 few-shot？」** | In-context learning（Brown 2020 GPT-3）證明少量範例就能 calibrate，不用 fine-tune |
| **「怎麼證明系統有用？」** | 學長 50 筆 judgments + Phase 2 with/without ablation，預期 precision 上升 10-20% |
| **「為什麼 13 條規則是合理的？」** | 從 51 條章節分層規則 MECE 收斂；可跑 SQL 4.5 看 inter-rule correlation 證明不重疊 |
| **「跟 ChatGPT 改論文差在哪？」** | 確定可重現 + 追溯到 PDF 句子 + 規則人維護 + 跨論文比較 + neurosymbolic 文獻支撐 |
| **「LLM 不是會幻覺嗎？」** | 三層緩解：(1) tool use 強制 JSON schema (2) 強制 cite EDU id (3) Human-as-judge 累積 ground truth |
| **「Cohen's kappa 多少？」** | 還沒做（直接承認），是路線圖 2 週內項目；目前 single annotator + future work 多人標註 |
| **「為什麼用 Neo4j 不用 PostgreSQL？」** | 規則檢核是「找子圖」問題，Cypher 比 SQL 自然；KG schema 也比關聯式表更貼近語意 |
| **「為什麼 SQLite 不用 PostgreSQL？」** | dev 階段單人單機，SQLite 零依賴；正式部署可換 PG，db.py 抽象層幾乎不變 |
| **「Cross-section pass 為什麼用 Opus 1M 不用其他？」** | REL-04/08/12 需要對比 Conclusion vs Introduction 兩個 section 證據；per-section Cypher 抓不到，必須一次看完 |
| **「Prompt 改了會不會壞？」** | 抽到 `backend/prompts/*.md` 集中管理，學長改不用碰 Python；重啟 backend 即生效 |
| **「為什麼用 EDU 不用句子？」** | EDU = elementary discourse unit，是 RST/argument mining 的標準切分單位（Mann & Thompson 1988） |
| **「Confidence 分數是怎麼來的？」** | LLM 自評 0-1，schema 強制輸出；在 `/stats` 可驗證高 confidence 是否真的高 precision（Q4.2 SQL） |
| **「論文資料集從哪來？」** | 短期自建 ThesisCheck-zh-50（學長標 50 篇），長期可加 PeerRead/AAEC 做 generalization |

---

## 附錄 C: 關鍵檔案位置速查

| 看什麼 | 檔案 |
|---|---|
| 完整系統設計 | [docs/SYSTEM.md](SYSTEM.md) |
| 待辦事項管理 | [docs/TODO.md](TODO.md) |
| 13 條規則 (含 Cypher candidate query) | [backend/rules.yaml](../backend/rules.yaml) |
| Pipeline 主流程 | [backend/app/pipeline.py](../backend/app/pipeline.py) |
| 規則檢核 + Phase 2 + cross-section | [backend/app/rules.py](../backend/app/rules.py) |
| 聊天 Guardrails | [backend/app/chat.py](../backend/app/chat.py) |
| SQLite layer | [backend/app/db.py](../backend/app/db.py) |
| Prompts 集中目錄 | [backend/prompts/](../backend/prompts/) |
| 結果頁前端 | [frontend/components/result-view.tsx](../frontend/components/result-view.tsx) |
| 規則統計頁 | [frontend/app/stats/page.tsx](../frontend/app/stats/page.tsx) |
