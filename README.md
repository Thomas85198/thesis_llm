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
│   │   ├── rules.py
│   │   ├── chat.py           # 論文助手 + Guardrails (scope / injection / rate limit)
│   │   ├── db.py             # SQLite (papers/results/judgments/llm_calls)
│   │   ├── llm.py
│   │   └── schemas.py
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
- ✅ ER / RST / FRU 標註 (Claude tool use)
- ✅ Neo4j Knowledge Graph 寫入
- ✅ 13 條 REL 規則檢核 (Cypher 候選 + LLM 判讀)

**前端**
- ✅ Next.js 16 + Tailwind 4 + shadcn/ui
- ✅ 上傳頁含進度回報、toast、自動跳轉
- ✅ 結果頁 PDF viewer + 缺陷面板雙向連結（react-pdf）
- ✅ KG 視覺化（React Flow + dagre layout，Entity / FRU 兩層）
- ✅ CSV 報告匯出（UTF-8 BOM）
- ✅ RWD（mobile / tablet / desktop）
- ✅ 論文助手聊天抽屜（Sheet）— 限定本篇 scope、強制 cite [EDU:xxx] / [DEFECT:xxx] 可點擊跳轉

**持久化與評估**
- ✅ SQLite 持久化（papers / results / hash 快取）— 重啟仍保留
- ✅ Token / cost logger — 每篇成本即時顯示，全域統計
- ✅ Human-as-judge UI 與 SQLite 紀錄（**目前只用於測量 precision，尚未自動回饋給 LLM** — 見 [docs/SYSTEM.md](docs/SYSTEM.md) §3.6）

## 規則來源

51 條章節分層規則 (Intro 12 / Method 12 / Exp 15 / Conclusion 12) → MECE 收斂為 13 條 (REL-01 ~ REL-13)。
規則放在 `backend/rules.yaml`，由學長維護。Related Work **不**納入檢核（老師決定）。

## API

| Method | Path | 說明 |
|---|---|---|
| POST | `/api/upload` | 上傳論文 (multipart, `file` + 選填 `title`)，hash 命中快取會直接回傳之前 paper_id |
| GET | `/api/jobs/{job_id}` | 工作狀態 (queued / extracting / checking / done / error) |
| GET | `/api/papers` | 所有分析過的論文 |
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
| POST | `/api/papers/{paper_id}/chat` | 論文助手聊天（`{messages: [{role, content}]}`），含 scope/injection guardrails，rate limit 15/min |

## 下一步路線圖

| 優先 | 任務 | 工程量 |
|---|---|---|
| ⭐⭐⭐ | **Phase 2 — 判定 → LLM few-shot 自動回饋**（閉合人工標註迴路） | 半天 |
| ⭐⭐ | Prompt 集中化到 `backend/prompts/*.md`（學長能不寫 Python 改 prompt） | 2 hr |
| ⭐⭐ | 規則命中分布頁 `/stats`（哪幾條從沒觸發） | 半天 |
| ⭐⭐ | 跨章節 second pass（Opus 1M context 補強 REL-04/08/12） | 半天 |
| ⭐ | LLM Confidence 分數（每個缺陷帶 0-1 信心分） | 2 hr |
| ⭐ | Pre-annotation 評估工具 + F1 計算（接續現有 judgments 資料） | 1-2 天 |

詳見 [docs/SYSTEM.md](docs/SYSTEM.md) §6 與 §10（工程經驗紀錄）。
