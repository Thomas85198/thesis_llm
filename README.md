# 論文檢核系統 v3

實驗室 thesis checker — 上傳論文 → 建 Knowledge Graph → 用 13 條 REL 規則檢核 → 輸出邏輯缺陷與修改建議。

## 目錄結構

```
thesis_llm_demo_v3/
├── backend/                  # FastAPI + Python pipeline
│   ├── main.py
│   ├── app/
│   │   ├── routes.py
│   │   ├── pipeline.py       # PyMuPDF + EDU/ER/RST/FRU + bbox 映射
│   │   ├── kg.py             # Neo4j 寫入/查詢
│   │   ├── rules.py          # 13 條規則 + 跨章節 second pass + Phase 2 few-shot
│   │   ├── chat.py           # 論文助手 + Guardrails (scope / injection / rate limit)
│   │   ├── db.py             # SQLite (papers/results/judgments/llm_calls)
│   │   ├── prompts.py        # backend/prompts/*.md loader
│   │   ├── llm.py
│   │   └── schemas.py
│   ├── prompts/              # 集中化的 system prompts（學長可改不用碰 Python）
│   │   ├── edu.md
│   │   ├── er.md
│   │   ├── rst_fru.md
│   │   ├── checker.md
│   │   ├── chat.md
│   │   └── cross_section.md
│   ├── rules.yaml            # 13 條 REL 規則 (學長維護)
│   ├── pyproject.toml
│   ├── .env                  # ANTHROPIC_API_KEY 等
│   └── uploads/              # 上傳的 PDF（讓前端能取回）
│
├── frontend/                 # Next.js 16 + Tailwind 4 + shadcn/ui
│   ├── app/
│   ├── components/ui/        # shadcn 組件
│   ├── lib/api.ts            # 後端 API wrapper
│   └── package.json
│
├── docker-compose.yml        # Neo4j (port 7474/7687)
├── neo4j_data/               # Neo4j 持久化
└── README.md
```

## 啟動流程

第一次設置（三個 terminal）：

### Terminal 1：Neo4j

```bash
docker compose up -d
# Neo4j Browser: http://localhost:7474
# 帳號 neo4j / 密碼 thesis_demo_pw
```

### Terminal 2：Backend

```bash
cd backend
python3.11 -m venv .venv
source .venv/bin/activate
pip install -e .
cp .env.example .env  # 填入 ANTHROPIC_API_KEY
uvicorn main:app --reload --reload-dir app
# → http://localhost:8000
```

### Terminal 3：Frontend

```bash
cd frontend
cp .env.local.example .env.local  # 第一次需要
npm install                       # 第一次需要
npm run dev
# → http://localhost:3000
```

## 已實作

**Pipeline**
- ✅ PDF/TXT 上傳與抽取 (PyMuPDF，含 page+bbox)
- ✅ EDU 切分 + 回映原始座標 (rapidfuzz)
- ✅ ER / RST / FRU 標註 (OpenAI function calling)
- ✅ Neo4j Knowledge Graph 寫入
- ✅ 13 條 REL 規則檢核 (Cypher 候選 + LLM 判讀)
- ✅ **跨章節 second pass** (gpt-5.4 1M context) 補強 REL-04/08/12 — `ENABLE_CROSS_SECTION_PASS=0` 可關
- ✅ **Prompt 集中化**到 `backend/prompts/*.md` — 學長改 prompt 不用碰 Python
- ✅ **LLM Confidence 分數** — 每個 defect 帶 0–1 信心分，前端用色塊顯示

**前端**
- ✅ Next.js 16 + Tailwind 4 + shadcn/ui
- ✅ 上傳頁含進度回報、toast、自動跳轉
- ✅ 結果頁 PDF viewer + 缺陷面板雙向連結（react-pdf）
- ✅ 缺陷面板支援**依嚴重度 / 規則分組**、hover 看完整 evidence、confidence 色塊
- ✅ KG 視覺化（React Flow + dagre layout + minimap，Entity / FRU 兩層）
- ✅ CSV 報告匯出（UTF-8 BOM）
- ✅ RWD（mobile / tablet / desktop）
- ✅ 論文助手聊天抽屜（Sheet）— 限定本篇 scope、強制 cite [EDU:xxx] / [DEFECT:xxx] 可點擊跳轉
- ✅ **/stats 規則統計頁** — 每條規則的命中率、precision、Phase 2 樣本充足度
- ✅ 歷史頁支援**多選批次刪除**（同步清 SQLite + Neo4j + PDF）

**持久化與評估**
- ✅ SQLite 持久化（papers / results / hash 快取）— 重啟仍保留
- ✅ Token / cost logger — 每篇成本即時顯示，全域統計
- ✅ Human-as-judge UI 與 SQLite 紀錄
- ✅ **Phase 2 — Judgment → LLM Few-shot 回饋迴路**：每條規則累積 ≥3 筆判定後，自動把 correct/wrong 範例 inject 到下次規則檢核的 system prompt

## 規則來源

51 條章節分層規則 (Intro 12 / Method 12 / Exp 15 / Conclusion 12) → MECE 收斂為 13 條 (REL-01 ~ REL-13)。
規則放在 `backend/rules.yaml`，由學長維護。Related Work **不**納入檢核（老師決定）。

## API

| Method | Path | 說明 |
|---|---|---|
| POST | `/api/upload` | 上傳論文 (multipart, `file` + 選填 `title`)，hash 命中快取會直接回傳之前 paper_id |
| GET | `/api/jobs/{job_id}` | 工作狀態 (queued / extracting / checking / done / error) |
| GET | `/api/papers` | 所有分析過的論文 |
| DELETE | `/api/papers/{paper_id}` | 刪除一篇論文（同步清 SQLite + Neo4j + PDF 檔） |
| GET | `/api/papers/{paper_id}/pdf` | 回傳原始 PDF |
| GET | `/api/papers/{paper_id}/result` | 完整 AnalysisResult (graph + defects) |
| GET | `/api/papers/{paper_id}/graph` | Neo4j 節點+邊（給 KG viewer） |
| GET | `/api/papers/{paper_id}/edus/{edu_id}` | EDU detail (text, page, bbox) |
| GET | `/api/papers/{paper_id}/cost` | 該篇 LLM 成本與 token breakdown |
| GET | `/api/cost` | 全域 LLM 成本統計 |
| GET | `/api/papers/{paper_id}/judgments` | 該篇所有人工判定 |
| POST | `/api/papers/{paper_id}/judgments` | 新增/更新某缺陷的判定 (`{defect_id, rule_id, verdict, note?}`) |
| DELETE | `/api/papers/{paper_id}/judgments/{defect_id}` | 取消該缺陷的判定 |
| GET | `/api/judgments/summary` | 全域 per-rule precision 與計數 |
| GET | `/api/rules` | 列出 13 條規則 |
| GET | `/api/rules/stats` | 每條規則跨論文命中分布 + judgments precision（給 /stats 頁） |
| POST | `/api/papers/{paper_id}/chat` | 論文助手聊天（`{messages: [{role, content}]}`），含 scope/injection guardrails，rate limit 15/min |

## 下一步路線圖

| 優先 | 任務 | 工程量 | 備註 |
|---|---|---|---|
| ⭐⭐⭐ | 學長累積 ~50 筆判定 → 跑 with/without few-shot ablation | 學長 0.5–1 day labeling | Phase 2 已就緒 |
| ⭐⭐ | Pre-annotation 評估工具 + F1 計算 | 1–2 天 | 等 50 筆 judgments 才有意義 |
| ⭐⭐ | OpenAI Batch API（51 篇實驗 50% 折扣） | 1–2 天 | 需要 pipeline async rewrite |
| ⭐ | Hybrid Local + Cloud（Ollama 跑 EDU/ER） | 2 天 | M1 Max 64GB 可行 |
| ⭐ | 跨論文 Entity 對齊 | 1–2 天 | entity dedup 是研究級題目 |
| ⭐ | Multi-agent (Claim/Evidence/Critic) | 2+ 天 | 需要重設計 pipeline |

詳見（文件已精簡為三份核心）：
- [docs/SYSTEM.md](docs/SYSTEM.md) — 完整系統設計（架構、處理流程、效能、KG 語意、操作）
- [docs/DB_SCHEMA.md](docs/DB_SCHEMA.md) — SQLite 4 張表中文說明 + ERD
- [docs/TODO.md](docs/TODO.md) — 近況、已完成項目、待辦明細、未來規劃

> Demo 報告 / 投影片 / Q&A 速查（`DEMO_REPORT.md` / `SLIDES.md` / `REPORT_QA.md`）已移除以精簡文件；舊版仍可從 git 歷史取回。網頁版說明見 `/about` 頁。
