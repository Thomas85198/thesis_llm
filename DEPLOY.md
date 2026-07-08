# 部署指南（實驗室伺服器）

論文邏輯缺陷檢核系統的生產部署說明。針對實驗室伺服器 `140.115.54.62`，
對外只開放單一 port `8083`。

## 架構

```
瀏覽器 ──► 140.115.54.62:8083 ──► Caddy ┬─ /api/* ─► backend  (FastAPI)
                                        └─ /*     ─► frontend (Next.js)
                          backend ──► neo4j   (都在 compose 內網，不對外)
```

實驗室防火牆只放行一個對外 port，所以 `frontend` / `backend` / `neo4j`
全部留在 compose 內網，**只有 Caddy 綁 host port 8083**。Caddy 依路徑分流：
後端所有路由都在 `/api/*` 底下，其餘交給 Next.js。瀏覽器只看到單一 origin，
因此不需要處理 CORS。

相關檔案：

| 檔案                      | 用途                                                                 |
| ------------------------- | -------------------------------------------------------------------- |
| `docker-compose.prod.yml` | 生產 stack 定義（neo4j + backend + frontend + caddy）                |
| `Caddyfile`               | 單一 port 的路徑分流規則                                             |
| `backend/.env`            | OpenAI key、模型設定（**不進 git**）                                 |
| `.env`（repo 根目錄）     | `NEO4J_PASSWORD`、`PUBLIC_BASE`，供 compose 變數插值（**不進 git**） |

> 本機開發仍可用 `docker-compose.yml`（會各自開 3000 / 8000 兩個 port），
> 或直接 `uvicorn` + `npm run dev`。`docker-compose.prod.yml` 只用於伺服器。

## 前置需求

伺服器端：

- Docker + Docker Compose v2 以上（伺服器已有 Docker 29 / Compose v5）
- 使用者在 `docker` 群組（免 sudo 跑 docker）
- 對外開放 port `8083`（實驗室已開）
- 記憶體 ≥ 8 GB（Neo4j 5 吃記憶體；伺服器有 119 GB，無虞）

手邊要準備：

- `OPENAI_API_KEY`（正式額度）
- 伺服器 SSH 帳號

## 首次部署

```bash
# 1. SSH 進伺服器
ssh luchienlin@140.115.54.62

# 2. clone（部署直接用 main，feat/openai-deploy 已合併並刪除）
cd ~
git clone https://github.com/Thomas85198/thesis_llm.git
cd thesis_llm

# 3. 設定 backend/.env（OpenAI key 等）
cp backend/.env.example backend/.env
nano backend/.env          # 至少填 OPENAI_API_KEY
#   注意：CORS_ORIGIN_REGEX / FRONTEND_URL / NEO4J_URI / NEO4J_PASSWORD
#   會被 docker-compose.prod.yml 的 environment 覆寫，這裡不必改。

# 4. 設定 root .env（compose 變數插值用）
cat > .env <<EOF
NEO4J_PASSWORD=$(openssl rand -hex 16)
PUBLIC_BASE=http://140.115.54.62:8083
EOF

# 5. build 並啟動
docker compose -f docker-compose.prod.yml up -d --build
```

> `backend/.env` 也可以直接從本機 `scp` 過去，省得重填：
> `scp backend/.env luchienlin@140.115.54.62:~/thesis_llm/backend/.env`

### 驗證

```bash
# 伺服器內部
docker compose -f docker-compose.prod.yml ps          # 四個容器都 Up，neo4j healthy
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8083/          # 200
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8083/api/rules # 200
```

從本機瀏覽器開 <http://140.115.54.62:8083> 應看到上傳頁與 13 條 REL 規則。

## 更新程式

```bash
ssh luchienlin@140.115.54.62
cd ~/thesis_llm
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

只動到單一服務時可只 build 該服務，例如改前端：

```bash
docker compose -f docker-compose.prod.yml up -d --build frontend
```

> `NEXT_PUBLIC_API_BASE` 是 **build-time** 變數（烙進前端 bundle）。
> 若 `PUBLIC_BASE` 改了（換 IP / port），前端一定要重新 `--build`，不能只 restart。

## 日常操作

```bash
cd ~/thesis_llm

# 看 log
docker compose -f docker-compose.prod.yml logs -f            # 全部
docker compose -f docker-compose.prod.yml logs -f backend    # 單一服務

# 重啟 / 停止 / 啟動
docker compose -f docker-compose.prod.yml restart
docker compose -f docker-compose.prod.yml stop
docker compose -f docker-compose.prod.yml start

# 整個拆掉（保留資料 volume）
docker compose -f docker-compose.prod.yml down

# 連資料一起清掉（⚠️ 會刪掉所有論文與圖譜）
docker compose -f docker-compose.prod.yml down -v
```

### 資料位置

資料存在 Docker named volume，容器重建不會遺失：

| Volume                  | 內容                            |
| ----------------------- | ------------------------------- |
| `thesis_llm_app-data`   | SQLite (`data.db`) + 上傳的 PDF |
| `thesis_llm_neo4j-data` | Neo4j 圖譜                      |
| `thesis_llm_caddy-data` | Caddy 內部狀態                  |

備份 SQLite：

```bash
docker compose -f docker-compose.prod.yml cp backend:/data/data.db ./backup-data.db
```

## 疑難排解

**前端顯示「後端未連線」**
SSR（server component）在 frontend 容器內 fetch，必須走 compose 內網。
確認 `docker-compose.prod.yml` 裡 frontend 有 `API_INTERNAL_BASE: http://backend:8000`。

**8083 連不到（從外部）**
先在伺服器內 `curl localhost:8083` ——

- 內部通、外部不通 → 防火牆問題，找實驗室管理者確認 8083 對外放行。
- 內部也不通 → `docker compose ... ps` 看 caddy 是否 Up，`logs caddy` 看錯誤。

**Neo4j 起不來 / `Exit 137`**
記憶體不足被 OOM kill。本伺服器記憶體充足，若仍發生檢查 Docker 是否有
記憶體限制設定。

**port 衝突**
host 的 `8000` 已被其他容器（`ncu-asr`）佔用。本 stack 設計上只佔 `8083`，
不應衝突；若改設定要對外開其他 port，先 `ss -tlnp` 確認沒被佔。

## 注意事項

- **HTTP 明碼**：目前無 HTTPS（無網域、使用 campus IP）。校內 demo 可接受；
  若要長期對外，建議申請子網域 + 讓 Caddy 自動處理 Let's Encrypt 憑證。
- **機密不進 git**：`backend/.env` 與根目錄 `.env` 都在 `.gitignore`，
  只存在於伺服器本機。換機器部署要重新建立。
- **首次部署資料庫為空**：volume 全新，第一篇論文需重新上傳處理。
