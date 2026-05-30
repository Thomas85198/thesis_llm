# 12-Factor 體檢報告 + 微服務化目標架構

> 撰寫：2026-05-30 ｜ 目的：練手用的 baseline。先量出「現在站在哪」，再決定要不要動手。
> 對照範圍：`backend/`（FastAPI pipeline）為主，含 `docker-compose*.yml` 部署。
> 每條判定都引用實際 code 位置（`檔案:行`），不空談。

---

## TL;DR

這個專案**比一般人想像的更接近 12-factor**——最痛的「設定走環境變數（III）」你早就做對了。
真正不及格的是**三條互相牽連的因子**，而且它們全部指向同一個結構問題：

> **分析 pipeline 跑在 web 行程內（`BackgroundTasks`），job 狀態存在記憶體，狀態檔（SQLite + 上傳 PDF）綁在本機磁碟。**

這一個結構問題同時害你違反 **VI（無狀態行程）、IX（可丟棄性）、VIII（並行）**，並讓 **IV（後端服務）** 打折。
好消息：這代表**只要做對一刀**（把 pipeline 抽成 Worker + Queue、狀態外部化），就能一次補掉一半的因子——這也正是練微服務最值得學的那一刀。

| 等級 | 因子 |
|---|---|
| ✅ 及格 | I 程式庫、II 依賴、III 設定、VII 連接埠綁定、X 開發-正式對等 |
| ⚠️ 部分 | IV 後端服務、V 建置/釋出/執行、VIII 並行、XII 管理程序 |
| ❌ 不及格 | VI 無狀態行程、IX 可丟棄性、XI 記錄 |

---

## 逐項對照

### I. 程式庫（Codebase）— ✅ 及格
單一 git repo，多個部署（local dev + 線上 `.62`）。符合「一份程式庫、多份部署」。

### II. 依賴（Dependencies）— ✅ 及格
- `backend/pyproject.toml` 明確宣告依賴，未依賴系統層套件隱式存在。
- `backend/Dockerfile` 多階段建置，builder 裝 `build-essential`、runtime 只留必要物（tini、tesseract）。
- 唯一「系統依賴」是 OCR 的 tesseract，但它**被明確寫進 Dockerfile** 並設 `TESSDATA_PREFIX`，不算隱式依賴。

### III. 設定（Config）— ✅ 及格（本專案最大亮點）
設定確實**外部化到環境變數**，而非寫死在 code：
- `backend/app/llm.py:56,64,68,73,79,92`：`OPENAI_BASE_URL` / `OPENAI_MODEL_*` / `LLM_TEMPERATURE` / `OPENAI_MAX_WORKERS`
- `backend/app/kg.py:25-28`：`NEO4J_URI` / `NEO4J_USER` / `NEO4J_PASSWORD`
- `backend/app/db.py:23-28`、`backend/app/routes.py:42-47`：`SQLITE_PATH` / `DATA_DIR` / `UPLOAD_DIR`
- `backend/main.py:25-29`：`CORS_ORIGIN_REGEX` / `FRONTEND_URL`
- secrets（OPENAI key、neo4j 密碼）走 `.env`，未進版控（部署文件 `docker-compose.prod.yml:9-12` 也是這流程）。

> 小瑕疵：預設值寫死在 code（如 `.48` 的 CORS regex），但都可被環境變數覆寫，不算違反。

### IV. 後端服務（Backing services）— ⚠️ 部分
- ✅ **Neo4j**：透過 `NEO4J_URI` 掛載（`kg.py:25`），是可抽換的附加資源——教科書級正確。
- ✅ **OpenAI**：透過 `OPENAI_BASE_URL` 可換 endpoint（`llm.py:56`）。
- ❌ **SQLite**：是**內嵌的本機檔案**（`db.py:22-29` 解析成 `<DATA_DIR>/data.db`），不是「可從網路掛載、可抽換」的後端服務。換機器 = 搬檔案。
- ❌ **上傳的 PDF**：存本機 `<DATA_DIR>/uploads/`（`routes.py:39-52`），同樣綁死磁碟。

> 這是 VI 不及格的根因之一，見下。

### V. 建置、釋出、執行（Build, release, run）— ⚠️ 部分
- ✅ 建置階段清楚（多階段 Dockerfile）。
- ⚠️ 缺「釋出（release）= 建置產物 + 設定」的**不可變、有版本編號**的概念。目前部署是「server 上 `git pull` → 重 build」，沒有 immutable release artifact、沒辦法乾淨 rollback 到某個 release ID。
- `frontend/lib/version-log.ts` 的版本號是**應用層 changelog**，不是部署 release 的識別碼（兩者不同）。

### VI. 行程（Processes）— ❌ 不及格（核心問題）
web 行程**不是無狀態**，三層狀態都黏在行程上：
1. **記憶體 job 狀態**：`routes.py:67` `_jobs: dict` + `_jobs_lock`——job 進度只活在這個行程的記憶體裡。
2. **行程內背景任務**：`routes.py:234` `background.add_task(_run_analysis, ...)` 用 FastAPI `BackgroundTasks`，整條 pipeline（抽取→建圖→規則→cross-section）**跑在 web 行程裡**（`_run_analysis` 在 `routes.py:82`）。
3. **本機磁碟狀態**：SQLite + uploads（見 IV）。

> 後果：**無法水平複製 web 行程**。開兩個 replica，使用者 A 的 job 狀態在 replica-1 的記憶體，他輪詢 `/api/jobs/{id}` 若被導到 replica-2 就查無此 job。

### VII. 連接埠綁定（Port binding）— ✅ 及格
uvicorn 自帶 server 綁 port，服務自包含；正式環境由 Caddy 反向代理（`docker-compose.prod.yml:74-86`、`Caddyfile`）。

### VIII. 並行（Concurrency）— ⚠️ 部分
- 目前靠**行程內 thread pool**（`llm.py:90` `OPENAI_MAX_WORKERS`，預設 6）平行打 LLM——這是「行程內並行」。
- 12-factor 要的是**用行程模型擴展**：不同工作型態應為不同 process type（web / worker），各自可獨立 `scale`。現在只有一種行程，承擔了 web + worker 兩種職責。

### IX. 可丟棄性（Disposability）— ❌ 不及格
- ✅ 啟動快；tini（`Dockerfile`）給正確的 PID 1 訊號處理。
- ❌ **job 不可恢復**：分析跑到一半行程被 kill / 重啟 / OOM，記憶體裡的 `_jobs` 狀態與正在跑的 `_run_analysis` 直接蒸發，**沒有 queue、沒有 retry、沒有冪等重跑**。使用者只會看到 spinner 永遠轉。
- 沒有「把進行中工作交還佇列」的機制——因為根本沒有佇列。

### X. 開發-正式對等（Dev/prod parity）— ✅ 及格
`docker-compose.yml`（dev）與 `docker-compose.prod.yml`（prod）用同一套 image / 服務，差別只在 port 暴露與反向代理。對等性良好。

### XI. 記錄（Logs）— ❌ 不及格
- 用 `print()` 印（`llm.py:205,211,218`），靠 `PYTHONUNBUFFERED=1`（`Dockerfile`）勉強進 stdout——**技術上是 stream，但沒有紀律**：無 log level、無結構化、無 request/job 關聯 id。
- 真正的事件資料（token/cost）被寫進 **SQLite 的 `llm_calls` 表**（`db.py:81`）當資料用——這合理（那是業務資料），但「應用程式不該自己管 log 路由」這條精神只做了一半。
- 缺：結構化 logger、一致的 stdout JSON、讓平台去聚合。

### XII. 管理程序（Admin processes）— ⚠️ 部分
- ✅ 有一次性管理腳本 `backend/scripts/migrate_pdf_path.py`，且被 COPY 進 image（`Dockerfile`），可在同環境跑。
- ⚠️ 但 schema 初始化是 app 啟動時隱式跑（`db.py` 的 lazy init + `_init_lock`），沒有獨立的 migration 步驟；資料庫演進靠 `CREATE TABLE IF NOT EXISTS`，沒有版本化 migration 工具。

---

## 目標架構（練手要爬到的山頂）

把「同步 API」與「耗時 LLM pipeline」沿著佇列切開——這一刀同時補掉 VI / VIII / IX，並把 IV 補滿：

```
現在（單體）:
  [FastAPI 行程] ──(行程內 BackgroundTasks + thread pool 跑整條 pipeline)──> Neo4j
       └─ _jobs dict（記憶體）+ SQLite 檔 + 上傳 PDF 都黏在這個行程/本機

目標:
  [Web API]  ──enqueue job──> [Queue]  ──dequeue──> [Worker(s)]
   無狀態、可複製 N 份         (Redis/RQ          跑 pipeline、可獨立 scale 到 N 份
   只收上傳 / 查狀態 / 回結果   或 Celery)         job 狀態與結果寫進外部 DB
        │                                              │
        └──────────────┬───────────────────────────────┘
            [Postgres]      [Object Store(MinIO/S3)]      [Neo4j]
          job + 結果 + cost      存上傳 PDF（取代本機         已是合格的
          （取代 SQLite）         uploads/）                 後端服務
```

### 每個改動補哪條因子

| 改動 | 補的因子 | 學到的真實概念 |
|---|---|---|
| pipeline 從 `BackgroundTasks` → 獨立 **Worker 行程** | VI、VIII、IX | 行程型態分離（web vs worker）、用行程模型擴展 |
| 引入 **Queue**（Redis + RQ，或 Celery） | IX、VI | job 持久化、行程死了能重新派發、冪等消費 |
| `_jobs` 記憶體 dict → **DB 的 jobs 表** | VI、IX | 無狀態 web（任一 replica 都能回答 job 狀態） |
| SQLite → **Postgres** | IV、VI | 後端服務當可掛載資源、多行程並發寫 |
| 上傳 PDF → **MinIO/S3** | IV、VI | 行程不再持有本機檔案 |
| `print()` → **結構化 stdout logger** | XI | logs 當事件流，平台負責聚合 |
| 加 **release id / migration 步驟** | V、XII | build/release/run 分離、版本化 migration |

---

## 建議分階段路線（每階段可獨立交付，逐步加深）

> 原則：**全程在 `feat/microservices` 分支做，`main` 的可用論文 demo 不受影響。**

1. **Phase 1 — logs + 設定收尾**（最小、零風險暖身）
   `print()` → `logging` 結構化、補齊環境變數說明。練 XI，順手把 III/V 的小瑕疵補掉。
2. **Phase 2 — 狀態外部化**
   SQLite → Postgres（`db.py` 抽象層換掉）、上傳 PDF → MinIO。**做完仍是單體**，但 web 行程已「準無狀態」。練 IV，鋪 VI 的路。
3. **Phase 3 — Worker + Queue（練手精華）**
   `BackgroundTasks` → Redis + RQ；`_jobs` dict → jobs 表；新增獨立 worker 行程型態（compose 多一個 service）。一次補 VI / VIII / IX。
4. **Phase 4（進階、邊際遞減）** — 把 `chat` 或 `rules` 再切成獨立服務，練「服務間契約 + 呼叫」。可選。

---

## 一句話結論

> 這個 app 的 12-factor 罩門不是「設定」（那條你做得很好），而是**「把長工作跑在 web 行程裡」**。
> 沿著佇列把 pipeline 切成 Worker，是補因子 CP 值最高、也最像真實微服務的一刀——很適合練手。
