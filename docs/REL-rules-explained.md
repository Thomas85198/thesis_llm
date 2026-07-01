# REL 規則：怎麼寫、怎麼維護（給老師的說明）

> **一句話**：13 條規則用 **YAML 資料檔**定義（不寫死在程式），每條走 **「Cypher 撈候選 → LLM 判讀」的 neuro-symbolic 兩階段**。要新增/改規則，原則上**只改 YAML 一個檔，不動 Python**。

---

## 1. 規則從哪來（來源與收斂）

- 志祥學長原本有 **51 條章節層級規則**，MECE 收斂成 **13 條全域通用 REL 規則**（REL-01 ~ REL-13）。
- 規則的「精確語意」由學長維護；工程端負責把它**機器可執行化**。
- 規則檢的不是錯字/文法，而是**論文的結構性論證缺陷**（裸主張、baseline 未批判、概念未形式化、結論偏移…）。

---

## 2. 規則長什麼樣（定義格式）

全部規則集中在一個檔：**`backend/rules.yaml`**。每條規則固定 5 個欄位：

```yaml
- id: REL-01                      # 規則編號
  name: Claim-Evidence            # 規則名稱
  description: |                  # 白話描述 → 直接餵給 LLM 當判讀準則
    每個主張(Claim)都應有證據(Evidence)支撐…孤立無支撐的主張是缺陷。
  candidate_query: |              # Cypher：從 KG 撈「可能違規」的候選子圖
    MATCH (f:FRU {paper_id:$pid, function:'Claim'})
    WHERE NOT EXISTS { ...有沒有對應的 Evidence... }
    RETURN f.id AS fru_id, f.summary AS summary, [...] AS edu_ids, ...
  defect_label: NakedClaim        # 違規時記的缺陷型態標籤
```

- **`description`** = 給「神經層（LLM）」的判讀準則（白話）。
- **`candidate_query`** = 給「符號層（Neo4j）」的撈候選邏輯（精確）。
- **`defect_label`** = 違規時對應到老師舉的缺陷型態。

---

## 3. 一條規則怎麼跑（neuro-symbolic 兩階段）

```
            符號層（精確、可重現）            神經層（語意判讀）
 KG ──Cypher candidate_query──▶ 候選子圖清單 ──LLM(checker prompt)──▶ 逐候選 verdict
 (Neo4j)   撈「可能違規」的點         (含原文 EDU)      判 violates? + 說明/建議
```

1. **撈候選（Cypher / 符號）**：`candidate_query` 用 KG 結構把「**有嫌疑**」的子圖撈出來（例：所有「沒有對應 Evidence 的 Claim」）。這步是**確定性、可重現**的。
2. **判讀（LLM / 神經）**：把候選 + 原文丟給 LLM（`prompts/checker.md`），**逐候選**決定真的違規嗎，違規才寫嚴重度、證據 EDU、中文說明與修改建議。
3. **為何要兩階段**：Cypher 負責「**降召回成本**」（不必每句都問 LLM）、LLM 負責「**語意判斷**」（結構撈得出嫌疑，但真假要讀懂內容）。這就是**符號規則 + 神經判讀**的混合架構。

> 設計刻意「**寧可放過、不要誤報**」：checker prompt 要求保守、附 confidence（<0.3 直接不報），避免假陽性淹沒使用者。

---

## 4. 候選怎麼撈（三種規則型態）

13 條依「撈候選的對象」分三型，這決定了 Cypher 怎麼寫：

| 型態 | 撈什麼 | 規則 |
|---|---|---|
| **FRU 功能型** | 某功能的 FRU 缺對應功能（Claim 缺 Evidence…） | REL-01/03/09/10/11/13 |
| **Entity 型** | 某類實體的描述（baseline、Concept/Metric…） | REL-02/06 |
| **章節/全篇結構型** | 整篇或某章節的結構是否完整 | REL-04/05/07/08/12 |

---

## 5. 跨章節第二階段（cross-section pass）

- 有些規則要**同時看兩個章節**才能判（例：Conclusion 有沒有重述 Introduction 的核心）。逐章節的 Cypher 候選看不到對側 → 判不準也定不到位。
- 做法：逐規則掃完後，再跑**一次全篇 context 的 pass**（長 context 模型，預設 gpt-4.1 / 1M），專處理 **REL-04 / REL-08 / REL-12**。
- 此 pass 的 schema **強制 ≥2 個跨章節證據 EDU** → 缺陷一定定位得到（修掉了 3.4.1 的「無定位假按鈕」問題）。
- 開關：環境變數 `ENABLE_CROSS_SECTION_PASS`（預設開）。開著時 REL-04/12 **只在這跑**、不在逐章節重複跑。

---

## 6. 執行引擎（`backend/app/rules.py`，規則維護幾乎碰不到）

- `load_rules()`：讀 `rules.yaml` → list。**加規則＝在 YAML 多一條，引擎自動帶。**
- `check_rule()`：跑單條（Cypher → LLM verdict → 組 Defect）。
- `check_all_rules()`：13 條**平行**跑（thread pool，保序）→ 效能那段的加速來源。
- `cross_section_pass()`：跑跨章節那一次。
- `localize_defects()`：把缺陷說明批次翻成其他語系（3.8 多語系，加語言不用改 code）。

> verdict schema（3.3 瘦身）：非違規候選只回 `{index, violates:false}`，細節欄只在違規時填 → output token 省 43~49%。

---

## 7. 怎麼維護（日常改規則的 SOP）

| 想做的事 | 改哪裡 | 要不要動 Python |
|---|---|---|
| **新增一條規則** | `rules.yaml` 加一筆（5 欄） | ❌ 不用 |
| **改判讀標準（寬鬆/嚴格）** | 該規則的 `description` | ❌ 不用 |
| **改撈候選邏輯** | 該規則的 `candidate_query`（Cypher） | ❌ 不用 |
| **改缺陷分類名** | `defect_label` | ❌ 不用 |
| **改全體判讀風格/語氣** | `prompts/checker.md`（共用 system prompt） | ❌ 不用 |
| **規則要跨章節判** | 加進 `CROSS_SECTION_RULES` | ✅ 一行 |
| **缺陷說明要多一種語言** | i18n 設定 | ❌（引擎自動 iterate）|

**核心理念**：規則是**資料（YAML）**不是程式碼 → 學長/領域端可獨立維護語意，工程端不必每次改規則就改 code、重測、發版。

---

## 8. 品質與防呆設計（可向老師強調的嚴謹度）

- **保守 flag**：checker prompt 明令只報明確違規、附 confidence，<0.3 不報 → 抑制假陽性。
- **證據一定可定位**：LLM 常引 FRU id，引擎自動 `resolve_evidence_to_edus()` 展開成 EDU → 「在 PDF 中查看」一定跳得到原文。
- **說明給人看不是給工程看**：prompt 禁止在說明裡出現 node id / 欄位名 / 資料結構字眼，一律用論文原話改寫。
- **可重現**：3.5 移除 few-shot 回饋迴路 → 規則檢核一律 **zero-shot**，不受歷史判定污染；符號層（Cypher）本就確定性。
- **無退步驗證**：規則判定的品質改動，用「固定圖譜 A/B」證明與舊版一致（詳見效能報告第 7 頁）。

---

## 附錄 — 13 條 REL 規則一覽

| id | 名稱 | 抓什麼缺陷 | defect_label | 候選型態 |
|---|---|---|---|---|
| REL-01 | Claim-Evidence | 主張無證據支撐（裸主張） | NakedClaim | FRU |
| REL-02 | Baseline-Critique | 提 baseline 不批判 | BaselineNotCritiqued | Entity |
| REL-03 | Action-Justification | 研究行動無動機交代 | MissingMotivation | FRU |
| REL-04 | Macro-Decomposition | 缺巨觀問題拆解 | NoMacroDecomposition | 結構（跨章節）|
| REL-05 | Process-Sequence | Method 步驟時序混亂 | WeakProcessSequence | 章節 |
| REL-06 | Concept-Formalization | 概念/術語未形式化定義 | ConceptNotFormalized | Entity |
| REL-07 | Setup-Scoping | 實驗設定範圍模糊 | SetupNotScoped | 章節 |
| REL-08 | Problem-Solution | 問題↔解法不對應 | ProblemSolutionMismatch | 結構（跨章節）|
| REL-09 | Observation-Attribution | 值得注意的觀察無解釋 | ObservationWithoutAttribution | FRU |
| REL-10 | Concession-Compensation | 承認侷限不補償 | UncompensatedConcession | FRU |
| REL-11 | Specific-Generalization | 特例↔通則失衡 | SpecificGeneralizationImbalance | FRU |
| REL-12 | Core-Restatement | 結論與全文核心偏移 | ConclusionMisaligned | 結構（跨章節）|
| REL-13 | Meta-Discourse | 後設論述失衡 | MetaDiscourseImbalance | FRU |
</content>
