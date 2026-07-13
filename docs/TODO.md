# 專案現況 / 待辦

> 最後更新：2026-07-13
> 用途：只放「目前在做 / 還沒做的事」。已完成的歷史不留在這，看 git log 與 `/changelog`。
>
> **各層文件的分工（互不重疊）**
> - 產品功能全貌、未來展望 → 前端 `/about` 頁（單一事實來源，面向讀者）
> - 系統設計 / 架構 / KG 語意 / 效能 → [SYSTEM.md](SYSTEM.md)
> - 資料庫 schema → [DB_SCHEMA.md](DB_SCHEMA.md)
> - 13 條規則怎麼寫、怎麼維護 → [REL-rules-explained.md](REL-rules-explained.md)
> - 消融實驗現況（可信度原則、已驗證事實）→ [../backend/experiments/HANDOVER.md](../backend/experiments/HANDOVER.md)

---

## 現況快照（2026-07-13）

- **產品端**：審稿 + AI 寫作編輯器兩大子系統都上線；編輯器已到 **v4.20.0**（三格式一致、專注模式、文法 lint、缺陷一鍵套用、五格式匯入含 PDF、論文助手串流+持久化皆完成）。中英 i18n + 深色模式已併入 `main`。
- **研究端**：離線消融實驗（三 arm × 雙 judge pairwise）的 harness 已進版控（`backend/experiments/`，commit `88ffaf9`）。目前在 `experiment/ablation` 分支收尾。
- **REL 擴展**：老師會議提出 6 類新缺陷 + student-thesis-review skill（14 條）→ REL 擴展計畫已定調（全 symbolic KG 擴充），見待辦 D 組。
- **實驗結論屬敏感區**：任何勝負數字 / 一致率一律以 `backend/experiments/HANDOVER.md` 標記「已驗證」者為準，不要憑記憶引用。

---

## 待辦（依優先序）

### A. 消融實驗收尾（卡論文 main result）
1. 修 judge 一致率過低的問題（雙 judge 判定分歧大，先確認是 prompt 還是任務本身難）
2. 控制「缺陷數」confound——三個 arm 之間缺陷數不對齊會污染 pairwise 勝負判讀
3. 強化 prompt-A（全文直丟那個 arm），確保比較公平、不是因為 prompt 太弱才輸
4. 擴大樣本數 n（目前篇數偏少，勝率統計力不足）
5. 收斂出可寫進論文 evaluation 章節的結論

### B. 產品缺口
6. ✅ **PDF 匯入編輯器**（2026-07-13，v4.19.0，使用者已驗收）——pymupdf4llm 依字型大小
   還原標題階層 → 現成 markdown 匯入管線；掃描檔自動 OCR（背景 job + 輪詢）；
   浮水印自動移除；`_pdf_post_process` 8-pass 後處理對齊 Word 匯入品質
   （頁碼/目錄殘渣清除、跨頁段落與長表接回、參考文獻重組、標題層級重定、
   標點錯亂重建）。已知限制：複雜多行儲存格的跨欄語序（pymupdf4llm 固有）。
7. 規則回饋校準：把人工判定（判對 / 誤判）回饋給系統，自動校準規則精準度。⚠️ 校正（2026-07-02）：擷取端（標註存 SQLite + `/api/judgments/summary` 算 precision）已就緒，但**線上 few-shot 注入迴路的程式尚未實作**（`db.get_judgment_examples` / `check_rule` 範例注入都不存在，現為 zero-shot）；要閉合迴路須新寫這段，見 SYSTEM.md §3.6

### C. 基建（實用功能穩了再做）
8. 帳號與多人協作（個人空間 + 權限）
9. 成本優化：本地 + 雲端混合推論、批次 API 折扣
10. 上雲：SQLite → 託管 Postgres、本機磁碟 → 物件儲存、記憶體任務 → 持久佇列 + 獨立 worker（三階段見 `/about` 上雲規劃）

### D. REL 規則擴展（老師 2026-06-30 會議 + student-thesis-review skill）

> 背景：老師認為現有 13 條 REL 不足以涵蓋論文常見問題，從實際批改歸納出數類缺失；
> 另提供 student-thesis-review skill（14 條 checklist）作為規則來源。
> 路線拍板：**全走 symbolic KG 擴充**——新規則與現有 13 條同構（Cypher 候選 + LLM 判），
> 不走 holistic LLM 直丟，以貼合論文「先拆解再評論」論點。skill 只當規則來源、不動 ablation。

**D0. KG 抽取層擴充（所有新規則的前置，須先動 schema）**
11. definition-tracking：抽取階段建 `(FRU:Definition|EDU)-[:DEFINES]->(Entity)` 邊、
    Entity 加 `first_mention_order`；縮寫加 `expansion` + 首次展開位置。
12. entity 正規化 + alias：同概念多個 surface form 聚成 canonical Entity；
    `MENTIONED_IN` 邊存實際 `surface` 字串（供偵測命名漂移/矛盾）。
13. section 結構 metadata：建 `Section` 節點（heading / level / parent / order /
    subsection_count），支援 357 結構化檢查。
14. 抽取 schema 補兩項：帶評測數字的 EDU 打 `has_metric_number` 旗標；
    FRU function 新增 `Contribution`（供 REL-17/18）。

**D1. 新規則（依老師類別分組，全部 Cypher 候選 + LLM 判）**

| 新 ID | 名稱 | 老師類別 / skill# | 相依 D0 | 備註 |
|---|---|---|---|---|
| REL-14 | Definition-Coverage | 變數定義缺失 / #9 | 11 | used-but-never-defined、定義晚於首次使用；與 REL-06（有出現但沒 formal 定義）劃清界線 |
| REL-15 | Term-Consistency | 名詞一致性 / #8 | 12 | 同概念矛盾 surface form / 命名漂移 |
| REL-16 | Cross-Section-Number-Consistency | 跨節數字矛盾 / #11 | 12,14 | macro「3 vs 29」；cross-section |
| REL-17 | Contribution-Placement | 貢獻放錯位置 / #7 | 14 | 方法/結果未交代前就宣稱貢獻；cross-section |
| REL-18 | Contribution-Validity | 貢獻的定義 / #7 | 14 | 拿實驗結果當貢獻（循環論證） |
| REL-19 | Design-Eval-Separation | 設計章混入結果 / #13 | 14 | 設計/方法章出現評測數字或提前引用未定義數據 |
| REL-20 | Section-Structuring | 章節 357 / 結構詞混用 | 13 | 單章 subsection ≥ 7 該結構化；單位詞（層/階/Tier/防線）混用 |
| REL-21 | Local-Coherence (E–E) | 邏輯連貫性 | RST/連接詞 | 相鄰 EDU 銜接、連接詞；「句與句連成一個故事」 |
| REL-22 | Negative-Result-Scoping | 負面結果外推 / #14 | — | 消融/負面結論須限定實測設定；與 REL-11 劃界 |

出範圍（記錄但暫不做）：圖文一致（skill #10，需圖形元件抽取，現行純文字 KG 不支援）、
Related Work 深度/比較表（skill #3，偏人工判斷）。

**D2. 驗證與收尾**
15. 每條新規則先在 forensic 18-缺陷基準跑回歸，確認不誤傷既有 18 條（見瘦身基準）。
16. KG schema 動完同步更新 SYSTEM.md §5；規則定稿後寫入 REL-rules-explained.md + rules.yaml。
17. ⚠️ 新增規則會改變各篇缺陷數，與 A 組「缺陷數 confound」交互——擴規則與 ablation
    收尾要錯開節奏，別同時動。

---

## E. 全盤健康檢查（2026-07-02）

> 四路平行 code review（後端核心 pipeline / 後端編輯器子系統 / 前端 / infra·測試·文件）的彙整。
> 高嚴重項已抽查原始碼驗證屬實。審查用的 subagent 定義在 `.claude/agents/code-reviewer.md`。
> 依「先修對的、再修快的、最後修好看的」排序；安全項因部署為**公網無認證 + 文件全域共享**而全部升一級。

> **修復狀態（2026-07-02，分支 `fix/health-check-2026-07`）**
> - ✅ **已修**：E1 的 B1/B2/B5/B6/B7；E2 的 S1–S6；E3 全部十項；E4 的 llm 重試疊加、
>   temperature 防禦、Neo4j paper_id index、objectURL 洩漏、relTime；E5 的測試隔離
>   （全域 conftest）與前端 typecheck script。後端 commit `fix(backend)`、前端 commit
>   `fix(frontend)`；另修 docker-compose 密碼來源註解/neo4j restart/CORS 預設 IP。
>   pytest 163 passed 全綠、tsc 零錯誤、eslint 與 baseline 相同。
> - ⏸ **刻意未動**：S7 non-root 容器（涉及既有 volume 權限，要與部署協調）；
>   S8 限流 key（等帳號系統）；E5 的剩餘測試缺口、E6 功能項。
>   （E4 已於第四輪 2026-07-08 全數修完，見 E4 節。）

> **第三輪（2026-07-06，rules.yaml Cypher 語意修復）**
> - ✅ **B3（零節點不 fire）**：REL-13 屬實（逐 FRU 回列，零節點 → 0 rows → 不進
>   LLM），改錨定 `Paper` 單列彙總（Attention 16 列→1 列）附 `paper_sections` 當分母。
>   REL-11 經驗證舊版靠純 aggregation 在零節點時仍回一列（原審查描述過重），但單邊
>   空時會塞 `{id:null}` 垃圾 map——已改乾淨寫法。另加空集合 guard：REL-11 兩側皆零、
>   REL-13 零 EDU（殘留 draft 很多）直接跳過，省 LLM 呼叫。
> - ✅ **B4（REL-03/10 paper-global NOT EXISTS 反模式）**：套 REL-09 的同章節 +
>   order proximity 寫法（REL-03 動機在前看 −8/+3；REL-10 補償在後看 −3/+8）。
> - ✅ **REL-02 過濾**：MENTIONED_IN 限定 Method/Experiment/Results 章節，
>   砍掉 Intro/Related Work survey 式提及的候選膨脹（LiteAgent 20→9、Attention 7→1）。
> - **回歸方式**：forensic 論文與 18 缺陷基準已隨 Neo4j volume 重建消失，改以現庫
>   4 篇論文做「舊 vs 新」A/B——candidate 數純 Cypher 對比 + 改動 5 條規則的
>   LLM 判讀對照既存 result 基準（extraction 未動，不需重跑全管線）。結果：
>   REL-02 @ LiteAgent 基準 2 條實為同一問題重複報告（entity 膨脹產物），新版收斂
>   1 條實質保留；REL-03 基準缺陷保留＋新增合理缺陷（Attention 抓到 beam size/α
>   無動機交代，舊版因反模式永遠 0 候選）；REL-13 零後設論述案例正確 fire。
>   pytest 全綠、本地 docker 已重建驗證。另以合成測試論文（種入已知缺陷）端到端
>   驗證：REL-03 舊查詢 0 候選 vs 新查詢抓到並判出缺陷、REL-11 泛化無實例被抓。
> - ✅ **驗測發現 → 已修（2026-07-06，md/txt 上傳轉 PDF）**：原發現＝主上傳的
>   md 章節偵測吃不到 markdown 標題（`SECTION_PATTERNS` 以 `^\s*` 起手，`#` 不是
>   空白 → md 上傳全落 section=Other，REL-02/05/07 等按章節的規則全失效），且
>   md/txt 無頁面座標 → 前端 PDF 預覽與缺陷 highlight 全不可用。修法＝方案 A：
>   `convert_upload.py` 在 `_run_analysis` 前把 md/txt 排版成真 PDF（復用
>   import_doc→export_doc(article)→內建 XeLaTeX 鏈；關 secnumdepth＋剝標題編號
>   讓裸標題命中 SECTION_PATTERNS），之後整條鏈當 PDF 論文處理，前端零改動。
>   轉檔失敗 fallback 舊行為（純文字分析、無預覽）不擋分析；papers.pdf_path 指
>   轉出 PDF、upload_events 仍留原始檔。e2e 實測：同一篇測試 md 章節從全 Other
>   變 6 個正常章節、44/44 EDU 帶真實 bbox、預覽端點回真 PDF。既有 md 論文
>   （cache 內）不回溯轉檔，重傳（改一字破 cache）即得新行為。

> **第二輪（2026-07-02 下午，demo-checklist 驗測後補修）**
> - ✅ **PDF 預覽全掛（regression）**：worker 改 bundle 內建時解析到頂層
>   pdfjs-dist@5.7.284，與 react-pdf 內部 API 5.4.296 版本不符 → 全部預覽靜默失敗。
>   已 pin 5.4.296 dedupe 成單一份；**升 react-pdf 時必須同步這個 pin**（pdf-viewer.tsx 有註記）。
> - ✅ **引用搜尋降級鏈**：OpenAlex 上游 503 期間 en 模式把 Crossref fallback 結果丟棄、
>   zh 模式遇英文 claim 兩來源都不查；已修，Crossref 並補 429/503 retry。
>   ⚠️ OpenAlex 掛掉時 verify 會回 unknown、ground 回 none（候選無 abstract/openalex_id），
>   屬合理降級——demo 前先確認 `curl api.openalex.org` 健康。
> - ✅ **md 匯入 → 台灣論文 0.x 章節**：`# 標題 + ## 章` 的 md 匯入後 heading 未上移一級
>   → twthesis 無 chapter。已修（pandoc 慣例 shift）。
> - 驗測範圍：demo-checklist 全 API 鏈（匯入/自動儲存/版本/四格式匯出+封面/引用三件套/
>   relink 未測/autocomplete/rewrite/outline/缺陷檢查 15 條）＋ CDP 抽查結果頁與編輯器 UI。
>   pytest 167 passed。

### E1. 會產生錯誤結果的 BUG（優先修）

| # | 位置 | 問題 | 觸發條件 | 修法 |
|---|---|---|---|---|
| B1 | `pipeline.py:425` | 同名 section 各自從 `:edu:0` 重編號 → EDU id 碰撞，Neo4j `MERGE` 後寫覆蓋先寫，ER/RST/FRU 邊指到錯內容、PDF 定位錯 | 全文出現兩個同名 section（合成 Abstract + 真摘要、子標題行首命中 pattern，很常見） | id 加 work-item 序號 `{paper_id}:{section}:{seg_idx}:edu:{i}`，或合併同名相鄰段 |
| B2 | `kg.py:83` vs `:69` | `clear_paper` 用 `WHERE n.paper_id` 匹配，但 Paper 節點只 SET `id`/`title` 沒 `paper_id` → 刪論文永遠留孤兒 Paper 節點（已驗證屬實） | 每次刪除/失敗清理論文 | `_write_tx` 對 Paper 也 `SET p.paper_id`，或 clear 追加 `MATCH (p:Paper {id:$pid}) DETACH DELETE p` |
| B3 | `rules.yaml` REL-11/REL-13 | Cypher 以 `MATCH (f1:FRU {function:'Specific'})` / MetaDiscourse 起手，論文若**零**該類節點回 0 rows → description 明說的「只有泛化沒實例 / 完全缺後設論述」這一半永遠不 fire | 論文缺該類 FRU | 改由 `MATCH (p:Paper {id:$pid})` + OPTIONAL MATCH 兩側收集，空集合也回一列給 LLM 判 |
| B4 | `rules.yaml` REL-03/REL-10 | paper-global `NOT EXISTS` 反模式：全篇任一 Motivation/Compensation 就放過所有 MethodStep（REL-09 已於 `rules.yaml:154` 改成 proximity，這兩條沒跟上） | 全篇僅一個 Motivation → 規則整條靜默 | 套 REL-09 的「同章節 + order 鄰近」寫法 |
| B5 | `export_doc.py:640/861/1704` vs LaTeX | 數字式引用（ieee/numeric）下 DOCX/HTML/md/txt 用 `enumerate i+1` 重新編號，內文標籤與 LaTeX 卻用含 unlinked 的 order → 內文 [3] 對到清單 [2]，且 LaTeX↔DOCX 不一致 | style=ieee/numeric 且含 unlinked 引用 | 四格式統一走 `_citation_number`，或先濾 unlinked 再建 order（共用 helper） |
| B6 | `lib/editor-store.ts:184-215` | 模組級 `saveChain` 佇列在切換文件後才執行時，把舊文件 content 寫進新文件（persist 執行時才讀 `get().docId`，body 卻是舊的，且 `lastKnownUpdatedAt` 已換新 token 使 PUT 成功）→ **跨文件資料污染** | save 已 enqueue 時導航到另一份文件 | enqueue 時捕捉當下 docId 傳入 persist，執行時與 `get().docId` 不符即丟棄；或 reset 用 generation counter 作廢舊鏈 |
| B7 | `citation-panel.tsx:190-199` | 手動/DOI 建立的引用 `openalexId===""`，refVerdicts/grounds 以它為 key → 所有手動引用共用一個 `""` key（驗證一筆全部顯示同 verdict）；claim 比對也抓到第一顆空 id chip | References tab 對手動引用按驗證/佐證且文中多筆手動引用 | key 與查找一律改用 `citeKey(r)` |

### E2. 安全（部署為公網無認證，全部視為一級）

| # | 位置 | 問題 | 修法 |
|---|---|---|---|
| S1 | `latex_compile.py:47` | XeLaTeX subprocess 未帶 `-no-shell-escape`、未設 `openin_any=p`（已驗證）→ 惡意 math/code 節點可用 `\input{/app/.env}`／`\openin`+`\read` 把容器內檔案（**OPENAI_API_KEY**）讀進回傳 PDF | `env={**os.environ,"openin_any":"p","openout_any":"p"}` + 加 `-no-shell-escape` |
| S2 | `export_doc.py:1481, 1677` | HTML 匯出把 mathInline/mathBlock 的 `latex` attr 原樣串進 HTML，未經 `_h()`（同函式其他欄位都有 escape，已驗證）→ stored XSS，文件全域共享等於跨使用者 | 對 latex 內容做 HTML escape（MathJax 對跳脫後文字仍可解析） |
| S3 | `export_doc.py:58-65` | `_image_bytes` 對任意 figure `src` 發 server-side GET → SSRF（可把 `http://neo4j:7474` 等內網回應嵌進 DOCX/PDF）；`_MAX_IMG_BYTES` 在全量下載後才檢查 | scheme/host 白名單，或只允許 `/api/editor/images/` |
| S4 | `grounding.py:84-130` / `routes.py:125` | `oa_url` 完全由客戶端提供且 server 直抓（SSRF、PDF 無大小上限）；抓回內容以 `openalex_id` 為 key 寫全域 SQLite 快取 → 任何 client 可灌毒 grounding，全體共享毒化結果 | oa_url 改由 server 端從 OpenAlex 重查（已有 `get_works_by_ids`），或驗證 host 在信任清單 |
| S5 | `routes.py:355` `/api/upload` | 主上傳無檔案大小上限、無副檔名白名單、`await file.read()` 整包進記憶體（editor import 有 20MB、image 有 10MB，主上傳反而沒有）→ 記憶體打爆 + LLM 成本濫用面 | 加 `_MAX_UPLOAD_BYTES` + 副檔名白名單 + Caddy `request_body max_size` |
| S6 | `import_doc.py:119-131` | .docx 是 zip，python-docx 解壓無 ratio/大小防護（zip bomb → OOM）；內嵌圖片數量與單張大小無上限 | 解壓前檢查 infolist 總 uncompressed size，限圖片張數與單張 bytes |
| S7 | 兩個 `Dockerfile` | backend/frontend 容器皆以 root 執行（無 `USER`） | 補 non-root USER |
| S8 | 限流 key | 所有 rate-limit key 是客戶端自報的 `doc_id`、未驗證 → 換隨機 id 即繞過（程式自認 backstop，但公網部署下值得記錄） | 記錄；長期靠 E5 帳號系統 |

### E3. 可靠性 RISK（特定條件會出事）

- **cache hit 不驗證 Neo4j 圖存在**（`routes.py:358`）：Neo4j volume 被清（重佈署/`down -v`）後同檔重傳直接回 cached paper_id → KG 視圖空、EDU 查看 404。修：cache hit 時查 Neo4j 缺了就用 result JSON 的 graph 重建（`kg.write_graph` 可直接吃）。
- **首傳 TransientError 無重試**（`kg.py:75` + `routes.py:271`）：`init_schema` 在每次 `write_graph` 內跑，全新部署第一篇撞 constraint 暖機 → 整個 job error（對應既知現象）。修：startup 先跑一次 `init_schema`，並對 `write_graph` 的 TransientError 退避重試一次。
- **`_jobs` 無界成長 + 重啟卡死**（`routes.py:207`）：每次上傳把完整 result（可達數 MB）留在 in-memory dict 永不清；server 重啟後前端輪詢 404、`upload_events` 永停 pending。修：done 後只留 paper_id（前端改走 `/api/papers/{id}/result`）+ TTL；startup 把殘留 pending 標為 error。
- **LLM payload 硬截 `[:120_000]` 切壞 JSON**（`rules.py:133, 442`）：候選多的規則或翻譯 pass 超過 120k chars 時送出中途斷裂的 JSON，尾端候選消失且無告警。修：按 candidate 邊界裁切並記 log/meta。
- **cross-section 逐筆解析無防禦**（`rules.py:385`）：`Severity(...)`/`v["description"]` 直接索引，一筆缺欄位 → 例外冒泡 → REL-04/08/12 整批 defects 丟失，只留前端疑似沒顯示的 `cross_section_warning`。修：比照 `check_rule` 逐筆 skip。
- **同檔並發上傳無 in-flight 去重**（`routes.py:391`）：分析中結果尚未寫入時第二個相同檔案 cache miss → 兩份 LLM 花費、papers 表兩列同 hash。修：以 content_hash 做 in-flight lock。
- **驗證引用時邊編輯 → 標到錯 chip**（`tiptap-editor.tsx:615`）：`handleVerifyCitations` 快照 pos 後逐一非同步驗證，期間可自由編輯、文件位移後 `setCitationVerdict(pos)` 標錯。修：存 openalexId 重掃定位，或驗證期間 `setEditable(false)`。
- **pdfjs worker 走 unpkg CDN**（`pdf-viewer.tsx:11`）：實驗室內網無外網或 CDN 被牆時 PDF 預覽整個掛。修：worker 併入 bundle 或 self-host。
- **job poll 錯誤無上限重試 + 擋關頁**（`job-tracker.tsx:186`）：後端 down 時每 2 秒無限重試且 `beforeunload` 持續擋關分頁、無提示。修：連續 N 次失敗顯示警示或停止。
- **relink/deep-check 單請求無總量上限**（`citation_relink.py:128`、`routes.py:132`）：一發請求可跑數分鐘佔住 worker（每 ref 一次 OpenAlex 10s×3 retry + embed；check 可帶 60 段），限流以「請求」計擋不住。修：加總量/字數上限。

### E4. 體質改善 IMPROVE

> **第四輪（2026-07-08，分支 `fix/e4-improvements`）：E4 剩餘五項全修完。**
> - ✅ `list_papers` N+1：`results` 表冗餘 `defect_count`/`edu_count`（migration backfill、
>   壞 JSON 列留 NULL 由 route 惰性 fallback），列表頁不再逐篇解多 MB JSON。
> - ✅ 限流碼 9 份合一：演算法抽到 `app/ratelimit.py`（各模組保留自己的
>   `_rate_buckets`/`RATE_LIMIT_PER_MIN`，測試 monkeypatch 不變），並加 stale bucket
>   惰性清理——原本 dict 每見過一個 doc_id 就永久多一格。
> - ✅ grounding：負結果（無全文無摘要）以 sentinel 進 `paper_chunks` 快取，重複點擊
>   不再重抓 OA PDF；claim 向量 `lru_cache(256)`。relink 的 embed 從每 ref 一次改
>   整份參考文獻一次呼叫。
> - ✅ `refs_label` 改 `i18n.STRINGS` locale-as-data（新增 `i18n.t()`）；LaTeX 非
>   longtable fallback 的表格 caption 移到表上方，對齊 xltabular/DOCX/HTML。
> - ✅ Entity 跨 section 去重：`pipeline._dedupe_entities`（大小寫不敏感＋空白正規化，
>   首見者留 id/type，triple 重映射）。A/B（現庫 7 篇、暫存雙寫 Neo4j 比 candidate）：
>   entity 數 73→67 / 68→55 / 44→37，REL-06 候選收斂（27→26、16→14）；
>   REL-02 在 rules-test-v2 多 1 條合理候選（「本系統」拿回 Method 型別），實跑
>   LLM 判讀 0 缺陷與基準一致，無語意翻轉。pytest 220 passed。
> - 第一輪已修：llm 重試疊加、temperature 防禦、Neo4j paper_id index、objectURL、
>   relTime；第二輪已修 Crossref retry。E4 至此清空。

### E5. 測試缺口

- ✅ **後端核心鏈最值錢的兩塊已補（2026-07-06）**：`tests/test_check_rule.py`（verdict
  解析防禦全覆蓋：零候選跳 LLM、缺 description 跳過、severity fallback、confidence
  clamp、FRU→EDU 展開、`_dump_capped` 按候選邊界裁切）＋ `tests/test_db_papers.py`
  （papers/results roundtrip、content-hash 快取語意——含「無完成結果不算 cache hit」
  與「刪除清乾淨」）。仍未覆蓋：`kg.py` Cypher 寫入、`routes.py` cache-hit 路徑。
- ✅ 兩個 route 測試污染真實 DB——第一輪已修（全域 conftest 隔離）。
- ✅ **前端首批測試（2026-07-06）**：引入 vitest（lockfile 以 npm 10 重產、docker
  `npm ci` 驗證通過），`lib/api.test.ts` 14 條 contract 測試（`pickLocalized` 降級鏈、
  URL encode、錯誤內文、uploadPaper FormData）；`npm test` script。
  仍未覆蓋：editor Zustand store 與 TipTap JSON 轉換純邏輯（v4.17 最易 regression 區）。
- ✅ 前端 typecheck script——第一輪已加。

### E6. 值得補的功能（先修完上面再談）

- ✅ **PDF 匯入編輯器**：已完成，見待辦 B/6。
- **DOCX 數學式轉 OMML**：目前 DOCX 只輸出字面 `$...$`（LaTeX/PDF 真排版、HTML 走 MathJax）→ 三格式一致的北極星下 DOCX 是落後者（`export_doc.py:476`）。
- ✅ **論文問答對話持久化 + streaming**（2026-07-14，v4.20.0，使用者已驗收）：
  chat_messages 表（歷史存伺服器端、每篇上限 200 則、delete_paper 級聯）＋
  `POST /chat/stream` SSE＋抽屜改非 modal（點 [EDU] 引用背景 PDF 可互動）。
- **部署自動備份/監控**：目前僅手動 `docker compose cp` 一條指令，且 uploads/ 與 neo4j-data 完全無備份。對「給老師長期用」是缺口（見 E7 備份修法）。

### E7. 文件失真盤點

**本次已修**（工作區未 commit）：
- **Phase 2 few-shot 迴路**（最嚴重）：SYSTEM.md §3.6 / §10.3、DB_SCHEMA.md、TODO 待辦 7 原稱「已閉合、實作在 `db.get_judgment_examples`」→ 該函式全 codebase 不存在（已驗證），現改為「zero-shot、擷取端已閉/注入端未實作」，與 REL-rules-explained.md §8 對齊。
- SYSTEM.md：§3.9 平行化「分支未合併」→ 已在 main；§4.1 `docker compose up -d` 更正為起全套三容器（native dev 用 `up -d neo4j`）；§5.2「五種邊」→ 六種邊；§3.8 prompts 清單 6 個 → 16 個；§6「編輯模式」從長期未做 → 標已上線。
- DB_SCHEMA.md：4 張表 → 9 張表；`pdf_path` 絕對路徑 → basename；`rule_meta` 移除不存在的 `examples_used`；範例 SQL 與 model 範例名（claude-sonnet-4-6 → gpt-5.4）更正。
- REL-rules-explained.md §5：cross-section 預設模型 gpt-4.1 → gpt-5.4。
- README：`ANTHROPIC_API_KEY` → `OPENAI_API_KEY`；`pip install -e .` → `".[test]"`；DB_SCHEMA 表數。

**尚待修**（量大或屬漸進維護，未動）：
- README §啟動流程：仍說 `docker compose up -d` 只起 Neo4j、`neo4j_data/` bind mount（已改 named volume）。
- README §下一步路線圖：與 TODO「backlog 單一來源」分工衝突，且優先序是 2026-05 舊狀態——建議整段刪除改為指向本檔。
- README §API 表：缺 `/api/judgments/export`、`/api/eval/summary`、`/api/admin/*` 與整組 `/api/editor/*`。
- docker-compose.yml 檔頭註解：稱密碼從 `backend/.env` 讀，實際 compose 只讀根目錄 `.env`（見 E2 部署設定問題）。

---

## 待決策

- [ ] 消融實驗若結論不支持假設，論文如何定調（改敘事 vs 調實驗設計）——以 HANDOVER 的實測為準討論
- [ ] 規則回饋校準需要領域專家標註樣本，誰來標、標多少
- [ ] benchmark（PeerRead / AAEC 等）是否進論文——目前傾向自建語料為主軸
