# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

實驗室 thesis-checker：上傳論文 → 建 Knowledge Graph → 用 13 條 REL 規則檢核 → 輸出邏輯缺陷與修改建議。外加一個獨立的 AI 寫作編輯器子系統。Backend = FastAPI + Neo4j + SQLite；Frontend = Next.js 16 + Tailwind 4 + shadcn/ui。

## Commands

### Backend (`backend/`)
```bash
python3.11 -m venv .venv && source .venv/bin/activate
pip install -e ".[test]"          # runtime + pytest; add ",eval" for ablation plotting
cp .env.example .env              # fill OPENAI_API_KEY (see LLM provider note)
uvicorn main:app --reload --reload-dir app   # → http://localhost:8000
pytest                            # unit tests (must not touch network/LLM/Neo4j)
pytest tests/test_rewrite.py::test_name       # single test
```

### Frontend (`frontend/`)
```bash
npm install
npm run dev      # → http://localhost:3000
npm run build    # next build
npm run lint     # eslint
```

### Neo4j / integrated stack
```bash
docker compose up -d                 # Neo4j only for native dev (7474 browser / 7687 bolt)
docker compose up -d --build         # full prod-style stack (neo4j + backend + frontend)
```

## Architecture

### Analysis pipeline (upload → defects)
The core flow lives in `backend/app/` and runs stage-by-stage in `routes.py` (the upload/job orchestrator), `pipeline.py`, `kg.py`, `rules.py`:

1. **Extract** — `pipeline.py`: PyMuPDF pulls text + page/bbox; EDU (Elementary Discourse Unit) segmentation, then LLM annotation of Entities (ER), RST discourse relations, and FRU (Functional Rhetorical Units) via OpenAI function calling. rapidfuzz maps EDUs back to original coordinates.
2. **Build KG** — `kg.py`: writes Neo4j nodes **Paper / EDU / Entity / FRU / RST** and edges **HAS_EDU / COVERS / NUCLEUS / SATELLITE / ER / MENTIONED_IN**. This graph is the substrate every rule queries.
3. **Check rules** — `rules.py`: two passes.
   - *Per-section*: each rule's Cypher `candidate_query` pulls suspect subgraphs → LLM verdict (`checker.md` prompt, `VERDICT_SCHEMA`). Symbolic candidate + neural judge.
   - *Cross-section*: `cross_section_pass()` feeds the whole paper (grouped by section) to a 1M-context model for REL-04/08/12 (needs multi-section evidence, ≥2 EDUs). Toggle with `ENABLE_CROSS_SECTION_PASS=0`.
   - Then `localize_defects()` translates description/suggestion into non-primary locales.
4. **Persist** — `db.py`: SQLite (papers / results / judgments / llm_calls) with a content-hash cache so re-uploading an identical file returns the prior `paper_id` without recomputing.

**Rules are data-driven.** All 13 REL rules are defined in `backend/rules.yaml` (`id / name / description / candidate_query / defect_label`). Adding a rule = append YAML + decide per-section vs cross-section; the execution loop needs no code change. Rule semantics are documented in `docs/REL-rules-explained.md`.

**Prompts are data.** Every system prompt is a file in `backend/prompts/*.md` loaded via `prompts.py`. Change model behavior by editing markdown, not Python.

### Writing-editor subsystem
A separate feature set (frontend `components/editor/`, backend modules `rewrite.py`, `citation.py` / `openalex.py` / `crossref.py`, `grounding.py`, `claim_verifier.py`, `outline.py`, `autocomplete.py`, `draft_check.py`, `import_doc.py`, `export_doc.py`, `latex_compile.py`). TipTap v3 + Zustand editor with AI rewrite, citation search/verify (OpenAlex + semantic re-rank via embeddings), grounding, and multi-format import/export.

### LLM wiring
`llm.py` centralizes model selection: `model_heavy()` = `gpt-5.4`, `model_light()` = `gpt-5.4-mini`, `model_cross_section()` = 1M-context, `model_embed()` = `text-embedding-3-small`. All overridable via `OPENAI_MODEL_*` env vars.

## Conventions & gotchas

- **Provider is OpenAI, not Anthropic.** README still mentions `ANTHROPIC_API_KEY` — that's stale. The live provider is OpenAI (`OPENAI_API_KEY`); the anthropic dep is commented out in `pyproject.toml`.
- **Verify changes by rebuilding local docker.** The frontend runs as a built image (not hot-reload) for the reviewer's localhost check. After changes, rebuild the local docker stack and bring it up so it can be verified at `localhost`; don't consider work done on commit alone.
- **Adding a frontend dependency?** Regenerate `package-lock.json` with Node 20 (npm 10) or the docker `npm ci` fails with "Missing from lock file".
- **Docker build gotcha:** `docker compose build | tail` swallows failure exit codes (false success). Bring images up with `--force-recreate` when you need the new image guaranteed.
- **i18n is locale-as-data** (`next-intl`, URL prefixes `/zh-Hant` `/en`). Adding a language is zero schema change; LLM-generated content is stored as a `{locale: text}` map. See `docs/` and `frontend/messages/`.
- **Three-format export must stay consistent.** LaTeX / DOCX / PDF (PDF is compiled from LaTeX via bundled XeLaTeX in `latex_compile.py`). The format to keep aligned with LaTeX is DOCX; all three share `export_doc.py` helpers — change formatting rules in one place.
- **Fresh-deploy first upload** often fails with a Neo4j `TransientError` (constraint warm-up) — retry once, it's not an OpenAI issue.
- **Don't auto-commit/push** unless asked. Ablation research code under `backend/experiments/` is an offline tool — don't let it affect the product runtime.

## Deployment

Current lab server is **`140.115.54.62:8083`** (widm-rs720). Server stack via `docker-compose.prod.yml` + `Caddyfile`: everything on the compose internal network, only Caddy binds host port **8083** and path-routes `/api/*` → backend, `/*` → frontend (single origin, no CORS). Secrets live in `backend/.env` (OpenAI) and repo-root `.env` (`NEO4J_PASSWORD`, `PUBLIC_BASE`=the current host IP) — neither is in git. See `DEPLOY.md`.

## Key docs (kept intentionally minimal)
- `docs/SYSTEM.md` — full system design (architecture, KG semantics, performance, engineering insights §10).
- `docs/DB_SCHEMA.md` — SQLite tables + ERD.
- `docs/REL-rules-explained.md` — how the 13 rules work / are maintained.
- `docs/TODO.md` — current status + backlog (single source; historical decks removed, see git history).
- `backend/experiments/HANDOVER.md` — ablation study state and verified-results discipline.
