"use client";

import { ArrowDownIcon, Check, X } from "lucide-react";

import { MermaidDiagram } from "@/components/mermaid-diagram";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const SECTIONS = [
  { id: "intro", label: "1. 系統定位" },
  { id: "arch", label: "2. 系統架構" },
  { id: "pipeline", label: "3. Pipeline 時序圖" },
  { id: "kg", label: "4. KG 資料結構" },
  { id: "rds", label: "5. SQLite 資料結構" },
  { id: "rules", label: "6. 13 條 REL 規則" },
  { id: "example", label: "7. 範例走查（Vaswani 2017）" },
  { id: "phase2", label: "8. 人工評估機制" },
  { id: "guards", label: "9. 聊天 Guardrails" },
  { id: "literature", label: "10. 理論文獻" },
  { id: "perf", label: "11. 效能與穩定性" },
];

export default function AboutPage() {
  return (
    <div className="mx-auto w-full max-w-7xl gap-8 px-4 py-6 sm:px-6 lg:flex">
      {/* Sticky TOC */}
      <aside className="lg:sticky lg:top-20 lg:h-[calc(100vh-6rem)] lg:w-56 lg:shrink-0 lg:overflow-y-auto">
        <nav className="mb-6 rounded-md border bg-card p-3 lg:mb-0">
          <p className="mb-2 text-[11px] font-semibold uppercase text-muted-foreground">
            目錄
          </p>
          <ul className="space-y-1">
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  className="block rounded px-2 py-1 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  {s.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </aside>

      <div className="min-w-0 flex-1 space-y-12">
        {/* HERO */}
        <header className="space-y-4 border-b pb-8">
          <Badge variant="secondary" className="font-mono">
            系統說明 / Demo Report
          </Badge>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            論文檢核系統
          </h1>
          <p className="text-lg text-muted-foreground">
            用 Knowledge Graph + LLM 自動找學術論文的邏輯結構性缺陷
          </p>
          <p className="max-w-3xl text-base leading-relaxed">
            上傳論文 → 抽取 EDU / Entity / RST / FRU 四層結構並寫入 Neo4j Knowledge Graph
            → 用 13 條 REL 規則檢核（Cypher 找候選 + LLM 判讀）→ 輸出邏輯缺陷與修改建議。
            搭配 Human-as-judge 標註介面，由人工逐一檢查每個缺陷並量化系統 precision。
          </p>
          <a
            href="#intro"
            className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
          >
            開始閱讀 <ArrowDownIcon className="h-3 w-3" />
          </a>
        </header>

        {/* 1. 系統定位 */}
        <Section id="intro" title="1. 系統定位">
          <p>
            學術論文初稿常見三類「結構性」問題：(1) 主張無證據、(2) 缺乏動機、(3) 跨章節失聯。
            傳統靠人工 review 抓，慢且主觀。本系統的目標是把這個過程自動化、可重現、可追溯。
          </p>

          <h3>跟「直接問 ChatGPT 改論文」差在哪？</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs">
                <tr>
                  <th className="p-2 text-left">維度</th>
                  <th className="p-2 text-left">純 LLM 對話</th>
                  <th className="p-2 text-left">本系統</th>
                </tr>
              </thead>
              <tbody>
                <ComparisonRow
                  dim="結果可重現"
                  llm="每次答案不同"
                  ours="KG + 規則確定性"
                />
                <ComparisonRow
                  dim="追溯到原文位置"
                  llm="描述模糊"
                  ours="高亮 PDF 句子（page + bbox）"
                />
                <ComparisonRow
                  dim="規則可由人維護"
                  llm="黑盒"
                  ours="規則寫在 YAML，學長可改"
                />
                <ComparisonRow
                  dim="跨論文比較"
                  llm="做不到"
                  ours="KG 持久化於 Neo4j"
                />
                <ComparisonRow
                  dim="投論文的方法論支撐"
                  llm="缺乏"
                  ours="Neurosymbolic（KG + LLM hybrid）"
                />
              </tbody>
            </table>
          </div>
        </Section>

        {/* 2. 系統架構 */}
        <Section id="arch" title="2. 系統架構">
          <p>
            前後端分離 + 三層儲存。前端 Next.js 16 + Tailwind + shadcn/ui，後端 FastAPI；
            Neo4j 存 KG（給 Cypher 查詢）、SQLite 存中繼資料/分析結果/cost log/人工判定、
            本地磁碟存 PDF 原檔。
          </p>
          <MermaidDiagram
            caption="圖 2-1：三層架構與外部依賴（Neo4j / SQLite / Anthropic）"
            code={`flowchart LR
    User([使用者])
    FE["前端 Next.js 16<br/>Tailwind + shadcn/ui<br/>PDF Viewer + KG 視覺化"]
    BE["後端 FastAPI + Python<br/>pipeline / rules / chat / db"]
    Claude[(Anthropic Claude API<br/>Sonnet 4.6 / Opus 4.7)]
    Neo[(Neo4j<br/>Knowledge Graph)]
    SQL[(SQLite data.db<br/>papers / results / llm_calls / judgments)]
    Disk[(uploads/<br/>PDF 原檔)]

    User -- 上傳 / 操作 --> FE
    FE -- HTTP / JSON --> BE
    BE -- 抽取 / 判讀 / 聊天 --> Claude
    BE -- 寫入 + Cypher 查詢 --> Neo
    BE -- metadata + cost + judgments --> SQL
    BE -- 存 PDF 檔 --> Disk
    FE -- 拉 PDF / 結果 / 統計 --> BE`}
          />
        </Section>

        {/* 3. Pipeline 時序圖 */}
        <Section id="pipeline" title="3. Pipeline 時序圖">
          <p>
            分析時間主要花在 ~30–40 次 LLM 呼叫上。這些呼叫大多彼此獨立，因此會用
            thread pool 平行送出（預設最多 6 條，<code>OPENAI_MAX_WORKERS</code> 可調），
            把原本序列約 9 分鐘的分析壓到約 1/3。文字抽取與分析都在背景任務執行，
            上傳請求會立刻回 <code>job_id</code>，前端再輪詢進度。SHA-256 hash 命中快取則秒回。
          </p>
          <MermaidDiagram
            caption="圖 3-1：上傳論文後的完整處理流程（含 OCR fallback 與平行化）"
            code={`sequenceDiagram
    autonumber
    participant U as 使用者
    participant F as 前端
    participant B as 後端
    participant O as OpenAI API
    participant N as Neo4j
    participant S as SQLite

    U->>F: 上傳 PDF
    F->>B: POST /api/upload
    B->>B: SHA-256 hash 去重
    alt hash 命中
        B-->>F: 直接回傳之前 paper_id
    else 新檔案
        B-->>F: 立即回 job_id（背景處理）
        Note over B: 以下皆在背景任務執行
        B->>B: PyMuPDF 抽 spans + page+bbox
        alt 偵測到亂碼（無 ToUnicode CMap）
            B->>B: tesseract OCR fallback (chi_tra+eng)
        end
        B->>B: regex 切 sections
        par 各 section 平行 (thread pool ≤ OPENAI_MAX_WORKERS=6)
            B->>O: section A：EDU→ER (gpt-5.4-mini) → RST/FRU (gpt-5.4)
        and
            B->>O: section B：同上
        and
            B->>O: section …：同上
        end
        B->>N: 寫入 Paper + EDU + Entity + FRU + RST
        par 13 條 REL 規則平行 (同一 thread pool)
            B->>N: Cypher 找候選
            B->>O: LLM 判讀 (gpt-5.4, zero-shot)
        end
        B->>O: 跨章節 second pass (REL-04/08/12)
        B->>S: 寫 result_json + llm_calls
        B-->>F: job done + paper_id
    end
    F->>B: 拉 result + PDF + KG
    F-->>U: 結果頁 (PDF 高亮 + 缺陷面板 + KG 圖)`}
          />
        </Section>

        {/* 4. KG 資料結構 */}
        <Section id="kg" title="4. Knowledge Graph 資料結構">
          <p>
            KG 是這個系統的核心 — 13 條規則本質上都是 graph pattern matching。
            5 種節點代表論文不同層次的結構，6 種邊串起來。
          </p>

          <h3>5 種節點</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <NodeCard
              name="Paper"
              color="bg-rose-100 dark:bg-rose-950"
              attrs={["id", "title"]}
              meaning="論文本身。所有其他節點都透過 paper_id 指回它。"
            />
            <NodeCard
              name="EDU"
              color="bg-violet-100 dark:bg-violet-950"
              attrs={["id", "text", "section", "order", "page", "bbox", "paper_id"]}
              meaning="Elementary Discourse Unit，最小命題單位。每個 EDU 帶 page+bbox 座標 — 這是 PDF 高亮能精確定位的根基。"
            />
            <NodeCard
              name="Entity"
              color="bg-emerald-100 dark:bg-emerald-950"
              attrs={["id", "name", "type", "paper_id"]}
              meaning="論文裡的概念實體（例 Transformer、BLEU、WMT），分 8 種 type（Concept / Method / Metric / Dataset / Model / Task / Claim / Other）。"
            />
            <NodeCard
              name="FRU"
              color="bg-cyan-100 dark:bg-cyan-950"
              attrs={["id", "function", "summary", "paper_id"]}
              meaning="Functional Rhetorical Unit，把連續 EDU 組成修辭功能單元。15 種 function：Motivation / Claim / Evidence / Background / Definition / MethodStep / Observation / Attribution / Concession / ..."
            />
            <NodeCard
              name="RST"
              color="bg-amber-100 dark:bg-amber-950"
              attrs={["id", "rst_type", "paper_id"]}
              meaning="Rhetorical Structure Theory 的修辭關係，標 nucleus-satellite。15 種 type：Elaboration / Cause / Result / Contrast / Concession / Evidence / Justify / ..."
            />
          </div>

          <h3>6 種邊</h3>
          <MermaidDiagram
            caption="圖 4-1：KG schema — 五種節點與邊的連接關係"
            code={`flowchart TB
    Paper([Paper<br/>id, title]):::paper
    EDU[EDU<br/>id, text, section,<br/>order, page, bbox]:::edu
    Entity1[Entity<br/>name, type]:::entity
    Entity2[Entity<br/>name, type]:::entity
    FRU{{FRU<br/>function, summary}}:::fru
    RST[/RST<br/>rst_type/]:::rst

    Paper -- HAS_EDU --> EDU
    FRU -- COVERS --> EDU
    RST -- NUCLEUS --> EDU
    RST -- SATELLITE --> EDU
    Entity1 -- "ER {predicate, evidence_edu_id}" --> Entity2
    Entity1 -- MENTIONED_IN --> EDU

    classDef paper fill:#fecdd3,stroke:#be123c
    classDef edu fill:#ede9fe,stroke:#7c3aed
    classDef entity fill:#d1fae5,stroke:#059669
    classDef fru fill:#cffafe,stroke:#0891b2
    classDef rst fill:#fef3c7,stroke:#d97706`}
          />

          <h4 className="mt-4 mb-2 text-base font-semibold">6 種邊的意義 + Vaswani 範例</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs">
                <tr>
                  <th className="p-2 text-left">邊</th>
                  <th className="p-2 text-left">方向</th>
                  <th className="p-2 text-left">中文意義</th>
                  <th className="p-2 text-left">Vaswani 範例</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t">
                  <td className="p-2 font-mono text-xs">HAS_EDU</td>
                  <td className="p-2 text-xs">Paper → EDU</td>
                  <td className="p-2">「這篇論文擁有這個最小命題」</td>
                  <td className="p-2 text-xs">
                    Paper(<em>Attention Is All You Need</em>) HAS_EDU EDU(&ldquo;We propose a new simple network architecture, the Transformer&rdquo;)
                  </td>
                </tr>
                <tr className="border-t">
                  <td className="p-2 font-mono text-xs">COVERS</td>
                  <td className="p-2 text-xs">FRU → EDU</td>
                  <td className="p-2">「這個修辭功能單元涵蓋這個小命題」</td>
                  <td className="p-2 text-xs">
                    FRU(function=Claim) COVERS EDU(&ldquo;We propose the Transformer&rdquo;) — 這個 FRU 把這句歸類為主張類
                  </td>
                </tr>
                <tr className="border-t">
                  <td className="p-2 font-mono text-xs">NUCLEUS</td>
                  <td className="p-2 text-xs">RST → EDU</td>
                  <td className="p-2">「這個修辭關係的核心句是這個（主角）」</td>
                  <td className="p-2 text-xs">
                    RST(rst_type=Contrast) NUCLEUS EDU(&ldquo;We propose the Transformer&rdquo;) — 對比關係的「新方法」這方
                  </td>
                </tr>
                <tr className="border-t">
                  <td className="p-2 font-mono text-xs">SATELLITE</td>
                  <td className="p-2 text-xs">RST → EDU</td>
                  <td className="p-2">「這個修辭關係的從屬句是這個（配角）」</td>
                  <td className="p-2 text-xs">
                    同上 RST(Contrast) SATELLITE EDU(&ldquo;Existing models are based on RNN/CNN&rdquo;) — 對比關係的「舊方法」這方
                  </td>
                </tr>
                <tr className="border-t">
                  <td className="p-2 font-mono text-xs">ER</td>
                  <td className="p-2 text-xs">Entity → Entity</td>
                  <td className="p-2">「兩個概念之間有關係（動詞寫在邊屬性 predicate 上）」</td>
                  <td className="p-2 text-xs">
                    Entity(Transformer) -[ER {`{predicate: "based_on"}`}]-&gt; Entity(attention mechanism)
                  </td>
                </tr>
                <tr className="border-t">
                  <td className="p-2 font-mono text-xs">MENTIONED_IN</td>
                  <td className="p-2 text-xs">Entity → EDU</td>
                  <td className="p-2">「這個概念在這個小命題裡被提到」</td>
                  <td className="p-2 text-xs">
                    Entity(BLEU) MENTIONED_IN EDU(&ldquo;achieves 28.4 BLEU on WMT 2014&rdquo;)
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <h3>FRU 的 15 種 function（重點 — 規則檢核主要看這個）</h3>
          <p className="text-xs text-muted-foreground">
            一個 FRU 把連續幾個 EDU 組成一個「修辭功能單元」。15 種 function 就是論文寫作中常見的修辭角色。
          </p>
          <SubtypeTable items={FRU_FUNCTIONS} />

          <h3>RST 的 15 種關係類型</h3>
          <p className="text-xs text-muted-foreground">
            RST（Rhetorical Structure Theory）標兩個 EDU 之間的修辭關係，分 nucleus（主角）與 satellite（配角）。
            15 種 type 涵蓋論文中常見的句間邏輯。
          </p>
          <SubtypeTable items={RST_TYPES} />

          <h3>為什麼要 4 層抽取（EDU / ER / FRU / RST）</h3>
          <p>
            不同規則需要不同層的證據：
          </p>
          <ul>
            <li>
              <strong>REL-01 Claim-Evidence</strong>：需要 FRU 層分辨哪些 EDU 是 Claim、哪些是 Evidence
            </li>
            <li>
              <strong>REL-09 Observation-Attribution</strong>：需要 FRU + 同 section 鄰近度
            </li>
            <li>
              <strong>REL-04 Macro-Decomposition</strong>：需要跨章節 + RST 結構
            </li>
            <li>
              <strong>實體層級分析</strong>：需要 Entity + ER triples 追蹤同一概念跨段落出現
            </li>
          </ul>
        </Section>

        {/* 5. SQLite 資料結構 */}
        <Section id="rds" title="5. SQLite 資料結構（RDS）">
          <p>
            4 張表，互不重疊 — metadata、analysis result、cost log、human judgments。
            設計準則：結構性語意進 Neo4j，流水/評估資料進 SQLite。
          </p>
          <MermaidDiagram
            caption="圖 5-1：SQLite ERD — 4 張表的關聯（PK 後面備註: results.paper_id 也是 FK CASCADE; llm_calls/defect_judgments 是軟關聯）"
            code={`erDiagram
    papers ||--o| results : "1對1 CASCADE"
    papers ||--o{ llm_calls : "1對多 軟關聯"
    papers ||--o{ defect_judgments : "1對多 軟關聯"
    results ||--o{ defect_judgments : "邏輯關聯"

    papers {
        TEXT paper_id PK
        TEXT title
        TEXT content_hash
        TEXT pdf_path
        TEXT created_at
    }
    results {
        TEXT paper_id PK
        TEXT result_json
        TEXT finished_at
    }
    llm_calls {
        INTEGER id PK
        TEXT paper_id
        TEXT stage
        TEXT model
        INTEGER input_tokens
        INTEGER output_tokens
        REAL cost_usd
        TEXT created_at
    }
    defect_judgments {
        TEXT paper_id PK
        TEXT defect_id PK
        TEXT rule_id
        TEXT verdict
        TEXT note
        TEXT created_at
    }`}
          />

          <h3>四張表詳細欄位（中文說明）</h3>

          <TableSchema
            name="papers"
            purpose="論文中繼資料 + 上傳去重快取"
            keyDesign="content_hash 是 SHA-256，第二次傳同一份檔案直接秒回不重跑 LLM"
            columns={[
              { col: "paper_id", type: "TEXT PK", desc: "論文唯一識別 (格式 paper:xxxxxxxx，8 個 hex 字元)" },
              { col: "title", type: "TEXT", desc: "論文標題（使用者填或檔名）" },
              { col: "content_hash", type: "TEXT", desc: "檔案內容 SHA-256，用於上傳去重快取" },
              { col: "pdf_path", type: "TEXT", desc: "PDF 原檔在 backend/uploads/ 的絕對路徑" },
              { col: "created_at", type: "TEXT NOT NULL", desc: "建立時間 (ISO 8601 UTC)" },
            ]}
          />

          <TableSchema
            name="results"
            purpose="完整分析結果（KG + Defects + RuleMeta）"
            keyDesign="JSON 嵌套結構一次性讀寫，沒查詢需求拆表；CASCADE 與 papers 綁定（刪 paper 連帶刪 result）"
            columns={[
              { col: "paper_id", type: "TEXT PK / FK", desc: "對應 papers.paper_id，CASCADE 刪除" },
              { col: "result_json", type: "TEXT NOT NULL", desc: "完整 AnalysisResult JSON（內含 graph + defects + rule_meta）" },
              { col: "finished_at", type: "TEXT NOT NULL", desc: "分析完成時間 (ISO 8601 UTC)" },
            ]}
          />

          <TableSchema
            name="llm_calls"
            purpose="每次 LLM 呼叫的 token / cost log"
            keyDesign="每呼叫一次 Anthropic API 就 INSERT 一筆；給 /api/cost 結算 + context 使用率監控 + 找最貴的 stage"
            columns={[
              { col: "id", type: "INTEGER PK AUTOINCREMENT", desc: "流水號" },
              { col: "paper_id", type: "TEXT", desc: "屬於哪篇論文（可 NULL，未來預留 system call）" },
              { col: "stage", type: "TEXT NOT NULL", desc: "pipeline 階段，例 edu:Method / er:Intro / rule_check:REL-09 / cross_section_pass / chat" },
              { col: "model", type: "TEXT NOT NULL", desc: "使用的 Claude model id（如 claude-sonnet-4-6）" },
              { col: "input_tokens", type: "INTEGER NOT NULL", desc: "此次 input token 數" },
              { col: "output_tokens", type: "INTEGER NOT NULL", desc: "此次 output token 數" },
              { col: "cache_read_tokens", type: "INTEGER DEFAULT 0", desc: "從 prompt cache 讀的 token（比 input 便宜 10×）" },
              { col: "cache_write_tokens", type: "INTEGER DEFAULT 0", desc: "寫入 prompt cache 的 token（首次）" },
              { col: "cost_usd", type: "REAL NOT NULL", desc: "此次美元成本（依 llm.py PRICING 計算）" },
              { col: "created_at", type: "TEXT NOT NULL", desc: "呼叫時間 (ISO 8601 UTC)" },
            ]}
          />

          <TableSchema
            name="defect_judgments"
            purpose="Human-as-judge 標註（人工評估）"
            keyDesign="複合主鍵 (paper_id, defect_id) 確保同缺陷一個 verdict；verdict CHECK 限定三選一防髒資料"
            columns={[
              { col: "paper_id", type: "TEXT PK", desc: "缺陷所屬論文" },
              { col: "defect_id", type: "TEXT PK", desc: "缺陷 id，對應 results.result_json 內 defects[].id" },
              { col: "rule_id", type: "TEXT NOT NULL", desc: "該缺陷觸發的規則 (REL-01 ~ REL-13)" },
              { col: "verdict", type: "TEXT CHECK", desc: "必為 correct (判對) / wrong (誤判) / partial (部分對) 三選一" },
              { col: "note", type: "TEXT", desc: "學長補充說明（選填）" },
              { col: "created_at", type: "TEXT NOT NULL", desc: "標註時間 (ISO 8601 UTC)" },
            ]}
          />

          <h3>關係強度說明</h3>
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs">
              <tr>
                <th className="p-2 text-left">關係</th>
                <th className="p-2 text-left">強度</th>
                <th className="p-2 text-left">為什麼</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t">
                <td className="p-2 font-mono text-xs">papers ↔ results</td>
                <td className="p-2">Hard FK + CASCADE</td>
                <td className="p-2">沒了 paper 留 result 沒意義</td>
              </tr>
              <tr className="border-t">
                <td className="p-2 font-mono text-xs">papers ↔ llm_calls</td>
                <td className="p-2">軟關聯</td>
                <td className="p-2">刪 paper 要保留 cost log 給歷史 audit</td>
              </tr>
              <tr className="border-t">
                <td className="p-2 font-mono text-xs">papers ↔ judgments</td>
                <td className="p-2">軟關聯</td>
                <td className="p-2">judgments 是人工評估資料，刪 paper 不該丟</td>
              </tr>
              <tr className="border-t">
                <td className="p-2 font-mono text-xs">judgments ↔ results.json</td>
                <td className="p-2">邏輯關聯</td>
                <td className="p-2">defect_id 在 JSON 內，靠程式層保證一致</td>
              </tr>
            </tbody>
          </table>
        </Section>

        {/* 6. 13 條 REL 規則 */}
        <Section id="rules" title="6. 13 條 REL 規則 + Hybrid 檢核">
          <p>
            從 51 條章節分層規則 (Intro 12 / Method 12 / Exp 15 / Conclusion 12) MECE 收斂為 13 條。
            檢核採兩階段 hybrid：
          </p>
          <MermaidDiagram
            caption="圖 6-1：規則檢核兩階段 hybrid 設計"
            code={`flowchart LR
    Y[rules.yaml<br/>13 條<br/>學長維護] --> S1
    S1[Step 1<br/>Cypher 候選查詢<br/>純 graph pattern<br/>確定性, 不用 LLM] --> C[候選子圖列表]
    C --> S2[Step 2<br/>LLM 判讀<br/>tool use 強制 JSON<br/>verdict + severity + confidence]
    S2 --> D[Defect<br/>含 evidence_edu_ids]`}
          />
          <h3>13 條規則一覽（含 Vaswani 2017 範例）</h3>
          <p className="text-xs text-muted-foreground">
            每條規則都按「中文意義 / 觸發條件 / Vaswani 範例」三欄說明。
            REL-04 / REL-08 / REL-12 需要跨章節推理，會在 cross-section second pass 重跑。
          </p>

          <div className="space-y-3">
            {REL_RULES.map((r) => (
              <RuleCard key={r.id} rule={r} />
            ))}
          </div>
        </Section>

        {/* 7. 範例走查 */}
        <Section id="example" title='7. 範例走查 — Vaswani 2017 "Attention Is All You Need"'>
          <p>
            用 Vaswani 論文中的一句話，從頭到尾看系統怎麼找出問題。這是 <strong>REL-09 觀察沒歸因</strong> 的範例。
          </p>

          <ExampleStep n={1} title="原句長這樣">
            <Quote>
              While single-head attention is 0.9 BLEU worse than the best setting,
              quality also drops off with too many heads.
            </Quote>
            <p>
              中文白話翻譯：「單頭 attention 比最佳設定差 0.9 BLEU；head 太多的話品質也會掉。」
            </p>
            <p className="text-xs text-muted-foreground">
              出現位置：論文第 9 頁，Section 6.2 講 Table 3 row (A) 的實驗結果。
            </p>
          </ExampleStep>

          <ExampleStep n={2} title="系統怎麼讀這句話">
            <p>系統把這句話切成幾個小命題（EDU），然後貼上三種便利貼：</p>
            <ul>
              <li>
                <strong>觀察類便利貼</strong>（Observation FRU）：
                「這句話是在『描述實驗看到什麼』。」
              </li>
              <li>
                <strong>位置便利貼</strong>：「在 Results 章節，第 9 頁。」
              </li>
              <li>
                <strong>修辭關係便利貼</strong>（RST）：
                「這句話跟 Table 3 的數據有 Result 因果關係。」
              </li>
            </ul>
            <p>關鍵：**沒有貼上「歸因類」便利貼**（Attribution FRU）— 因為原文真的沒解釋為什麼。</p>
          </ExampleStep>

          <ExampleStep n={3} title="REL-09 規則開始工作">
            <p>規則邏輯只看一件事：</p>
            <blockquote className="my-2 border-l-2 border-primary bg-primary/5 p-3 text-sm font-medium">
              「這個觀察句旁邊（前 3 句到後 8 句範圍內），有沒有貼著『歸因類』便利貼？」
            </blockquote>
            <p>
              系統在這句話的附近找了一圈 — <strong>沒找到任何歸因類便利貼</strong>。
              所以系統就把這句話列為「可疑候選」，準備交給 LLM 確認。
            </p>
            <p className="text-xs text-muted-foreground">
              對比：Section 6.2 row (B) 講「reducing dk hurts quality」之後就有一句
              「This suggests that determining compatibility is not easy」— 那就是「歸因類」便利貼，
              所以 row (B) 不會被列為候選。
            </p>
          </ExampleStep>

          <ExampleStep n={4} title="LLM 做最終判決">
            <p>
              系統把這個候選交給 Claude 看，問它「這真的是缺陷嗎？」LLM 讀完原文 + 鄰近段落後回覆：
            </p>
            <ul>
              <li>
                <strong>是的，這是缺陷</strong>（violates = true）
              </li>
              <li>
                <strong>嚴重度：中</strong>（不破壞核心論證但削弱說服力）
              </li>
              <li>
                <strong>信心：75%</strong>（蠻確定但有點懷疑作者可能是故意精簡）
              </li>
              <li>
                <strong>建議補充</strong>：「太多 head 會讓每個 head 維度太小（dk = dmodel / h），
                attention 表達能力下降。」
              </li>
            </ul>
          </ExampleStep>

          <ExampleStep n={5} title="使用者看到的結果">
            <Card className="border-l-4 border-l-orange-500">
              <CardContent className="space-y-2 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant="outline" className="font-mono text-[10px]">
                    REL-09
                  </Badge>
                  <span className="font-semibold">觀察沒歸因</span>
                  <span className="rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-medium text-orange-700">
                    中嚴重
                  </span>
                  <Badge variant="secondary" className="text-[10px]">
                    Results
                  </Badge>
                  <span className="rounded bg-sky-100 px-1.5 py-0.5 font-mono text-[10px] text-sky-700">
                    75%
                  </span>
                </div>
                <p className="border-l-2 border-muted-foreground/30 pl-2 text-xs italic text-muted-foreground">
                  「While single-head attention is 0.9 BLEU worse than the best setting,
                  quality also drops off with too many heads.」
                </p>
                <p>
                  作者觀察到「太多 head 會降低品質」，但沒解釋為什麼。讀者只看到現象不知道原因。
                </p>
                <div className="rounded bg-muted/60 p-2 text-xs">
                  <strong>建議：</strong>補上「太多 head 時每個 head 維度過小（dk = dmodel / h），
                  導致 attention 表達能力不足」之類的歸因說明。
                </div>
              </CardContent>
            </Card>
            <p className="mt-2 text-xs text-muted-foreground">
              點這個缺陷卡片 → PDF viewer 自動 scroll 到該段落並高亮原句。
            </p>
          </ExampleStep>

          <ExampleStep n={6} title="學長判定 → 量化系統品質">
            <p>
              學長看到這條缺陷後可以按三個鈕：
              <strong>判對</strong> / <strong>部分對</strong> /{" "}
              <strong>誤判</strong>。
              判定會存到 SQLite。
            </p>
            <p>
              這些判定用來計算每條規則的 soft precision（correct + 0.5 × partial），
              也能匯出成 ground truth。
              <strong>判定只用於評估與分析，不會回寫進 prompt 影響後續判讀</strong>，
              每次檢核都是獨立的 zero-shot，結果可重現。
            </p>
          </ExampleStep>
        </Section>

        {/* 8. 人工評估機制 */}
        <Section id="phase2" title="8. 人工評估機制">
          <p>
            系統判讀完後，由學長對每個缺陷做人工檢查（判對 / 部分對 / 誤判），用來量化系統品質。
            判定資料只用於評估與匯出 ground truth，<strong>不會回饋進 prompt</strong>——
            每次檢核都是獨立 zero-shot，結果可重現。
          </p>
          <MermaidDiagram
            caption="圖 8-1：人工評估流程"
            code={`flowchart LR
    A[新論文] --> B[Cypher 候選]
    B --> D[LLM zero-shot 判讀]
    D --> G[Defect 清單<br/>含 confidence + rule_meta]
    G -. 手動標 correct / partial / wrong .-> H[("SQLite<br/>defect_judgments")]
    H --> I["GET /api/judgments/summary<br/>per-rule soft precision"]
    H --> J["GET /api/judgments/export<br/>匯出 ground truth"]`}
          />
          <p>
            人工判定提供量化指標（per-rule soft precision =（correct + 0.5 × partial）/ 已判數），
            可作為論文的評估結果與 ground truth，佐證規則品質。
          </p>
        </Section>

        {/* 9. 聊天 Guardrails */}
        <Section id="guards" title="9. 論文助手聊天 + Guardrails">
          <p>
            右下角浮動抽屜，限定討論本篇論文。四層保險：
          </p>
          <ol className="text-sm">
            <li>
              <strong>Scope refuse</strong> — 只能討論這篇論文，問其他主題婉拒並引導回論文
            </li>
            <li>
              <strong>強制 cite</strong> — 引用必須帶{" "}
              <code className="rounded bg-muted px-1 text-xs">[EDU:xxx]</code> /{" "}
              <code className="rounded bg-muted px-1 text-xs">[DEFECT:xxx]</code>，前端解析成可點 chip
            </li>
            <li>
              <strong>Prompt injection 偵測</strong> — 8 種 pattern (例如 「ignore previous instructions」、
              「you are now X」、「system:」) 命中時 system prompt 加警告
            </li>
            <li>
              <strong>Rate limit</strong> — 每 paper 每分鐘 15 次（in-memory bucket）
            </li>
          </ol>
        </Section>

        {/* 10. 理論文獻 */}
        <Section id="literature" title="10. 理論文獻支撐">
          <p>系統的每一層設計都對得到一篇被引爆的論文：</p>
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs">
              <tr>
                <th className="p-2 text-left">系統設計</th>
                <th className="p-2 text-left">關鍵文獻</th>
              </tr>
            </thead>
            <tbody>
              {LITERATURE.map((row) => (
                <tr key={row.work} className="border-t">
                  <td className="p-2">{row.feature}</td>
                  <td className="p-2 italic">{row.work}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        {/* 11. 效能與穩定性 */}
        <Section id="perf" title="11. 效能與穩定性：平行化、成本優化與測試">
          <p>
            一篇正常論文的分析會送出約 <strong>30–40 次 LLM 呼叫</strong>
            （每章節 3 次：EDU / ER / RST·FRU；13 條 REL 規則各 1 次；跨章節 1 次）。
            這些呼叫原本是「一個接一個」序列執行，token 密集的中文段落單次就要
            4–10 秒，整篇分析常常要 <strong>~9 分鐘</strong>。下面三項改動把它壓到約
            1/5。
          </p>

          <h3>11.1 瓶頸診斷（用真實數據，不靠猜）</h3>
          <p>
            系統把每次 LLM 呼叫的 stage、模型、token、時間都記到 SQLite
            （<code>llm_calls</code> 表）。用同一篇論文的實測拆解，時間幾乎平均分布在
            兩個區塊，而且各自內部都是序列：
          </p>
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs">
              <tr>
                <th className="p-2 text-left">區塊</th>
                <th className="p-2 text-left">呼叫數</th>
                <th className="p-2 text-left">序列耗時</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t">
                <td className="p-2">段落抽取（EDU/ER/RST·FRU × 各章節）</td>
                <td className="p-2">~18–24</td>
                <td className="p-2">~246s</td>
              </tr>
              <tr className="border-t">
                <td className="p-2">13 條 REL 規則檢核</td>
                <td className="p-2">13</td>
                <td className="p-2">~288s</td>
              </tr>
              <tr className="border-t">
                <td className="p-2">跨章節 second pass</td>
                <td className="p-2">1</td>
                <td className="p-2">~13s</td>
              </tr>
              <tr className="border-t font-medium">
                <td className="p-2">合計</td>
                <td className="p-2">~32–38</td>
                <td className="p-2">~538s（9 分鐘）</td>
              </tr>
            </tbody>
          </table>

          <h3>11.2 平行化：把獨立的呼叫同時送出</h3>
          <p>
            各章節彼此獨立、13 條規則也彼此獨立，所以用一個有上限的 thread pool
            把它們同時送出（<code>OPENAI_MAX_WORKERS</code>，預設 6）。為什麼用 thread
            而不改 async：這些都是 I/O-bound 的 API 等待，OpenAI client 是同步的，
            thread pool 就足夠且改動最小。
          </p>
          <ul>
            <li>
              <strong>跨章節平行</strong>：每個章節的 EDU→ER→RST·FRU 三步仍有先後依賴
              （ER、RST 都吃 EDU），所以章節內維持序列；章節之間才平行。
            </li>
            <li>
              <strong>跨規則平行</strong>：13 條規則直接整批平行——這是最大的單點收益。
            </li>
            <li>
              <strong>為何安全</strong>：SQLite 每次呼叫開新連線 + WAL 模式、Neo4j 每次
              開新 session（driver 本身 thread-safe）、Neo4j 寫入在平行區段之後才做；
              <code>pool.map</code> 保留輸入順序，所以結果組裝是 deterministic 的。
            </li>
            <li>
              <strong>rate limit</strong>：pool 有上限避免狂撞 OpenAI 限流，底層的
              <code>call_with_tool</code> 也已內建 429／5xx 的指數退避重試。
            </li>
          </ul>

          <h3>11.3 輸出瘦身：只有「真的違規」才寫理由</h3>
          <p>
            規則檢核原本要求 LLM 對<strong>每一個</strong>候選都回傳
            severity / section / description / suggestion 等欄位——但系統其實只留
            違規的、其餘全部丟掉。對候選很多的規則，這等於逼模型寫一大堆繁體中文然後
            扔掉。例如 REL-06（Concept-Formalization）一篇就有 60–70 個候選、只有 5 個
            違規，卻吐了 ~7000 個 output token、花 ~100 秒。
          </p>
          <p>
            改成「非違規只回 <code>{`{candidate_index, violates:false}`}</code>，
            細節欄位只有違規時才填」。缺陷結果完全不變（非違規本來就丟掉），但
            REL-06 從 7069 → 1554 token、101s → 20s。
          </p>

          <h3>11.4 量測結果（同一篇論文，前後對比）</h3>
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs">
              <tr>
                <th className="p-2 text-left">階段</th>
                <th className="p-2 text-left">原本（序列＋胖 schema）</th>
                <th className="p-2 text-left">現在（平行＋瘦 schema）</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t">
                <td className="p-2">build_paper_graph</td>
                <td className="p-2">~246s</td>
                <td className="p-2">~67s</td>
              </tr>
              <tr className="border-t">
                <td className="p-2">check_all_rules</td>
                <td className="p-2">~288s</td>
                <td className="p-2">~26s</td>
              </tr>
              <tr className="border-t">
                <td className="p-2">cross_section</td>
                <td className="p-2">~13s</td>
                <td className="p-2">~13s</td>
              </tr>
              <tr className="border-t font-medium">
                <td className="p-2">合計</td>
                <td className="p-2">~9 分鐘</td>
                <td className="p-2">~1.8 分鐘（約 5×）</td>
              </tr>
            </tbody>
          </table>

          <h3>11.5 PDF OCR 容錯</h3>
          <p>
            部分 LaTeX 論文用了沒有 ToUnicode CMap 的字型，複製／抽取出來是亂碼
            （<code>*?Ti2`</code> 其實是 <code>Chapter</code>）。系統會在原生抽取後做一個
            輕量偵測（看 backtick／星號等噪音字元比例），若判定為亂碼就自動 fallback
            到 tesseract OCR（繁中＋英文），並保留每段文字的頁碼與 bbox 座標。文字抽取
            移到背景任務，OCR（30 頁約 3–5 分鐘）不會卡住上傳請求。
          </p>

          <h3>11.6 單元測試守住這些機制</h3>
          <p>
            這些重構改了不少 orchestration 邏輯，所以加了一組毫秒級、不碰
            網路／LLM／Neo4j 的單元測試（<code>backend/tests/</code>）：亂碼偵測（真實
            亂碼樣本、乾淨中英文、統計符號多的文字防誤判）與原生→OCR 路由（mock 掉
            抽取器只測決策）。亂碼偵測這條本來就出過一次 bug，測試也用「紅→綠」驗證
            過確實抓得到該 bug。
          </p>
        </Section>

        {/* Footer */}
        <footer className="border-t pt-6 text-center text-xs text-muted-foreground">
          論文檢核系統 · 系統說明文件 · 詳細設計請見{" "}
          <a
            href="https://github.com/anthropics/claude-code"
            className="text-primary hover:underline"
          >
            docs/SYSTEM.md
          </a>
        </footer>
      </div>
    </div>
  );
}

// ---------- 子組件 ----------

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-20">
      <h2 className="mb-4 border-b pb-2 text-2xl font-semibold tracking-tight">
        {title}
      </h2>
      <div className={cn(
        "space-y-5 text-base leading-relaxed",
        "[&_h3]:mt-6 [&_h3]:text-xl [&_h3]:font-semibold",
        "[&_p]:leading-relaxed",
        "[&_ul]:list-disc [&_ul]:pl-6 [&_ul]:space-y-1",
        "[&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:space-y-1",
        "[&_table]:my-3 [&_table]:rounded-md [&_table]:border",
        "[&_th]:border-b [&_td]:border-b [&_td:last-child]:border-r-0",
      )}>
        {children}
      </div>
    </section>
  );
}

function ComparisonRow({
  dim,
  llm,
  ours,
}: {
  dim: string;
  llm: string;
  ours: string;
}) {
  return (
    <tr className="border-t">
      <td className="p-2 font-medium">{dim}</td>
      <td className="p-2 text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <X className="h-4 w-4 shrink-0 text-rose-500" />
          {llm}
        </span>
      </td>
      <td className="p-2">
        <span className="inline-flex items-center gap-1.5">
          <Check className="h-4 w-4 shrink-0 text-emerald-600" />
          {ours}
        </span>
      </td>
    </tr>
  );
}

function NodeCard({
  name,
  color,
  attrs,
  meaning,
}: {
  name: string;
  color: string;
  attrs: string[];
  meaning: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <span className={cn("rounded px-2 py-0.5 font-mono text-xs", color)}>
            {name}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p className="text-muted-foreground">{meaning}</p>
        <div className="flex flex-wrap gap-1">
          {attrs.map((a) => (
            <code
              key={a}
              className="rounded bg-muted px-1.5 py-0.5 text-[10px]"
            >
              {a}
            </code>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function RuleCard({ rule }: { rule: RelRule }) {
  const hitBadge: Record<RelRule["vaswaniHit"], { label: string; cls: string }> = {
    fire: { label: "Vaswani 觸發", cls: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300" },
    partial: { label: "Vaswani 部分對", cls: "bg-yellow-100 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-300" },
    healthy: { label: "Vaswani 健康範例", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" },
  };
  const badge = hitBadge[rule.vaswaniHit];
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <Badge variant="outline" className="font-mono">
            {rule.id}
          </Badge>
          <span>{rule.name}</span>
          <Badge variant="secondary" className="font-mono text-[10px]">
            {rule.defectLabel}
          </Badge>
          <span
            className={cn(
              "rounded px-1.5 py-0.5 text-[10px] font-medium",
              badge.cls
            )}
          >
            {badge.label}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <div>
          <strong className="text-muted-foreground text-xs">中文意義：</strong>
          <p>{rule.meaning}</p>
        </div>
        <div>
          <strong className="text-muted-foreground text-xs">觸發條件：</strong>
          <p>{rule.trigger}</p>
        </div>
        <div className="space-y-2 rounded bg-muted/40 p-3">
          <div className="text-xs leading-relaxed">
            <strong>Vaswani 範例（中文說明）：</strong>
            {rule.vaswaniExample}
          </div>
          <div className="border-l-2 border-primary/40 pl-3">
            <p className="mb-1 text-[10px] font-semibold uppercase text-muted-foreground">
              英文原句（出自 {rule.vaswaniLocation}）
            </p>
            <p className="font-serif text-xs italic leading-relaxed text-foreground/80">
              &ldquo;{rule.vaswaniEnglish}&rdquo;
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function TableSchema({
  name,
  purpose,
  keyDesign,
  columns,
}: {
  name: string;
  purpose: string;
  keyDesign: string;
  columns: { col: string; type: string; desc: string }[];
}) {
  return (
    <Card className="my-4">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2">
          <span className="rounded bg-muted px-2 py-0.5 font-mono text-sm">
            {name}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p>
          <strong>用途：</strong>
          {purpose}
        </p>
        <p className="text-xs text-muted-foreground">
          <strong>設計重點：</strong>
          {keyDesign}
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 text-[11px] uppercase text-muted-foreground">
              <tr>
                <th className="p-2 text-left">欄位</th>
                <th className="p-2 text-left">型別</th>
                <th className="p-2 text-left">中文說明</th>
              </tr>
            </thead>
            <tbody>
              {columns.map((c) => (
                <tr key={c.col} className="border-t">
                  <td className="p-2 font-mono">{c.col}</td>
                  <td className="p-2 font-mono text-muted-foreground">{c.type}</td>
                  <td className="p-2">{c.desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function ExampleStep({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="my-4 rounded-md border-l-4 border-l-primary/40 bg-card p-4">
      <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
        Step {n}
      </p>
      <h3 className="mb-2 text-base font-semibold">{title}</h3>
      <div className="space-y-2 text-sm">{children}</div>
    </div>
  );
}

function Quote({ children }: { children: React.ReactNode }) {
  return (
    <blockquote className="my-2 border-l-2 border-primary/40 bg-muted/40 p-3 italic">
      &ldquo;{children}&rdquo;
    </blockquote>
  );
}

type Subtype = {
  name: string;
  meaning: string;
  vaswaniExample: string;
};

const FRU_FUNCTIONS: Subtype[] = [
  {
    name: "Motivation",
    meaning: "動機 — 解釋為什麼這個問題重要、為什麼要做這個研究",
    vaswaniExample:
      "&ldquo;The fundamental constraint of sequential computation, however, remains.&rdquo; (Intro p.2 — 解釋為何需要新架構)",
  },
  {
    name: "Claim",
    meaning: "主張 — 作者提出的核心論點或結論",
    vaswaniExample:
      "&ldquo;We propose a new simple network architecture, the Transformer, based solely on attention mechanisms&rdquo; (Abstract)",
  },
  {
    name: "Evidence",
    meaning: "證據 — 支撐主張的量化數據、引用或實驗結果",
    vaswaniExample:
      "&ldquo;Our model achieves 28.4 BLEU on the WMT 2014 English-to-German translation task, improving over the existing best results, including ensembles, by over 2 BLEU.&rdquo; (Abstract)",
  },
  {
    name: "Background",
    meaning: "背景 — 既有研究或既有方法的描述",
    vaswaniExample:
      "&ldquo;The dominant sequence transduction models are based on complex recurrent or convolutional neural networks&rdquo; (Abstract)",
  },
  {
    name: "Definition",
    meaning: "定義 — 概念 / 術語 / 變數的形式化定義",
    vaswaniExample:
      "&ldquo;An attention function can be described as mapping a query and a set of key-value pairs to an output, where the query, keys, values, and output are all vectors.&rdquo; (Section 3.2 Attention)",
  },
  {
    name: "MethodStep",
    meaning: "方法步驟 — 具體做了什麼操作",
    vaswaniExample:
      "&ldquo;We compute the dot products of the query with all keys, divide each by √dk, and apply a softmax function to obtain the weights on the values.&rdquo; (Section 3.2.1)",
  },
  {
    name: "Observation",
    meaning: "觀察 — 描述「實驗看到什麼結果」的句子",
    vaswaniExample:
      "&ldquo;While single-head attention is 0.9 BLEU worse than the best setting, quality also drops off with too many heads.&rdquo; (Section 6.2)",
  },
  {
    name: "Attribution",
    meaning: "歸因 — 解釋現象「為什麼會這樣」的句子（通常含 because / due to / this suggests）",
    vaswaniExample:
      "&ldquo;This suggests that determining compatibility is not easy and that a more sophisticated compatibility function than dot product may be beneficial.&rdquo; (Section 6.2)",
  },
  {
    name: "Concession",
    meaning: "讓步 — 承認自己方法的缺陷 / 限制 / 代價",
    vaswaniExample:
      "&ldquo;...at the cost of reduced effective resolution due to averaging attention-weighted positions...&rdquo; (Section 2)",
  },
  {
    name: "Compensation",
    meaning: "補償 — 給出彌補上述缺陷的方案",
    vaswaniExample:
      "&ldquo;...an effect we counteract with Multi-Head Attention as described in section 3.2.&rdquo; (Section 2，跟在 Concession 後面)",
  },
  {
    name: "Specific",
    meaning: "具體實例 — 特定情境下的細節描述",
    vaswaniExample:
      "&ldquo;In Table 3 rows (A), we vary the number of attention heads and the attention key and value dimensions, keeping the amount of computation constant&rdquo; (Section 6.2)",
  },
  {
    name: "Generalization",
    meaning: "一般化 — 把具體實例推廣成普遍結論",
    vaswaniExample:
      "&ldquo;We show that the Transformer generalizes well to other tasks by applying it successfully to English constituency parsing&rdquo; (Abstract)",
  },
  {
    name: "Restatement",
    meaning: "重申 — 重複前面提過的主張或結論（通常在 Conclusion）",
    vaswaniExample:
      "&ldquo;In this work, we presented the Transformer, the first sequence transduction model based entirely on attention&rdquo; (Conclusion，重申 Abstract 主張)",
  },
  {
    name: "MetaDiscourse",
    meaning: "元論述 — 論文結構的導引語（「接下來要講...」「我們會在 Section X 討論」）",
    vaswaniExample:
      "&ldquo;In the following sections, we will describe the Transformer, motivate self-attention and discuss its advantages over models such as [17, 18] and [9].&rdquo; (Section 2 結尾)",
  },
  {
    name: "Other",
    meaning: "其他 — 不屬於上述 14 種的修辭單元",
    vaswaniExample: "致謝段（Acknowledgements）、註腳、版權聲明等。",
  },
];

const RST_TYPES: Subtype[] = [
  {
    name: "Elaboration",
    meaning: "細化 — 衛星句細化主角句的內容（給更多細節）",
    vaswaniExample:
      "Nucleus: &ldquo;We propose a new simple network architecture, the Transformer&rdquo; / Satellite: &ldquo;based solely on attention mechanisms, dispensing with recurrence and convolutions entirely&rdquo; (Abstract — 後句細化前句)",
  },
  {
    name: "Background",
    meaning: "背景 — 衛星句提供主角句的時空 / 知識背景",
    vaswaniExample:
      "Satellite: &ldquo;Recurrent neural networks, long short-term memory and gated recurrent neural networks in particular, have been firmly established as state of the art&rdquo; (Intro 開頭，為後續批判 RNN 鋪背景)",
  },
  {
    name: "Cause",
    meaning: "原因 — 衛星句是主角句的原因",
    vaswaniExample:
      "Cause: &ldquo;for large values of dk, the dot products grow large in magnitude&rdquo; / Effect: &ldquo;pushing the softmax function into regions where it has extremely small gradients&rdquo; (Section 3.2.1)",
  },
  {
    name: "Result",
    meaning: "結果 — 衛星句是主角句的結果（與 Cause 相反方向）",
    vaswaniExample:
      "Action: &ldquo;we scale the dot products by 1/√dk&rdquo; / Result: 解決了上面 cause 帶來的梯度消失問題 (Section 3.2.1)",
  },
  {
    name: "Contrast",
    meaning: "對比 — 衛星句與主角句呈對立關係（兩面）",
    vaswaniExample:
      "舊方法 vs 新方法: &ldquo;The dominant ... models are based on complex RNN/CNN&rdquo; (satellite) ↔ &ldquo;We propose the Transformer, based solely on attention&rdquo; (nucleus) (Abstract)",
  },
  {
    name: "Concession",
    meaning: "讓步 — 衛星句承認某事即使如此但主角句仍成立",
    vaswaniExample:
      "Concession: &ldquo;at the cost of reduced effective resolution&rdquo; (satellite) / Nucleus: &ldquo;In the Transformer this is reduced to a constant number of operations&rdquo; (Section 2 — 雖然有代價但仍有優勢)",
  },
  {
    name: "Evidence",
    meaning: "證據 — 衛星句為主角句提供具體證據（不是 Cause，是支持性的數據 / 引用）",
    vaswaniExample:
      "Claim: &ldquo;the big transformer model outperforms the best previously reported models&rdquo; / Evidence: &ldquo;by more than 2.0 BLEU, establishing a new state-of-the-art BLEU score of 28.4&rdquo; (Section 6.1)",
  },
  {
    name: "Justify",
    meaning: "合理化 — 衛星句為主角句的「行動 / 選擇」提供理由",
    vaswaniExample:
      "Choice: &ldquo;We chose the sinusoidal version&rdquo; / Justify: &ldquo;because it may allow the model to extrapolate to sequence lengths longer than the ones encountered during training&rdquo; (Section 3.5)",
  },
  {
    name: "Motivation",
    meaning: "動機 — 衛星句說明為何需要解決主角句提到的問題（讓讀者願意往下讀）",
    vaswaniExample:
      "Problem: &ldquo;inherently sequential nature precludes parallelization&rdquo; / Motivation: &ldquo;which becomes critical at longer sequence lengths, as memory constraints limit batching across examples&rdquo; (Intro)",
  },
  {
    name: "Solutionhood",
    meaning: "解法 — 衛星句是主角句問題的解法（強對應）",
    vaswaniExample:
      "Problem: &ldquo;reduced effective resolution due to averaging attention-weighted positions&rdquo; / Solution: &ldquo;an effect we counteract with Multi-Head Attention&rdquo; (Section 2)",
  },
  {
    name: "Sequence",
    meaning: "順序 — 多個句子按時序串連（first / then / finally）",
    vaswaniExample:
      "&ldquo;We compute the dot products → divide each by √dk → apply a softmax function → obtain the weights on the values&rdquo; (Section 3.2.1 — 演算法步驟序列)",
  },
  {
    name: "Restatement",
    meaning: "重申 — 衛星句以不同方式重述主角句",
    vaswaniExample:
      "Abstract: &ldquo;The Transformer ... based solely on attention mechanisms&rdquo; ↔ Conclusion: &ldquo;the first sequence transduction model based entirely on attention&rdquo; (跨章節重申)",
  },
  {
    name: "Summary",
    meaning: "摘要 — 衛星句把多個前述要點濃縮成一句",
    vaswaniExample:
      "Conclusion 開頭 &ldquo;In this work, we presented the Transformer, the first sequence transduction model based entirely on attention, replacing the recurrent layers most commonly used in encoder-decoder architectures with multi-headed self-attention.&rdquo; (Section 7 — 一句話摘要全文)",
  },
  {
    name: "Condition",
    meaning: "條件 — 衛星句陳述「在某條件下」主角句才成立（if-then 結構）",
    vaswaniExample:
      "Condition: &ldquo;While for small values of dk&rdquo; / Nucleus: &ldquo;the two mechanisms perform similarly&rdquo; (Section 3.2.1)",
  },
  {
    name: "Other",
    meaning: "其他 — 不屬於上述 14 種的修辭關係",
    vaswaniExample: "腳註、致謝、版權聲明等的句間關係。",
  },
];

function SubtypeTable({ items }: { items: Subtype[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-xs">
          <tr>
            <th className="p-2 text-left">類型名</th>
            <th className="p-2 text-left">中文意義</th>
            <th className="p-2 text-left">Vaswani 範例</th>
          </tr>
        </thead>
        <tbody>
          {items.map((s) => (
            <tr key={s.name} className="border-t align-top">
              <td className="p-2">
                <Badge variant="outline" className="font-mono text-[10px]">
                  {s.name}
                </Badge>
              </td>
              <td className="p-2 text-xs">{s.meaning}</td>
              <td
                className="p-2 text-xs leading-relaxed"
                dangerouslySetInnerHTML={{ __html: s.vaswaniExample }}
              />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type RelRule = {
  id: string;
  name: string;
  defectLabel: string;
  meaning: string;
  trigger: string;
  vaswaniExample: string;
  vaswaniEnglish: string;
  vaswaniLocation: string;
  vaswaniHit: "fire" | "healthy" | "partial";
};

const REL_RULES: RelRule[] = [
  {
    id: "REL-01",
    name: "Claim-Evidence",
    defectLabel: "NakedClaim",
    meaning: "每個主張都應該有對應的證據（量化數據、引用、實驗結果或邏輯推論）支撐。",
    trigger: "Abstract / Intro / Results / Discussion 章節有 Claim FRU，但同章節鄰近沒有 Evidence FRU 支撐。",
    vaswaniExample: "Intro 寫「Transformer 允許顯著更多平行化、12 小時就達 SOTA」是大主張，但證據（Table 2 BLEU 分數）放在 Section 6 才出現，Intro 段內沒附證據。",
    vaswaniEnglish:
      "The Transformer allows for significantly more parallelization and can reach a new state of the art in translation quality after being trained for as little as twelve hours on eight P100 GPUs.",
    vaswaniLocation: "Section 1 Introduction, p.2",
    vaswaniHit: "fire",
  },
  {
    id: "REL-02",
    name: "Baseline-Critique",
    defectLabel: "BaselineNotCritiqued",
    meaning: "提到 baseline 做比較時，應該批判其侷限或不足，不能只列數字了事。",
    trigger: "Method / Experiment 章節提到 baseline Entity，但沒有 FRU 批判其侷限。",
    vaswaniExample: "Section 6.1 Table 2 列出 ByteNet / GNMT / ConvS2S 等 baseline 的 BLEU 分數，但沒解釋這些 baseline 為何輸（設計侷限是什麼）。",
    vaswaniEnglish:
      "Table 2: The Transformer achieves better BLEU scores than previous state-of-the-art models on the English-to-German and English-to-French newstest2014 tests at a fraction of the training cost. (Lists ByteNet 23.75, GNMT+RL 24.6, ConvS2S 25.16, MoE 26.03 — but no discussion of each baseline's design weaknesses.)",
    vaswaniLocation: "Section 6.1 / Table 2, p.8",
    vaswaniHit: "partial",
  },
  {
    id: "REL-03",
    name: "Action-Justification",
    defectLabel: "MissingMotivation",
    meaning: "對每個關鍵研究行動（選某資料集 / 某指標 / 某架構）都應該有合理化說明。",
    trigger: "Method 章節有 MethodStep FRU，但鄰近沒有 Motivation FRU 解釋為什麼這樣做。",
    vaswaniExample: "Section 5.3 寫「我們用 Adam optimizer 配 β1=0.9, β2=0.98」— 為何選 Adam 而非 SGD？論文只給參數沒給選擇理由。",
    vaswaniEnglish:
      "We used the Adam optimizer with β1 = 0.9, β2 = 0.98 and ϵ = 10^−9. We varied the learning rate over the course of training, according to the formula: ... We used warmup_steps = 4000.",
    vaswaniLocation: "Section 5.3 Optimizer, p.7",
    vaswaniHit: "fire",
  },
  {
    id: "REL-04",
    name: "Macro-Decomposition",
    defectLabel: "NoMacroDecomposition",
    meaning: "論文整體應有清楚的巨觀結構拆解 — 大問題拆成子問題，子問題拆成子方法。",
    trigger: "跨章節 — Intro 提出多個子問題，但 Method 沒對應到子方法的明確映射。",
    vaswaniExample: "Intro 提出 (1) 平行化困難 (2) 長程依賴 兩個子問題，但 Method 沒明說「Multi-Head 解問題 1、Self-Attention 解問題 2」這種對應。",
    vaswaniEnglish:
      "[Intro] This inherently sequential nature precludes parallelization within training examples ... [+] One key factor affecting the ability to learn such [long-range] dependencies is the length of the paths forward and backward signals have to traverse in the network. [— Method 章節直接給 Self-Attention / Multi-Head Attention 而沒重述「我們解 problem 1 + 2」的對應映射]",
    vaswaniLocation: "Intro p.2 ↔ Section 3 Model Architecture p.3",
    vaswaniHit: "fire",
  },
  {
    id: "REL-05",
    name: "Process-Sequence",
    defectLabel: "WeakProcessSequence",
    meaning: "Method 章節中的步驟應有明確時序，並用適當連接詞或編號表達。",
    trigger: "Method 章節步驟順序不清晰（沒有 first/then/finally 或編號）。",
    vaswaniExample: "Section 3 Model Architecture 用 3.1 / 3.2 / 3.3 / 3.4 / 3.5 編號清楚展開（Encoder → Decoder → Attention → FFN → Embedding → Positional）— 健康範例，不會 fire。",
    vaswaniEnglish:
      "3.1 Encoder and Decoder Stacks / 3.2 Attention / 3.3 Position-wise Feed-Forward Networks / 3.4 Embeddings and Softmax / 3.5 Positional Encoding — 子章節編號清楚對應 forward pass 的順序。",
    vaswaniLocation: "Section 3 Model Architecture, p.3–6",
    vaswaniHit: "healthy",
  },
  {
    id: "REL-06",
    name: "Concept-Formalization",
    defectLabel: "ConceptNotFormalized",
    meaning: "新引入的概念 / 術語 / 變數應該被形式化定義（數學定義、操作型定義或公式），不能只用比喻或模糊描述。",
    trigger: "Entity 被使用但鄰近沒有 Definition FRU 給出形式化定義。",
    vaswaniExample: "Abstract 寫「more parallelizable」沒給數學定義（什麼叫平行？要等到 Section 4 Table 1 才用 Sequential Operations 欄位定義）。",
    vaswaniEnglish:
      "Experiments on two machine translation tasks show these models to be superior in quality while being more parallelizable and requiring significantly less time to train.",
    vaswaniLocation: "Abstract, p.1",
    vaswaniHit: "fire",
  },
  {
    id: "REL-07",
    name: "Setup-Scoping",
    defectLabel: "SetupNotScoped",
    meaning: "實驗章節應交代實驗設定範圍（資料集 / 評估指標 / 硬體 / 超參數）。",
    trigger: "Experiment 章節缺乏完整的設定範圍說明。",
    vaswaniExample: "Section 5 完整列出 dataset (WMT 2014)、batch size (25K tokens)、硬體 (8 P100 GPUs)、step time (0.4s)、訓練時間 (12 小時) — 健康範例，不會 fire。",
    vaswaniEnglish:
      "We trained on the standard WMT 2014 English-German dataset consisting of about 4.5 million sentence pairs ... Each training batch contained a set of sentence pairs containing approximately 25000 source tokens and 25000 target tokens. We trained our models on one machine with 8 NVIDIA P100 GPUs.",
    vaswaniLocation: "Section 5.1–5.2 Training Data / Hardware, p.7",
    vaswaniHit: "healthy",
  },
  {
    id: "REL-08",
    name: "Problem-Solution",
    defectLabel: "ProblemSolutionMismatch",
    meaning: "Intro 提出的問題在 Method 應該有對應的解法說明。",
    trigger: "跨章節 — Intro 提到問題但 Method 沒重述該問題就直接給解法。",
    vaswaniExample: "Intro 提到「averaging attention-weighted positions 會降解析度」這個問題，Method 直接給 Multi-Head Attention 解法但沒重述「我們要解的就是這個降解析度問題」。",
    vaswaniEnglish:
      "[Section 2] In the Transformer this is reduced to a constant number of operations, albeit at the cost of reduced effective resolution due to averaging attention-weighted positions, an effect we counteract with Multi-Head Attention as described in section 3.2. [— Section 3.2 Multi-Head Attention 一開頭沒重述「降解析度問題」就直接給公式]",
    vaswaniLocation: "Section 2 p.2 ↔ Section 3.2.2 Multi-Head Attention p.4",
    vaswaniHit: "fire",
  },
  {
    id: "REL-09",
    name: "Observation-Attribution",
    defectLabel: "ObservationWithoutAttribution",
    meaning: "看到實驗現象（Observation）後，應該給歸因解釋為什麼會這樣。",
    trigger: "Results / Discussion 章節有 Observation FRU，但鄰近 [-3, +8] EDU 範圍沒有 Attribution FRU。",
    vaswaniExample: "Section 6.2 Table 3 row (A) 寫「太多 head 也會使品質下降」但完全沒解釋為什麼。對比 row (B) 旁邊就有「This suggests that determining compatibility is not easy」— 一句歸因就差別很大。",
    vaswaniEnglish:
      "While single-head attention is 0.9 BLEU worse than the best setting, quality also drops off with too many heads. [— 此段後直接跳到 row (B)，沒解釋為什麼太多 head 會掉品質]",
    vaswaniLocation: "Section 6.2 Model Variations / Table 3 row (A), p.9",
    vaswaniHit: "fire",
  },
  {
    id: "REL-10",
    name: "Concession-Compensation",
    defectLabel: "UncompensatedConcession",
    meaning: "承認自己方法的缺陷 / 限制（Concession）時，應該給出補償（Compensation）方案說明如何彌補。",
    trigger: "有 Concession FRU 但鄰近沒有 Compensation FRU。",
    vaswaniExample: "Section 2 提「Transformer 用 attention-weighted positions 會降解析度」是 concession，作者馬上補「我們用 Multi-Head Attention 來補償」— 健康範例，補償到位不會 fire。",
    vaswaniEnglish:
      "...albeit at the cost of reduced effective resolution due to averaging attention-weighted positions, an effect we counteract with Multi-Head Attention as described in section 3.2.",
    vaswaniLocation: "Section 2 Background, p.2",
    vaswaniHit: "healthy",
  },
  {
    id: "REL-11",
    name: "Specific-Generalization",
    defectLabel: "SpecificGeneralizationImbalance",
    meaning: "具體實例（Specific）與一般化結論（Generalization）應該平衡 — 不能只有例子沒結論，或只有結論沒例子。",
    trigger: "Specific FRU 與 Generalization FRU 數量比例失衡。",
    vaswaniExample: "Abstract 寫「Transformer generalizes well to other tasks」是強泛化主張，但只實驗了 1 個其他任務（English constituency parsing）— 泛化主張過強相對於具體實例。",
    vaswaniEnglish:
      "We show that the Transformer generalizes well to other tasks by applying it successfully to English constituency parsing both with large and limited training data.",
    vaswaniLocation: "Abstract, p.1",
    vaswaniHit: "fire",
  },
  {
    id: "REL-12",
    name: "Core-Restatement",
    defectLabel: "ConclusionMisaligned",
    meaning: "結論章節應該重申摘要 / 引言提出的核心主張，不能跑題或漏掉。",
    trigger: "跨章節 — Abstract 強調的主張在 Conclusion 沒重申。",
    vaswaniExample: "Abstract 強調「Transformer generalizes well」（含 constituency parsing）但 Conclusion 主要回顧翻譯 SOTA、沒重申 parsing 結果 — Abstract 與 Conclusion 在泛化主張上輕微錯位。",
    vaswaniEnglish:
      "[Abstract] We show that the Transformer generalizes well to other tasks by applying it successfully to English constituency parsing ... [Conclusion] On both WMT 2014 English-to-German and WMT 2014 English-to-French translation tasks, we achieve a new state of the art. [— Conclusion 只重申翻譯成果，沒重申 constituency parsing 的泛化驗證]",
    vaswaniLocation: "Abstract p.1 ↔ Section 7 Conclusion p.10",
    vaswaniHit: "fire",
  },
  {
    id: "REL-13",
    name: "Meta-Discourse",
    defectLabel: "MetaDiscourseImbalance",
    meaning: "論文章節之間應有適當的元論述（meta-discourse） — 例如「In the following sections, we will...」這種導引語。",
    trigger: "章節間缺乏導引 / 過渡語句，讀者難以追蹤論述脈絡。",
    vaswaniExample: "Section 2 結尾寫「In the following sections, we will describe the Transformer, motivate self-attention...」— 完美的 meta-discourse，幫讀者預告接下來會看到什麼。健康範例。",
    vaswaniEnglish:
      "To the best of our knowledge, however, the Transformer is the first transduction model relying entirely on self-attention to compute representations of its input and output without using sequence-aligned RNNs or convolution. In the following sections, we will describe the Transformer, motivate self-attention and discuss its advantages over models such as [17, 18] and [9].",
    vaswaniLocation: "Section 2 Background, last paragraph, p.2",
    vaswaniHit: "healthy",
  },
];

const LITERATURE: { feature: string; work: string }[] = [
  {
    feature: "Transformer 抽取能力",
    work: "Vaswani et al. 2017 — Attention Is All You Need",
  },
  {
    feature: "RST 修辭結構",
    work: "Mann & Thompson 1988 — Rhetorical Structure Theory",
  },
  {
    feature: "Argument Mining",
    work: "Stab & Gurevych 2017 — Parsing Argumentation Structures (CL Journal)",
  },
  {
    feature: "KG + LLM 結合",
    work: "Pan et al. 2024 — Unifying LLMs and KGs: A Roadmap (TKDE)",
  },
  {
    feature: "Neurosymbolic AI",
    work: "Garcez & Lamb 2020 — Neurosymbolic AI: The 3rd Wave",
  },
  {
    feature: "Tool Use 強制 schema",
    work: "Schick et al. 2023 — Toolformer",
  },
  {
    feature: "Long-context 失準",
    work: "Liu et al. 2024 — Lost in the Middle (TACL)",
  },
  {
    feature: "Hallucination 緩解",
    work: "Tonmoy et al. 2024 — Hallucination Mitigation Survey",
  },
  {
    feature: "Human-as-judge 評估",
    work: "Chiang & Lee 2023 — Can LLMs Be Alternative to Human Evaluations (ACL)",
  },
];
