# 專案管理 / TODO

> 最後更新：2026-05-21
> 用途：列出 v3 已完成的主幹之外、還欠的工程與決策。每天如果有進度就把對應條目劃掉或更新。
> 架構與設計細節在 [SYSTEM.md](SYSTEM.md)，這份只放「還沒做的事」。

---

## ⭐ 最近進度（2026-05-20 ~ 21）：效能 / 容錯 / 版本管理

### 已完成 ✅

**A. PDF OCR 容錯（v3.1.0）— 已合併 main、已部署 server**
- `_looks_garbled` 亂碼偵測（看 backtick/星號等噪音字元比例 > 3%）
- 偵測到亂碼 → tesseract OCR fallback（chi_tra + eng），保留頁碼/bbox
- 文字抽取移到背景任務，OCR 不阻塞上傳請求；job 進度顯示「改用 OCR 辨識中」
- Dockerfile 裝 tesseract + chi-tra/chi-sim/eng，設 TESSDATA_PREFIX
- 修了一個 bug：第一版閾值（雙條件）漏判置換式亂碼 → 改單一噪音比例

**B. 版本紀錄頁 + 三碼語意化版本（v3.2.0）— branch `feat/version-update-banner`，未 push**
- `frontend/lib/version-log.ts` 單一版本來源（CURRENT_VERSION + VERSION_LOG）
- `/changelog` 頁、header 版本徽章 + 導覽

**C. 新版自動偵測橫幅（v3.2.0）— 同上 branch**
- `/version` route handler 回報部署版本；`VersionWatcher` 比對 bundle 版本
- 不一致 → 底部不可關閉橫幅 +「立即更新」；focus + 每 60s 檢查

**D. 分析 pipeline 平行化 — branch `feat/parallel-pipeline`，未 push**
- thread pool（`OPENAI_MAX_WORKERS`，預設 6），`build_paper_graph` 跨章節、`check_all_rules` 跨規則平行
- `pool.map` 保序 → 結果 deterministic；DB/Neo4j 已確認 thread-safe

**E. 規則輸出瘦身 — 同上 branch**
- verdict schema 只在「違規」時填細節欄位（非違規本來就丟掉）
- REL-06：7069→1554 token、101s→20s；check_all_rules：288s→25.5s

**F. thread-safe singleton — 同上 branch**
- `client()` / `driver()` 改 double-checked lock，消掉冷啟動的 lazy-init race

**G. 單元測試 + pytest 設定 — 同上 branch**
- 11 個測試：亂碼偵測(6)、抽取路由(3)、singleton 併發(2)；用「紅→綠」驗證抓得到亂碼 bug
- pyproject `[test]` extra + SWIG DeprecationWarning filter

**H. 時序圖 + 效能說明頁 — 同上 branch**
- about 頁時序圖更新（背景任務/OCR/平行/gpt-5.4）+ 新增「11. 效能與穩定性」章節

**I. 部署運維**
- server（140.115.54.48:8083）從 `feat/openai-deploy` 切到 `main` 並重建
- `feat/openai-deploy` 已合併 main 並刪除（本地+遠端）；DEPLOY.md 改成從 main 部署

### 效能數據（同一篇論文，前後對比）
| 階段 | 原本 | 現在 |
|---|---|---|
| build_paper_graph | ~246s | ~67s |
| check_all_rules | ~288s | ~26s |
| 合計 | ~9 分鐘 | ~1.8 分鐘（約 5×） |

### 待辦 📋（依優先序）

1. **整合測試「偵測上傳會不會掛」** — 目前完全沒有端到端測試，只有 runtime try/except 事後接住。
   - A.（推薦）mock LLM 的整合測試：跑完整 build_paper_graph→write_graph→check_all_rules，斷言不丟例外 + 結構合理。免費、可每次跑，抓接縫型 bug（如 prompt `{}` format 崩那種）
   - B. 真 LLM smoke test → 掛 CI 當「部署前 gate」
   - C. 啟動自檢：Neo4j 連得到、OPENAI key 在、rules.yaml/prompts load 得了
2. **規則瘦身那段補單元測試**（目前 verdict schema 改動沒有測試守著）
3. **版本號協調**：兩條未合併分支都要「下一版號」。合併時定先後（先合的 3.2.0、後合的 3.3.0），合併時補對應 changelog
4. **`analysis_runs` 表**：持久化每次 upload→done 的效能（總時間、是否 OCR、各階段 token/秒、候選數），不隨論文刪除/重傳消失
5. **`llm_calls` 加 `duration_ms`**：平行化後 created_at 間隔不再等於單次耗時，要真實 per-call 延遲就得記
6. **測試基建**：pytest 烤進 backend image / `make test` / GitHub Actions 自動跑
7. **文件**：README/DEPLOY 寫上 venv + `python -m pytest` 跑法（避免又用系統 Python 撞 ModuleNotFound）
8. **上線**：兩條 feature 分支驗收穩定後 → push → 合併 main → 重新部署 server（**目前 server 仍是 3.1.0，沒有平行化/版本頁**）
9. pool 大小 vs OpenAI tier 調校（目前保守 6，tier 夠可往上）
10. （可選）DBeaver 改 bind-mount 即時看 SQLite，取代目前的快照匯出

### 分支與部署現況
| 分支 | 內容 | 狀態 |
|---|---|---|
| `main` | OCR(3.1.0) + 部署文件 | 已 push、**已部署 server** |
| `feat/version-update-banner` | 版本頁 + 自動偵測橫幅(3.2.0) | 3 commit，**未 push/未合併** |
| `feat/parallel-pipeline` | 平行化+瘦schema+singleton+測試+文件 | 8 commit，**未 push/未合併** |
- 本機 docker：跑最新平行化 code（backend 已重啟）
- `docs/EDITING_MODE_PLAN.md`：另一個大功能規劃（編輯模式/可 merge 建議），untracked，與本段無關

---

## 0. 最近完成（2026-05-10）

下面這幾件事是同一晚 burst 做完的，都是為了下週 demo。

### 0.1 論文助手聊天抽屜 ✅
- 後端 [backend/app/chat.py](../backend/app/chat.py)：context 組裝（整篇 EDU + defects + 13 規則 + prompt cache）+ Guardrails（scope refuse、強制 cite、injection 偵測、rate limit 15/min、輸入 cap 2000 字、history cap 10 turns）
- 端點：`POST /api/papers/{id}/chat`（429 → rate limit / 400 → validation / 409 → 分析未完成）
- 前端 [frontend/components/chat-drawer.tsx](../frontend/components/chat-drawer.tsx)：右下浮動按鈕 + Sheet 抽屜，`[EDU:xxx]` / `[DEFECT:xxx]` 自動 parse 成可點 chip → 跳 PDF/缺陷面板
- LLM 用 Sonnet（chat 夠用，cache hit 後 ~$0.001-0.003 / 次）

### 0.2 Phase 2 — Judgment → Few-shot 回饋迴路 ✅
- [backend/app/db.py](../backend/app/db.py)：`get_judgment_examples(rule_id, limit_per_verdict=4)` — JOIN judgments × results，回傳 `{verdict, description, suggestion, evidence_texts, note}`
- [backend/app/rules.py](../backend/app/rules.py)：`_build_examples_block()` 把 correct + wrong examples 組成 calibration prompt（≥3 筆才注入），`check_rule()` 自動把 examples 拼進 system prompt
- Schema 加 `RuleRunMeta`（rule_id、examples_used、candidate_count、defect_count），透過 `AnalysisResult.rule_meta` 傳到前端
- 前端 result 頁顯示「⚙️ 參考 N 筆學長判定」綠色 badge

### 0.3 LLM Confidence 分數 ✅
- `Defect.confidence` 0.0–1.0，schema 強制 LLM 輸出（描述 0.9+/0.6-0.9/0.3-0.6 區間）
- 缺陷卡片顯示信心 % + 高/中/低色塊（emerald/sky/zinc）

### 0.4 缺陷依嚴重度 / 規則分組 ✅
- DefectPanel 加分組切換器
- Evidence text hover 取消 line-clamp 看完整內容

### 0.5 /stats 規則統計頁 ✅
- 端點 `GET /api/rules/stats`：JOIN `rule_firing_stats` × `judgment_summary`，per rule 統計命中分布 + precision
- 前端 [/stats](../frontend/app/stats/page.tsx)：4 KPI + 13 條規則表格 + 狀態 badge（🌑 從未觸發 / 🔥 高頻 / ⚠️ 需檢討 / ✅ 表現良好）+ Phase 2 樣本充足度欄

### 0.6 Prompt 集中化 ✅
- 新 [backend/prompts/](../backend/prompts/) 目錄：`edu.md` `er.md` `rst_fru.md` `checker.md` `chat.md` `cross_section.md`
- [backend/app/prompts.py](../backend/app/prompts.py) `load_prompt(name)` lru_cache loader
- 學長改 prompt 不用碰 Python（重啟 backend 即生效；或呼叫 `prompts.reload()`）

### 0.7 跨章節 second pass ✅
- [backend/app/rules.py](../backend/app/rules.py)：`cross_section_pass()` — 用 Opus 4.7 1M context 跑全篇，專攻 REL-04 (Macro-Decomposition) / REL-08 (Problem-Solution) / REL-12 (Core-Restatement) 這三條 per-section 抓不到的
- Schema 強制 `evidence_edu_ids ≥ 2`（必須引用跨章節證據）
- 預設開啟，`ENABLE_CROSS_SECTION_PASS=0` 關閉
- 缺陷類型加「（跨章節）」標籤區分

### 0.8 歷史頁批次刪除 ✅
- 端點 `DELETE /api/papers/{paper_id}` — 同步清 SQLite + Neo4j + PDF 檔
- 前端 papers 頁改 client component，加 checkbox + 全選 + 批次刪除 + confirm

### 0.9 KG minimap ✅
- 之前就有了（`kg-flow.tsx` 用 React Flow 內建 `<MiniMap>`）

---

## 1. 立即優先：學長標 50 筆 + Phase 2 ablation

> Phase 2 程式碼已就緒，但**沒資料就跑不起來**。這是現在唯一卡住論文 main result 的事。

### 學長 labeling 計畫
- 目標：~50 筆 judgments（理想分布：每條規則至少 3 筆，方能觸發 Phase 2 注入）
- 每篇論文約 5-15 個 defects，標 5-10 篇就足夠
- 估時：學長半小時/篇 × 8 篇 ≈ 4 小時，可拆成兩天
- UI 已就緒：result 頁缺陷卡片底下 ✅判對 / 🤔部分對 / ❌誤判 三鈕

### 累積後的 ablation 實驗
1. 先記錄 baseline（沒 inject few-shot）：拿 5 篇沒判定過的論文，跑 → 記下 defect 數、信心分分布
2. 標完 50 筆後，重跑同 5 篇：看 defect 數 / precision 是否改善
3. 表格化呈現 → 寫進論文 evaluation 章節

### `/stats` 頁監控訊號
- ⚠️ 需檢討：precision < 0.5 → 學長重寫該規則 description / Cypher
- 🌑 從未觸發：該規則太嚴或 Cypher 沒抓到候選
- 🔥 高頻：可能 over-fire，加進 cross-section pass 也好

---

## 2. 中期（demo 後 2-4 週）

### 2.1 Pre-annotation 評估工具 + per-rule precision
- 把 SQLite judgments 當 ground truth，自動算 per-rule precision、F1
- 工程量：1 天
- 卡點：需要 50+ judgments 才有意義

### 2.2 Anthropic Batch API（51 篇實驗 50% 折扣）
- 把 pipeline 改 async，submit batch → poll
- 工程量：1-2 天
- 收益：同樣 51 篇實驗成本砍半，方便跑大規模測試

### 2.3 Prompt 版本化
- 現在 prompts 是純文字檔，沒版本概念
- 進階：每個 prompt 改動記到 SQLite + 跑回歸看 precision 變化
- 工程量：半天

---

## 3. 長期 / 戰略性（demo 後再說）

| 項目 | 動機 | 工程量 | Defer 原因 |
|---|---|---|---|
| Hybrid Local + Cloud | EDU/ER 用 Ollama (M1 Max 64GB 跑 Qwen2.5-72B 可行)，省 70% cost | 2 天 | 老師明確說先不嘗試 |
| 跨論文 Entity 對齊 | 同一作者多篇連動；對畢業論文系列特別有用 | 1-2 天 | entity dedup 是研究級題目，demo 不需要 |
| Multi-agent (Claim / Evidence / Critic) | 比單 prompt 細分職責 | 2+ 天 | 需要重設計 pipeline，demo 先不動 |

---

## 4. UX polish（剩餘）

- [x] PDF 縮圖 navigation — defer，scroll 已堪用
- [ ] 缺陷卡片支援 inline edit 修改建議 — defer 到 demo 後
- [x] 批次刪除已上傳論文 ✅
- [x] 缺陷 hover 顯示完整 evidence text ✅
- [x] KG 視覺化 minimap ✅（之前就有）
- [x] 缺陷依規則 / 嚴重度分組 ✅

---

## 5. Benchmark / 自動評估討論

### 5.1 已知相關資料集

| 資料集 | 任務 | 與我們的契合度 | 評論 |
|---|---|---|---|
| **PeerRead** (Kang et al. NAACL 2018) | 論文 + reviews + accept/reject 標註 | ★★☆☆☆ | 可看「我們系統的缺陷數是否與 reject 機率正相關」，但不是 per-defect ground truth |
| **AAEC** (Stab & Gurevych CL 2017) | 402 篇學生論文 + argument 結構標註 | ★★★☆☆ | 可對映 REL-01 / REL-02 的精神，但 essay ≠ thesis |
| **AbstRCT** (Mayer et al. ECAI 2020) | 醫學摘要的 argument mining | ★★☆☆☆ | Domain 不同 |
| **Logical Fallacy Detection** (Jin et al. EMNLP 2022) | 13 種邏輯謬誤分類 | ★★★☆☆ | 與 REL 精神接近，但句級分類非結構檢核 |
| **F1000Research / OpenReview** | 公開 review + paper | ★★☆☆☆ | 弱 ground truth |
| **SciFact / SciFact-Open** | 摘要事實核對 | ★☆☆☆☆ | 偏 factuality |

### 5.2 結論

**沒有完全對映 13 條 REL 規則 + thesis 結構的公開資料集**。原因：
1. 13 條 REL 是學長從 51 條章節分層規則 MECE 收斂的，**非通用 taxonomy**
2. 多數 argument mining 資料集都是「essay / abstract」，不是完整 thesis 結構
3. 「邏輯缺陷」標註本身就是研究級難題
4. 中文學術論文資料集更稀少

### 5.3 推薦路線

**主軸**：自建 ThesisCheck-zh-50（學長標 50 篇）→ Phase 2 ablation。
**Generalization 章節（可選）**：跑 AAEC 對 REL-01/REL-02，做 cross-domain 證據。
**Sanity check（1-2 天）**：跑 PeerRead 20 accept + 20 reject，看 reject 平均缺陷數是否 > accept。

### 5.4 Self-annotation 注意事項（已和你討論）

- ✅ 自標自己論文 OK，但需在論文 method 章節寫 "first-author annotation, future work: multi-annotator with kappa"
- ✅ AI 幫忙做 OCR / 切段 / 列 claim 候選 OK
- ❌ AI 不能告訴你「這是不是缺陷」 — judgment 環節必須人工
- 推薦：抽 5 篇給學長盲標算 Cohen's kappa，論文寫「single annotator with N=5 verification by domain expert」

---

## 6. 待決策（明天討論）

- [ ] 學長願不願意一週內標 50 篇？沒這個 Phase 2 跑不出 ablation
- [ ] Phase 2 的 example 是 per-rule 累積還是全域？目前是 per-rule，但若某規則一直沒樣本要不要 fallback 全域？
- [ ] benchmark 是否真的進論文？影響是否花 1-2 天跑 PeerRead/AAEC
- [ ] Cross-section pass 在 demo 要不要 highlight？目前 defect 標「（跨章節）」，可以做成獨立區塊
