# 論文檢核系統 v3 — 系統說明文件

> 本文件是給研究團隊與後續維護者看的設計說明，包含系統目的、技術架構、操作方式、知識圖譜語意，以及未來方向。

---

## 1. 系統目的

學術論文初稿常見三類「結構性」問題：

1. **主張無證據** — 寫了「我們的方法效果最好」但沒提供數據或對照
2. **缺乏動機** — 直接給方法但沒說明為什麼這個問題重要
3. **跨章節失聯** — Conclusion 講的東西 Introduction 沒鋪陳，或方法沒對應問題

這些問題傳統上靠人工 review 抓，慢且主觀。本系統的目標是：

> 上傳一篇論文 → 自動找出邏輯結構性缺陷 → 給出修改建議

我們不做 grammar 檢查（已有 Grammarly 等工具），不做引用格式檢查（已有 Zotero 等），**只專注在論證結構與邏輯**。

### 跟「直接問 ChatGPT 幫我改論文」差在哪？

| | 純 LLM 對話 | 本系統 |
|---|---|---|
| 結果可重現 | ❌ 每次答案不同 | ✅ KG + 規則確定性 |
| 能追溯到原文位置 | ❌ 描述模糊 | ✅ 高亮 PDF 上具體句子 |
| 規則可由人維護 | ❌ 黑盒 | ✅ 規則寫在 YAML，學長可改 |
| 跨論文比較 | ❌ | ✅ KG 持久化於 Neo4j |
| 投論文有方法論支撐 | ❌ | ✅ Symbolic + Neural 結合（見參考文獻） |

---

## 2. 功能說明

| 功能 | 說明 |
|---|---|
| **PDF / TXT 上傳** | 支援中英論文，PDF 會以 PyMuPDF 抽取文字並保留座標 |
| **進度回報** | 上傳後即時顯示「抽 EDU → 抽 ER → 標 RST/FRU → 規則檢核」進度 |
| **缺陷檢測** | 自動套用 13 條 REL 規則，列出嚴重度（高/中/低）與所屬章節 |
| **修改建議** | 每個缺陷附原文證據句、缺陷說明、與具體修改方向 |
| **PDF 視覺化** | 點缺陷 → PDF 自動 scroll + 高亮對應段落；點 PDF 高亮 → 反向選缺陷 |
| **Knowledge Graph 視覺化** | 用 React Flow 渲染論文的 Entity 圖與 FRU 修辭結構圖 |
| **CSV 報告匯出** | 類似資安弱掃報告，含原文、嚴重度、建議，可給指導老師 |
| **上傳快取** | 同一份檔案再次上傳秒回，不重新呼叫 LLM（永久有效，重啟後仍生效） |
| **歷史頁** | 列出所有分析過的論文（SQLite 持久化） |
| **學長判定 (Human-as-judge)** | 每個缺陷三個按鈕（✅判對 / 🤔部分對 / ❌誤判），即時存 SQLite，累積評估資料 |
| **成本即時顯示** | 結果頁 header 標 `$X.XXX`，全域 `/api/cost` 統計每階段花費 |

---

## 3. 技術說明

### 3.1 整體架構

```mermaid
flowchart LR
    User[使用者] -->|上傳 PDF| Frontend
    Frontend[Next.js 16<br/>+ Tailwind 4<br/>+ shadcn/ui] -->|HTTP/JSON| Backend
    Backend[FastAPI + Python] -->|抽取 / 判讀| Claude[Claude API]
    Backend -->|KG 結構| Neo4j[(Neo4j<br/>Knowledge Graph)]
    Backend -->|metadata / results /<br/>cost log / judgments| SQLite[(SQLite<br/>data.db)]
    Backend -->|PDF 原檔| Disk[backend/uploads]
    Frontend -->|渲染 + 標註| User
```

### 3.2 處理流程（時序圖）

```mermaid
sequenceDiagram
    participant U as 使用者
    participant F as 前端
    participant B as 後端
    participant L as Claude
    participant N as Neo4j

    U->>F: 上傳 PDF
    F->>B: POST /api/upload
    B->>B: 計算 SHA-256
    alt 快取命中
        B-->>F: 直接回傳 paper_id (status=done)
    else 全新檔案
        B->>B: PyMuPDF 抽 spans (含 page+bbox)
        B->>B: heuristic 切章節
        loop 每個章節
            B->>L: 切 EDU (Sonnet)
            B->>L: 抽 Entity + Relation (Sonnet)
            B->>L: 標 RST + FRU (Opus)
        end
        B->>N: 寫入 Knowledge Graph
        loop 13 條 REL 規則
            B->>N: 執行 Cypher 撈候選子圖
            B->>L: 判讀候選 → 是否違規 + 建議 (Opus)
        end
        B-->>F: 回傳 paper_id
    end
    F->>B: GET /api/papers/{id}/result
    B-->>F: 缺陷清單 + KG 摘要
    F->>U: 顯示 PDF + 高亮 + 缺陷面板
```

### 3.3 為什麼不直接全文丟給 LLM 找問題？

技術上 Claude 的 context 夠（200K tokens 容得下整篇論文），但這樣做有三個缺點：

1. **不可重現** — 同樣的論文跑兩次答案可能不同，沒法做學術 evaluation
2. **沒有結構支撐** — LLM 隨意輸出哪邊有問題，無法保證涵蓋所有規則
3. **論文賣點消失** — 學長要強調的是「**Symbolic 約束 LLM**」，不是「LLM 自由發揮」

所以採用**先建結構、再規則檢核**的兩階段做法：

```mermaid
flowchart TD
    Stage1[階段 1: 神經抽取<br/>用 LLM 把非結構化文字<br/>變成結構化的 KG]
    Stage2[階段 2: 符號檢核<br/>用確定性的 Cypher 查詢<br/>套到 KG 上]
    Stage3[階段 3: LLM 判讀<br/>對 Cypher 撈出的候選<br/>做最終語意判斷]
    Stage1 --> Stage2 --> Stage3
```

這對應學界正在發展的 **Neurosymbolic AI**（神經 + 符號）方向（Garcez & Lamb, 2023；Pan et al., 2024）。

### 3.4 技術棧

| 層 | 技術 |
|---|---|
| 前端 | Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS 4 · shadcn/ui · React Flow · react-pdf · sonner |
| 後端 | Python 3.11+ · FastAPI · Pydantic v2 · PyMuPDF · rapidfuzz |
| LLM | Anthropic Claude API（Opus 4.7 / Sonnet 4.6 / Haiku 4.5） |
| 知識圖譜 | Neo4j 5.26 (Community) · Cypher |
| 持久化 | SQLite (stdlib `sqlite3`)：metadata、results、hash 快取、LLM 成本 log、人工判定 |
| 容器化 | Docker Compose（用於 Neo4j） |

### 3.5 資料持久化分工

三個層各管一塊，**不重疊**：

| 儲存層 | 內容 | 重啟後 |
|---|---|---|
| **Neo4j** | 五種節點與邊（`Paper / EDU / Entity / FRU / RST` + 邊）— 用於 Cypher 候選查詢 | 持久（Docker volume） |
| **SQLite** (`backend/data.db`) | `papers`（含 content_hash、pdf_path）· `results`（完整 JSON）· `llm_calls`（每次呼叫的 token / cost）· `defect_judgments`（學長 ✅/🤔/❌ 標註） | 持久 |
| **本地磁碟** (`backend/uploads/`) | PDF 原檔，檔名以 `paper_id` 為 key | 持久 |
| In-memory `_jobs` dict | 分析中的 job 進度（`queued`/`extracting`/`checking`） | 重啟丟失（無關緊要） |

設計準則：
- **結構性資料進 Neo4j**（給 Cypher 用）
- **流水/分析資料進 SQLite**（給統計、cache、評估用）
- **二進位檔案進磁碟**（給 frontend 拉回顯示）

---

## 4. 操作說明

### 4.1 啟動三個服務

需要三個 terminal：

**Terminal 1 — Neo4j：**
```bash
docker compose up -d
# Neo4j Browser: http://localhost:7474 (帳號 neo4j / 密碼 thesis_demo_pw)
```

**Terminal 2 — Backend：**
```bash
cd backend
source .venv/bin/activate
uvicorn main:app --reload --reload-dir app
# → http://localhost:8000
```

**Terminal 3 — Frontend：**
```bash
cd frontend
npm run dev
# → http://localhost:3000
```

### 4.2 使用流程

```mermaid
flowchart LR
    A[上傳論文 PDF] --> B[等待分析<br/>1-10 分鐘]
    B --> C[結果頁: PDF + 缺陷面板]
    C --> D{需要做什麼?}
    D -->|看缺陷| C
    D -->|看 KG 結構| E[Knowledge Graph 頁]
    D -->|匯出報告| F[下載 CSV]
    D -->|看歷史| G[歷史頁]
```

### 4.3 結果頁互動

- **點缺陷卡片** → PDF 自動跳到該頁，高亮對應段落
- **點 PDF 上的高亮** → 反向選中對應的缺陷
- **嚴重度顏色**：高 = 紅、中 = 橘、低 = 黃
- **下載 CSV** → 含原文 + 缺陷類型 + 建議的試算表（UTF-8 BOM，Excel 開繁中正常）

---

## 5. Knowledge Graph 語意說明

### 5.1 五種節點

| 節點 | 代表什麼 | 從哪來 |
|---|---|---|
| `Paper` | 論文本身 | 上傳時建立 |
| `EDU` | Elementary Discourse Unit，最小論述單位（一個子句、一個命題） | LLM 切分 |
| `Entity` | 概念實體（方法名、資料集、評估指標等） | LLM 抽取 |
| `FRU` | Functional Rhetorical Unit，由連續 EDU 組成的「修辭功能單元」 | LLM 標註 |
| `RST` | Rhetorical Structure 修辭關係（Nucleus + Satellite + 關係類型） | LLM 標註 |

### 5.2 五種邊

| 邊 | From → To | 意義 |
|---|---|---|
| `HAS_EDU` | Paper → EDU | 論文擁有的所有 EDU |
| `COVERS` | FRU → EDU | 一個 FRU 涵蓋哪幾個 EDU |
| `NUCLEUS` | RST → EDU | 修辭結構的核心 EDU |
| `SATELLITE` | RST → EDU | 修辭結構的衛星 EDU |
| `ER` | Entity → Entity | 兩個實體間的關係（如 proposes、outperforms） |
| `MENTIONED_IN` | Entity → EDU | 實體在哪個 EDU 裡被提到 |

### 5.3 KG Schema

```mermaid
graph TB
    Paper((Paper)) -->|HAS_EDU| EDU[(EDU)]
    FRU{{FRU}} -->|COVERS| EDU
    RST[/RST/] -->|NUCLEUS| EDU
    RST -->|SATELLITE| EDU
    Ent1((Entity)) -->|ER<br/>proposes / outperforms / ...| Ent2((Entity))
    Ent1 -->|MENTIONED_IN| EDU
```

### 5.4 13 條 REL 規則對應的 KG 模式

每條規則本質上是一個「**KG 上的 anti-pattern**」 — 找出符合特定結構的子圖，那就是缺陷候選。

| 規則 | KG 上要找什麼 |
|---|---|
| REL-01 Claim-Evidence | `FRU(function=Claim)` 但沒有對應的 `FRU(function=Evidence)` |
| REL-03 Action-Justification | `FRU(function=MethodStep)` 但沒有對應的 `Motivation` FRU |
| REL-09 Observation-Attribution | `FRU(function=Observation)` 但沒有 `Attribution` FRU 配對 |
| REL-10 Concession-Compensation | `FRU(function=Concession)` 但沒有 `Compensation` FRU |
| REL-12 Core-Restatement | Abstract / Conclusion EDU 文字相似度比對 |
| ...（其他 8 條） | 見 [backend/rules.yaml](../backend/rules.yaml) |

完整 13 條規則的 description 與 Cypher 候選查詢，請看 [backend/rules.yaml](../backend/rules.yaml)。這是學長 MECE 收斂自 51 條章節分層規則的成果。

### 5.5 一個具體例子

論文裡寫：

> 「To the best of our knowledge, the Transformer is the first transduction model relying entirely on self-attention.」

系統處理流程：

```mermaid
flowchart TB
    Sentence["原句:<br/>'Transformer is the first<br/>transduction model relying<br/>entirely on self-attention'"]
    Sentence -->|EDU 切分| EDU1[EDU: 一個論述單位]
    EDU1 -->|FRU 標註| FRU1["FRU function=Claim<br/>(這是個主張)"]
    EDU1 -->|ER 抽取| ER["Entity: Transformer<br/>predicate: is_first<br/>Entity: transduction model"]
    FRU1 -->|REL-01 Cypher 檢查| Check{"有對應的<br/>Evidence FRU 嗎?"}
    Check -->|沒有| Defect["Defect: NakedClaim<br/>建議: 引用 [17,18,9]<br/>說明為何首創"]
```

→ 缺陷面板出現「REL-01 NakedClaim」並指回原句。

---

## 6. 未來展望

### ✅ 已完成

- **後端 SQLite 持久化** — 重啟仍保留歷史與 hash 快取
- **Token / cost logger** — 每篇成本即時顯示，全域統計可查
- **Human-as-judge 標註介面** — 每個缺陷可標 ✅/🤔/❌，累積評估資料

### 短期（1-2 週）

- **Prompt 集中化**：把 prompts 從 Python 抽到 `backend/prompts/*.md`，學長可在不寫 code 的情況下調整
- **缺陷分組摺疊**：相同規則的缺陷可摺疊顯示，UI 更乾淨
- **規則命中分布頁** `/stats`：跑完幾篇後看哪些規則最常觸發、哪些從沒觸發 → 找出規則設計盲點

### 中期（1 個月）

- **跨章節驗證 second pass**：跑完現有切段流程後，多一次「全文摘要 + 所有 FRU」的 Opus 1M context 檢查，補強 REL-04/08/12 等跨章節規則
- **LLM Confidence 分數**：每個缺陷帶 0-1 信心分，前端顯示星星
- **Pre-annotation 評估工具**：學長預先標 ground truth，系統自動算 Precision / Recall / F1（搭配既有 judgments 表延伸）
- **規則迭代回饋迴路**：根據 `/api/judgments/summary` 的 per-rule precision，自動建議低於 threshold 的規則需要 review

### 長期（投論文前）

- **Hybrid Local + Cloud**：EDU/ER 用 Ollama (Qwen 2.5 32B) 本地跑，RST/FRU + 規則判讀用 Claude，成本降 60%
- **Batch API 整合**：跑大規模 benchmark 時用 Anthropic Batch API（50% 折扣）
- **跨論文 Entity 對齊**：同一個 method（如 Transformer）在多篇論文間對齊，做引用網絡分析
- **規則命中分布頁**：展示 13 條規則在歷史論文上的觸發頻率，找出規則設計的盲點

---

## 7. 參考文獻（理論支撐）

本系統的方法論基礎：

1. **Mann, W. C., & Thompson, S. A. (1988).** *Rhetorical Structure Theory: Toward a functional theory of text organization.* Text, 8(3), 243-281.
   → RST 修辭結構理論的奠基論文，本系統的 RST 標註層直接源自此

2. **Swales, J. M. (1990).** *Genre Analysis: English in Academic and Research Settings.* Cambridge University Press.
   → 提出 IMRD 學術論文結構與 CARS 動機模型，影響本系統 13 條規則的章節分層

3. **Carlson, L., Marcu, D., & Okurowski, M. E. (2001).** *Building a discourse-tagged corpus in the framework of Rhetorical Structure Theory.* Proceedings of the 2nd SIGdial Workshop.
   → RST Discourse Treebank（RST-DT），未來用作標註品質 benchmark 的金標準

4. **Pan, S., Luo, L., Wang, Y., Chen, C., Wang, J., & Wu, X. (2024).** *Unifying Large Language Models and Knowledge Graphs: A Roadmap.* IEEE Transactions on Knowledge and Data Engineering.
   → 統整 LLM + KG 的最新研究方向，本系統「KG 約束 LLM」的設計符合該 roadmap 的 LLM-augmented KGs 範式

5. **Garcez, A. d., & Lamb, L. C. (2023).** *Neurosymbolic AI: The 3rd Wave.* Artificial Intelligence Review, 56, 12387-12406.
   → 神經 + 符號結合的方法論依據

6. **志祥學長（2025+，內部研究）** — 13 條 REL 全域通用規則的 MECE 收斂方法（從 51 條章節分層規則合併），尚未發表

---

## 8. 名詞速查

| 縮寫 | 全稱 | 一句話解釋 |
|---|---|---|
| EDU | Elementary Discourse Unit | 最小論述單位，通常是一個子句 |
| ER | Entity-Relation | 實體與實體間的關係（三元組） |
| RST | Rhetorical Structure Theory | 修辭結構理論，描述子句間的功能關係 |
| FRU | Functional Rhetorical Unit | 功能修辭單元，由連續 EDU 組成的「這段在幹嘛」單位 |
| KG | Knowledge Graph | 知識圖譜，由節點與邊組成的結構化知識 |
| MECE | Mutually Exclusive, Collectively Exhaustive | 互斥且窮盡，麥肯錫的分類原則 |
| REL | Rule | 本系統 13 條規則的命名前綴（REL-01 ~ REL-13） |
| LLM | Large Language Model | 大型語言模型（如 Claude） |

---

## 9. 範例：對中文社科碩論的分析

以下是手動模擬系統對一份 2019 長庚大學資管所碩士論文（主題：心流與使用滿足對 Instagram 持續使用意圖的影響，量化問卷研究）的判讀，示範 13 條 REL 規則在**社科量化論文**這個 domain 上的觸發樣態。

### 觸發的缺陷（8 個）

#### REL-08 ProblemSolutionMismatch · **高嚴重** · Intro vs Results

§1.2 提出三個研究問題。但 §4.4.3 結果：H1 的 5 條子假說只有 1 條成立。研究問題 1（影響持續使用意圖的動機為何？）等於沒被直接回答 — 預測的 4 個動機沒有直接影響持續使用意圖（雖然透過心流間接影響）。

**建議**：在 Intro 末或 Discussion 開頭明確重新框架「直接 vs 間接效果」的差異。

#### REL-01 NakedClaim · **中嚴重** · Introduction

> 「Instagram 是一個進步快速的社群媒體平台，近年來增加了大量使用者 (Sheldon et al., 2017)」

僅引用一篇關於克羅埃西亞的跨文化研究就推論到「台灣勢必有一席之地」。從異國研究跳到本地場景缺乏直接證據。

#### REL-03 MissingMotivation · **中嚴重** · Method

「在台灣居住時數 5 年到 10 年…其餘 5 年以下的居住年限，本研究判定為無效問卷。」**為什麼是 5 年**？沒有說明。這是 inclusion criteria 的核心，需要 motivation。

#### REL-09 ObservationWithoutAttribution · **中嚴重** · Discussion

4 條 H1 假說被拒，事後歸因為「使用後達到滿足立即關掉」— 但研究**未測量**使用後行為，只引一篇 Guo et al. 支撐。post-hoc speculation 須明確標記。

#### REL-09 ObservationWithoutAttribution · **中嚴重** · Discussion

H3-2（自我呈現）失敗的歸因再次依賴單一引用 + 後設解釋。質性訪談（MD006）反而支持自我呈現很重要，量化與質性結果衝突沒被處理。

#### REL-12 ConclusionMisaligned · **中嚴重** · Abstract vs Results

Abstract 寫「使用動機及持續使用意圖均有受到心流之影響」— 口吻比資料支持的更樂觀，沒提到 4/5 直接路徑都不顯著。

#### REL-02 BaselineNotCritiqued · **低嚴重** · Literature Review

引用 Bhattacherjee (2001) ECM 但沒做為 baseline 比較，沒解釋為何不用 ECM 而用 SOR + 使用與滿足。

#### REL-10 UncompensatedConcession · **低嚴重** · Limitations

§5.2 限制三條，沒提到「橫斷面設計無法證明因果」這個量化研究最大限制 — 但全文用「影響」一詞論述。

### 沒觸發或表現好的規則

| 規則 | 為什麼沒觸發 |
|---|---|
| REL-04 Macro-Decomposition | Intro 有清楚的問題拆解 |
| REL-05 Process-Sequence | Method 步驟清楚（深訪 → 前測 → 正式問卷）|
| REL-06 Concept-Formalization | 每個 construct 都有概念型定義表 |
| REL-07 Setup-Scoping | 樣本/工具/時程詳述 |
| REL-11 Specific-Generalization | 質性個案 → 量化驗證設計平衡 |
| REL-13 Meta-Discourse | 章節導引充足 |

### 從這個範例看到的 v3 系統限制

跑這次模擬讓我發現幾個未來要強化的方向：

1. **Domain-specific rule packs**：量化社科論文的失準型態（假說大量失敗 → 後設解釋）跟 NLP/CS 論文（Transformer 那種）很不同。`rules.yaml` 未來應分 domain 變體。
2. **跨章節對齊（REL-08, REL-12）是高價值規則**，但目前 Cypher 候選太弱（只比文字相似度）— 這是「whole-paper second pass」優先要補強的部分。
3. **Post-hoc speculation 偵測**（REL-09 變體）— 量化研究最常見的學術瑕疵，但目前規則描述偏一般化，可以針對「假說失敗 + 單一引用解釋」這個 pattern 強化 Cypher。

---

## 10. 工程經驗紀錄（已踩過的坑）

> 此區記錄迭代過程中得到的非顯而易見決策，避免後人重踩。

### 10.1 模型選擇：Opus → Sonnet → Sonnet+Haiku → Sonnet（最終）

跑了三輪實驗：

| 配置 | EDU 數（同一篇） | 缺陷數 | 單篇成本 | 結果 |
|---|---|---|---|---|
| Opus heavy + Sonnet light | 311 | 4 | ~$3 | 品質感覺好但成本高 |
| Sonnet heavy + Haiku light | **194** ↓38% | 16 | ~$0.4 | EDU 粒度違反定義 — 拒絕 |
| **Sonnet heavy + Sonnet light** | ~300 | TBD | ~$0.55 | 採用 |

**關鍵教訓**：
- **EDU 切分不能省**。Haiku 把多個命題合成一個 EDU，違反 "elementary" 定義，會 cascade 弄壞下游所有 FRU/RST 標註。
- **規則判讀 Sonnet 比 Opus 更積極**（同候選輸出更多 verdict=violates）。沒有 ground truth 時不能說誰對，但實作上應該配合 Human-as-judge 累積資料再決定。
- **不要為了「看起來省錢」就把每階段都用最便宜的模型** — 結構性步驟出錯成本不可逆。

### 10.2 規則迭代：REL-09 從「全篇 boolean」改 proximity 檢查

原版 Cypher 的 `WHERE NOT EXISTS { MATCH (a:FRU {function: 'Attribution'}) }` 實際語意是「全文有沒有任何 Attribution」。導致：

- 全篇 0 個 Attribution → **所有** Observation 全被丟給 LLM 判
- 全篇 1 個 Attribution → **沒有任何** Observation 被丟出（明顯錯）

改成「同章節、order 鄰近 [obs_start - 3, obs_end + 8] 內檢查」，外加 description 加保守原則指令。預期 false positive 從 ~12 降到 ~5。

**通則**：每條 REL 規則的 Cypher 都要回答「同篇內、哪個範圍內」是合理的搜尋邊界，不是 paper-wide boolean。

### 10.3 SQLite vs in-memory dict — 看似能延後的 refactor 其實阻擋很多事

最初 `_paper_results / _hash_to_paper_id / _paper_files` 都用 in-memory dict，一切看起來「dev 階段先這樣」。但很快遇到三個問題同時湧現：
1. 重啟丟失分析結果，每次都要重跑（昂貴）
2. Hash 快取失效，無法做永久去重
3. 沒地方存 cost log → 沒辦法回答「這篇花多少錢」

加 SQLite 後三件事一次解掉，且為 Human-as-judge 留好桌位（`defect_judgments` 表）。**結論：當 in-memory state 開始綁定 user-visible 行為時，立刻換 SQLite，不要拖。**

---

*文件版本：v2（2026-05-09）*
*維護者：實驗室 thesis-llm 團隊*
