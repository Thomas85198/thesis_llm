# 專案管理 / TODO

> 最後更新：2026-05-10
> 用途：列出 v3 已完成的主幹之外、還欠的工程與決策。每天如果有進度就把對應條目劃掉或更新。
> 架構與設計細節在 [SYSTEM.md](SYSTEM.md)，這份只放「還沒做的事」。

---

## 0. 最近完成

### 2026-05-10 — 論文助手聊天抽屜 ✅

- 後端 [backend/app/chat.py](../backend/app/chat.py)：context 組裝（整篇 EDU + defects + 13 規則 + prompt cache）+ Guardrails（scope refuse、強制 cite、injection 偵測、rate limit 15/min、輸入 cap 2000 字、history cap 10 turns）
- 後端 endpoint：`POST /api/papers/{id}/chat`（429 → rate limit / 400 → validation / 409 → 分析未完成）
- 前端 [frontend/components/chat-drawer.tsx](../frontend/components/chat-drawer.tsx)：右下浮動按鈕 + Sheet 抽屜，`[EDU:xxx]` / `[DEFECT:xxx]` 自動 parse 成可點 chip → 跳 PDF/缺陷面板
- LLM 用 Sonnet（chat 夠用，比 Opus 便宜 5x），單次 ~$0.001-0.003 USD（cache hit 後）

---

## 1. 立即優先：Phase 2 — Judgment → LLM 回饋迴路

**狀態**：尚未開工。**這是現在閉合人工標註迴路的關鍵一步。**

**目的**：讓學長標的「✅ 判對 / 🤔 部分對 / ❌ 誤判」自動成為下次同規則檢核的 few-shot examples，迴路才會閉合。目前 SQLite 已經存了，但 LLM 不會去讀。

### 動作清單

- [ ] `backend/app/db.py` 加 `get_judgment_examples(rule_id: str, limit: int = 4)` — 撈該規則最近 N 筆 `correct` + N 筆 `wrong`，回傳 `{defect_text, evidence_texts, verdict, note}`
- [ ] `backend/app/rules.py` 在 `check_rule()` 組 system prompt 時自動 inject 範例段（格式：「以下是學長過去對此規則的判定範例，請學習：...」）
- [ ] `backend/app/rules.py` 同步把 example_count 寫到回傳的 result，傳到前端
- [ ] `frontend/components/result-view.tsx` header 加 badge「⚙️ 此次參考 N 筆學長判定」
- [ ] 邊界處理：判定 < 3 筆時不 inject（避免 over-fit），> 8 筆時取最新 + 最有代表性的（先用最新）
- [ ] 跑回歸：對同一篇論文 before/after，看 defect 數量與內容是否變化合理

**工程量**：半天（不含跑回歸實驗）
**前置條件**：學長至少標 ~10-20 個 defect 才有意義；建議**今天起在 result 頁邊用邊標**，累積樣本

### 為什麼是最高優先

1. SQLite 紀錄已經建好但沒接上 LLM — 工程上是「線斷在最後一哩」
2. 有了這條迴路才能寫論文 ablation：with/without few-shot → precision 差異
3. 也才能解釋 demo 中「為什麼這個系統會越用越準」

---

## 2. 短期（1-2 週）

| 任務 | 優先 | 工程量 | 說明 |
|---|---|---|---|
| Prompt 集中化到 `backend/prompts/*.md` | ⭐⭐ | 2 hr | 學長能直接改 prompt 不用碰 Python |
| 規則命中分布頁 `/stats` | ⭐⭐ | 半天 | 哪幾條從沒觸發、哪幾條 over-fire；接到 SQLite 統計 |
| 跨章節 second pass | ⭐⭐ | 半天 | Opus 4.7 1M context 補強 REL-04/REL-08/REL-12（這幾條本來就需要跨章節推理） |
| LLM Confidence 分數 | ⭐ | 2 hr | 每個缺陷帶 0-1 信心分，前端用透明度或數字呈現 |
| 缺陷依規則分組顯示 | ⭐ | 1 hr | DefectPanel 可切「按 severity / 按 rule_id」分組 |

---

## 3. 中期（1 個月）

### 3.1 Pre-annotation 評估工具 + F1

把 SQLite 已累積的 judgments 當 ground truth，自動算 per-rule F1：

- 把每筆 defect 視為一個預測；judgment 為 `correct` → TP，`wrong` → FP，`partial` → 0.5 TP + 0.5 FP
- Recall 算不出來（沒有「漏掉的 defect」標註），但 **precision 是真實的**
- 配合 Phase 2 做 A/B：with/without few-shot → precision 變化

### 3.2 規則迭代回饋迴路

- F1（precision）< 0.5 的規則自動標紅，前端 `/stats` 頁顯示
- 提示學長：「REL-XX 在 25 筆中只有 8 筆判對，建議重寫 Cypher 或 description」
- 終局：學長維護 13 條規則 + LLM 自動學會邊界 → 規則本身越來越穩

---

## 4. 長期 / 戰略性

| 項目 | 動機 |
|---|---|
| Hybrid Local + Cloud | EDU/ER 用 Ollama (M1 Max 64GB 跑 Qwen2.5-72B 可行)，RST/規則用 Cloud；省 70% cost |
| Anthropic Batch API | 51 篇實驗一次跑省 50%；async 設計需要改 |
| 跨論文 Entity 對齊 | 同一作者多篇連動；對於畢業論文系列特別有用 |
| Multi-agent (Claim / Evidence / Critic) | 比單 prompt 細分職責，但工程複雜度高，需 demo 先撐住 |

---

## 5. UX polish (cheap wins)

- [ ] PDF 縮圖 navigation（左側欄）
- [ ] 缺陷卡片支援 inline edit 修改建議
- [ ] 批次刪除已上傳論文（目前要一篇一篇）
- [ ] 缺陷 hover 顯示完整 evidence text（目前 line-clamp-3 截斷）
- [ ] KG 視覺化加 minimap

---

## 6. Benchmark / 自動評估討論

### 6.1 問題

人工判定（學長標）成本高、收斂慢。**有沒有公開資料集可以直接跑、自動算正確率？**

### 6.2 已知相關資料集

| 資料集 | 任務 | 與我們的契合度 | 評論 |
|---|---|---|---|
| **PeerRead** (Kang et al. NAACL 2018) | 論文 + reviews + accept/reject 標註 | ★★☆☆☆ | 可看「我們系統的缺陷數是否與 reject 機率正相關」，但不是 per-defect ground truth |
| **AAEC** (Stab & Gurevych CL 2017) | 402 篇學生論文 + argument 結構標註（major-claim / claim / premise / support） | ★★★☆☆ | 可對映 REL-01 (Claim-Evidence) / REL-02 (Action-Justification) 的精神，是 essay 不是 thesis |
| **AbstRCT** (Mayer et al. ECAI 2020) | 醫學摘要的 argument mining | ★★☆☆☆ | Domain 完全不同，但 schema 接近 |
| **Logical Fallacy Detection** (Jin et al. EMNLP 2022) | 13 種邏輯謬誤分類資料集 | ★★★☆☆ | 與 REL 精神接近，但是句級分類非結構檢核 |
| **F1000Research / OpenReview reviews** | 公開 review + paper | ★★☆☆☆ | 弱 ground truth：只能看「review 提到的問題」是否被我們抓到 |
| **SciFact / SciFact-Open** | 摘要 + 事實核對 | ★☆☆☆☆ | 偏 factuality，不是邏輯結構 |
| **Persuasive Essays Corpus** (Stab & Gurevych 2014) | 早期版 AAEC | ★★☆☆☆ | 已被 AAEC 取代 |

### 6.3 結論（誠實版）

**沒有完全對映 13 條 REL 規則 + thesis 結構的公開資料集。** 原因：

1. 13 條 REL 是志祥學長從 51 條章節分層規則 MECE 收斂的，**非通用 taxonomy**
2. 多數 argument mining 資料集都是「essay / abstract」，不是完整 thesis 結構
3. 「邏輯缺陷」標註本身就是研究級難題，沒有大規模公開資料
4. 中文學術論文資料集更稀少

### 6.4 可行的 proxy benchmark（如果還是要跑）

| 路線 | 做法 | 工程量 | 產出強度 |
|---|---|---|---|
| **A. PeerRead 對齊** | 跑 100 篇 PeerRead → 統計 reject 篇平均缺陷數 vs accept 篇 | 1-2 天 | 弱（只能說「我們的 score 與接受機率有相關」） |
| **B. AAEC 部分對映** | 把 REL-01 / REL-02 接到 AAEC claim/premise 標註，算 per-rule precision | 2-3 天 | 中（但只覆蓋 2/13 條規則） |
| **C. 論文 abstract proxy** | 收 50 高被引 + 50 低被引，比對「缺陷數」分布 | 2 天 | 弱（noisy） |
| **D. 自建小型 benchmark** | 學長標 10-20 篇（anyway 要做的）| 0 額外（已在做）| 高（內部 ground truth） |

### 6.5 建議

**短期不跑 public benchmark，直接做 Phase 2 + 累積 judgments**。理由：

- 跑 PeerRead/AAEC 工程量 1-2 天，**但結果只是 proxy 信號**（不是真的「我們對」）
- 學長標 10-20 篇 + Phase 2 閉迴路，這個證據對論文 / demo 更直接，也對得起 13 條規則的 specificity
- 等手上 SQLite 有 50+ judgments 時再回頭做 benchmark，那時 ground truth 才夠

**中期 sweet spot**：把 SQLite 累積的 judgments 包成內部 benchmark（暫稱 **ThesisCheck-zh-50**），配合 Phase 2 後做 ablation：

- with vs without few-shot judgments → precision 差異
- **這個就是論文的 main result**，比跑 PeerRead 強

**如果學長想做為論文評估章節用**：建議 D + B 組合 — 自建 50 篇做 main eval，AAEC 跑 REL-01/REL-02 做 generalization argument。

---

## 7. 開放問題（明天討論）

- [ ] 學長那邊願不願意一週內標 10-20 篇？（標的 UI 已做好）
- [ ] Phase 2 的 example 是 per-rule 累積還是全域？per-rule 比較精準但需要每條規則都有樣本
- [ ] 要不要先做 `/stats` 頁讓學長看到「哪幾條規則他從沒判過」，引導他標
- [ ] benchmark 是否真的進論文，還是 demo 用就好（影響工程投資）
