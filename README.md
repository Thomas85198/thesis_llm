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

- ✅ PDF/TXT 上傳與抽取 (PyMuPDF，含 page+bbox)
- ✅ EDU 切分 + 回映原始座標 (rapidfuzz)
- ✅ ER / RST / FRU 標註 (Claude tool use)
- ✅ Neo4j Knowledge Graph 寫入
- ✅ 13 條 REL 規則檢核 (Cypher + LLM 雙層)
- ✅ FastAPI endpoints (`/api/upload`, `/api/jobs/...`, `/api/papers/...`, `/api/rules`)
- ✅ CORS middleware (允許 localhost:3000)
- ✅ Next.js 16 + shadcn/ui 前端骨架
- ✅ 整合測試頁 (連到 backend 列出 13 條規則)

## 規則來源

51 條章節分層規則 (Intro 12 / Method 12 / Exp 15 / Conclusion 12) → MECE 收斂為 13 條 (REL-01 ~ REL-13)。
規則放在 `backend/rules.yaml`，由學長維護。Related Work **不**納入檢核（老師決定）。

## API

| Method | Path | 說明 |
|---|---|---|
| POST | `/api/upload` | 上傳論文 (multipart, `file` + 選填 `title`) |
| GET | `/api/jobs/{job_id}` | 工作狀態 (queued / extracting / checking / done / error) |
| GET | `/api/papers/{paper_id}/pdf` | 回傳原始 PDF（給前端 viewer） |
| GET | `/api/papers/{paper_id}/graph` | KG 節點+邊 |
| GET | `/api/papers/{paper_id}/edus/{edu_id}` | EDU detail (text, page, bbox) |
| GET | `/api/rules` | 列出 13 條規則 |

## 下一步路線圖

| 優先 | 任務 | 工程量 |
|---|---|---|
| ⭐⭐⭐ | 前端：上傳頁 + 進度回報 (SSE) | 半天 |
| ⭐⭐⭐ | 前端：PDF Viewer + 缺陷高亮（雙向連結） | 一天 |
| ⭐⭐ | 前端：React Flow KG 視覺化 | 半天 |
| ⭐ | 後端：論文列表、重跑規則、token 用量記錄 | 半天 |
