"use client";

import { ArrowDownIcon, Check, X } from "lucide-react";

import { MermaidDiagram } from "@/components/mermaid-diagram";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

// 本頁為「系統介紹 / 功能全貌」簡報素材，自含繁中（不走 next-intl t()）。
// 整體偏功能面；流程、寫作功能、上雲為使用者指定的加深主題。
// 更深的工程細節（schema、逐條規則、效能數據、API）留在 docs/SYSTEM.md。

const TOC: { id: string; title: string }[] = [
  { id: "intro", title: "這是什麼" },
  { id: "why", title: "為何不只是 ChatGPT" },
  { id: "how", title: "它怎麼運作" },
  { id: "analysis", title: "功能：論文審稿" },
  { id: "flow-analysis", title: "流程：上傳分析 + 例外處理" },
  { id: "editor", title: "功能：寫作編輯器" },
  { id: "flow-writing", title: "流程：寫作 → 匯出 PDF" },
  { id: "tech", title: "技術一覽" },
  { id: "ai", title: "AI 採用一覽" },
  { id: "cloud", title: "上雲規劃" },
  { id: "trust", title: "為什麼可信" },
  { id: "future", title: "未來展望" },
];

export default function AboutPage() {
  return (
    <div className="mx-auto w-full max-w-6xl gap-8 px-4 py-8 sm:px-6 lg:flex">
      {/* Sticky TOC */}
      <aside className="lg:sticky lg:top-20 lg:h-[calc(100vh-6rem)] lg:w-56 lg:shrink-0 lg:overflow-y-auto">
        <nav className="mb-6 rounded-md border bg-card p-3 lg:mb-0">
          <p className="mb-2 text-[11px] font-semibold uppercase text-muted-foreground">
            目錄
          </p>
          <ul className="space-y-0.5">
            {TOC.map((it) => (
              <li key={it.id}>
                <a
                  href={`#${it.id}`}
                  className="block rounded px-2 py-1 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  {it.title}
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
            系統介紹 · 功能全貌
          </Badge>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            學術論文結構性缺陷檢核系統
          </h1>
          <p className="text-lg text-muted-foreground">
            幫研究者把論文「論證結構」的問題抓出來，並協助改好
          </p>
          <p className="max-w-3xl text-base leading-relaxed">
            上傳一篇論文，系統會自動找出「主張沒證據、缺乏動機、跨章節對不上」這類
            <strong>讀完整篇才看得出來</strong>
            的結構問題，並指回原文、給修改建議；
            另外附一套學術寫作編輯器，從寫作到投稿格式一條龍。
          </p>
          <a
            href="#intro"
            className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
          >
            開始閱讀 <ArrowDownIcon className="h-3 w-3" />
          </a>
        </header>

        {/* 1. 這是什麼 */}
        <Section id="intro" title="這是什麼">
          <p>
            一套<strong>論文審稿 + 學術寫作</strong>
            的平台。核心解決三類「結構性」問題—— 這些問題傳統靠人工
            review，慢又主觀：
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <PainCard
              title="主張無證據"
              desc="寫了「我們的方法最好」，卻沒附數據或對照。"
            />
            <PainCard
              title="缺乏動機"
              desc="直接給方法，沒說為什麼這個問題重要、為何這樣設計。"
            />
            <PainCard
              title="跨章節失聯"
              desc="結論講的東西前言沒鋪陳；方法沒對應到問題。"
            />
          </div>
          <p className="text-sm text-muted-foreground">
            只專注「論證結構與邏輯」——不做文法（已有
            Grammarly）、不做引用格式（已有 Zotero）。
          </p>
        </Section>

        {/* 2. 為何不只是 ChatGPT */}
        <Section id="why" title="為何不只是「叫 ChatGPT 幫我看論文」">
          <p>
            技術上把全文丟給 LLM 也能得到一些意見，但有三個硬傷：
            <strong>每次答案不同、講不清在哪一句、沒有可維護的標準</strong>。
            本系統的差異：
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs">
                <tr>
                  <th className="p-2 text-left">面向</th>
                  <th className="p-2 text-left">純 LLM 對話</th>
                  <th className="p-2 text-left">本系統</th>
                </tr>
              </thead>
              <tbody>
                {COMPARE.map((r) => (
                  <ComparisonRow
                    key={r.dim}
                    dim={r.dim}
                    llm={r.llm}
                    ours={r.ours}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        {/* 3. 它怎麼運作 */}
        <Section id="how" title="它怎麼運作（概念）">
          <p>
            關鍵是<strong>「先把論文拆成結構，再用固定規則檢查」</strong>
            ，而不是讓 LLM 自由發揮。分三步：
          </p>
          <MermaidDiagram
            caption="三步：LLM 把文字拆成結構 → 規則找問題 → LLM 給建議"
            code={`flowchart LR
    A["① 拆解<br/>LLM 把整篇論文<br/>拆成「論述結構」"]
    B["② 檢查<br/>用固定規則<br/>找出結構上的問題"]
    C["③ 建議<br/>對每個問題<br/>給原文位置 + 修改方向"]
    A --> B --> C`}
          />
          <p>
            因為「哪裡有問題」是由<strong>可重現的規則</strong>決定、LLM
            只負責拆解與給建議，
            所以結果穩定、可追溯、規則也能由人維護調整。系統內建{" "}
            <strong>13 類結構規則</strong>，涵蓋上面三大痛點：
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs">
                <tr>
                  <th className="p-2 text-left">會抓出的問題</th>
                  <th className="p-2 text-left">例子</th>
                </tr>
              </thead>
              <tbody>
                {RULE_SUMMARY.map((r) => (
                  <tr key={r.name} className="border-t align-top">
                    <td className="p-2 font-medium whitespace-nowrap">
                      {r.name}
                    </td>
                    <td className="p-2 text-muted-foreground">{r.example}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">
            規則寫在可編輯的設定檔，研究團隊能自行增修；完整 13 條與技術細節見{" "}
            <code>docs/SYSTEM.md</code>。
          </p>
        </Section>

        {/* 4. 功能：論文審稿 */}
        <Section id="analysis" title="功能：論文審稿">
          <div className="grid gap-3 sm:grid-cols-2">
            {ANALYSIS_FEATURES.map((f) => (
              <FeatureCard key={f.title} title={f.title} desc={f.desc} />
            ))}
          </div>
        </Section>

        {/* 5. 流程：上傳分析 + 例外處理 */}
        <Section id="flow-analysis" title="流程：上傳分析（含例外處理）">
          <p>
            上傳後先用<strong>內容雜湊去重</strong>
            （同檔秒回、不重花錢）；全新檔案開背景任務跑， 前端輪詢進度（
            <code>queued → extracting → checking → done</code>）。
          </p>
          <MermaidDiagram
            caption="上傳 → 分析 主流程"
            code={`flowchart TD
    U[上傳 PDF] --> H{內容雜湊<br/>分析過?}
    H -- 是 --> Cache["直接回傳快取結果<br/>(秒回)"]
    H -- 否 --> Q["建立背景任務<br/>queued"]
    Q --> E["抽取文字<br/>extracting"]
    E --> OCR{字型亂碼?}
    OCR -- 是 --> T[tesseract OCR fallback]
    OCR -- 否 --> S
    T --> S["切章節 → 抽 EDU / 實體 / 修辭"]
    S --> KG[寫入知識圖譜 Neo4j]
    KG --> R["13 條規則檢核<br/>checking"]
    R --> CS["跨章節 second pass<br/>REL-04 / 08 / 12"]
    CS --> D["完成 done<br/>PDF 高亮 + 缺陷面板"]`}
          />
          <h3>例外與容錯</h3>
          <p>
            系統把「可自動救」與「真的失敗」分開處理——大多數抖動會自動吞掉，只有致命錯誤才標{" "}
            <code>error</code>。
          </p>
          <MermaidDiagram
            caption="左：自動容錯（使用者無感）／右：致命失敗的善後"
            code={`flowchart TB
    subgraph AUTO["自動容錯（使用者無感）"]
        A1["LLM 限流 / 5xx"] --> A2["指數退避重試<br/>最多 5 次"]
        B1["PDF 字型亂碼"] --> B2["改走 OCR"]
        C1["跨章節 pass 失敗"] --> C2["記 warning<br/>保留 13 條規則結果"]
    end
    subgraph FATAL["致命失敗的善後"]
        F1["抽取 / 建圖出錯"] --> F2["任務狀態 → error"]
        F2 --> F3["失敗事件寫入 DB"]
        F3 --> F4["寄信通知管理者"]
        F4 --> F5["清掉半成品 KG / 紀錄<br/>但保留 PDF 供下載重試"]
    end`}
          />
          <p className="text-sm text-muted-foreground">
            另：全新部署後第一篇上傳偶爾因 Neo4j 暖機出現 transient
            錯誤，重傳即成功；LLM 額度用罄等永久性錯誤會立即停止、不空轉重試。
          </p>

          <h3>系統通知信件（維運）</h3>
          <p>
            系統會主動寄出<strong>兩種</strong>維運信件。皆走純 stdlib
            SMTP（STARTTLS）， 只在有設定 SMTP
            帳密時才真的寄、否則自動略過；寄信永不拋例外，不會蓋掉原始錯誤。
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {MAILS.map((m) => (
              <Card key={m.title}>
                <CardContent className="space-y-1.5 p-4 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5 text-[10px] font-medium",
                        m.badgeCls,
                      )}
                    >
                      {m.kind}
                    </span>
                    <span className="font-semibold">{m.title}</span>
                  </div>
                  <p className="text-muted-foreground">
                    <strong>時機：</strong>
                    {m.when}
                  </p>
                  <p className="text-muted-foreground">
                    <strong>內容：</strong>
                    {m.content}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            收件者預設寄給管理者本人；信中皆附後台連結，可直接查看或下載原檔重現。
          </p>
        </Section>

        {/* 6. 功能：寫作編輯器 */}
        <Section id="editor" title="功能：學術寫作編輯器">
          <p>
            獨立於審稿端的寫作環境（所見即所得，文件以結構化 JSON
            儲存）。從打草稿、引用、結構檢查到輸出投稿格式一站搞定。
          </p>

          <h3>寫作輔助（AI）</h3>
          <div className="grid gap-3 sm:grid-cols-3">
            {EDITOR_AI.map((f) => (
              <FeatureCard key={f.title} title={f.title} desc={f.desc} />
            ))}
          </div>

          <h3>結構檢查（把審稿帶進寫作）</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {EDITOR_CHECK.map((f) => (
              <FeatureCard key={f.title} title={f.title} desc={f.desc} />
            ))}
          </div>

          <h3>引用工具鏈（可驗證）</h3>
          <p className="text-sm text-muted-foreground">
            引用不只是「插一條
            reference」，而是一條可查核的鏈——從找文獻、補書目，到把句子主張對回原文證據。
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {EDITOR_CITE.map((f) => (
              <FeatureCard key={f.title} title={f.title} desc={f.desc} />
            ))}
          </div>

          <h3>編輯體驗</h3>
          <ul>
            <li>
              <strong>Slash 指令：</strong>打 <code>/</code>{" "}
              快速插入標題、表格、圖片、程式碼、數學式等區塊。
            </li>
            <li>
              <strong>區塊操作：</strong>每段左側 ⋮
              把手可上下插入區塊、拖曳搬移。
            </li>
            <li>
              <strong>富內容：</strong>表格工具列、程式碼語法高亮、KaTeX
              數學式、圖片 + 圖說、自動目錄。
            </li>
            <li>
              <strong>找替換：</strong>Cmd/Ctrl+F、Cmd/Ctrl+H 支援搜尋與取代。
            </li>
            <li>
              <strong>寫作狀態：</strong>即時字數 /
              閱讀時間估計、快捷鍵說明（Cmd+?）。
            </li>
          </ul>

          <h3>版本控制（git-like）</h3>
          <p>
            自動存檔快照 + 可手動命名版本；隨時瀏覽、還原到過去版本，
            <strong>還原前會先把目前內容存成備份</strong>，不怕回不去。
          </p>

          <h3>多格式匯出</h3>
          <ul>
            <li>
              <strong>版型：</strong>
              台灣論文（twthesis）、一般文章、雙欄、IEEE。
            </li>
            <li>
              <strong>引用樣式：</strong>APA · MLA · Chicago · Harvard · IEEE ·
              Numeric。
            </li>
            <li>
              <strong>台灣論文雙語封面：</strong>校 / 系 / 學位 / 題目 /
              指導教授 / 學生 / 日期 七對中英欄位。
            </li>
            <li>
              <strong>格式：</strong>Word · LaTeX（.tex，含圖則打包 .zip）·
              PDF（伺服器 XeLaTeX 編譯）· Markdown · HTML · 純文字。
            </li>
          </ul>
        </Section>

        {/* 7. 流程：寫作 → 匯出 PDF */}
        <Section id="flow-writing" title="流程：寫作 → LaTeX / PDF">
          <p>
            可從既有檔案<strong>匯入</strong>（PDF / Word / Markdown / LaTeX /
            純文字）開始編輯——PDF 依字型大小還原標題階層與圖片， 掃描檔自動走
            OCR；輸出時，
            <strong>PDF 與 LaTeX 同源</strong>——先產生 <code>.tex</code>
            ，偵測到中文就自動套 ctex / XeLaTeX，再編譯成 PDF。
          </p>
          <MermaidDiagram
            caption="匯入 → 編輯 → 匯出；PDF 由 LaTeX 經 XeLaTeX 編譯"
            code={`flowchart LR
    Imp["匯入<br/>.pdf / .docx / .md / .tex / .txt"] --> ED
    ED["編輯器<br/>(結構化 JSON)"]
    ED -- AI 輔助 / 引用 / 檢查 --> ED
    ED --> EXP{選擇匯出格式}
    EXP -- DOCX --> W[Word]
    EXP -- "Markdown / HTML / TXT" --> MD[文字格式]
    EXP -- "LaTeX / PDF" --> TEX["產生 .tex<br/>偵測中文 → ctex"]
    TEX -- .tex --> L[LaTeX 原始檔]
    TEX -- PDF --> X["XeLaTeX 編譯<br/>(60s 逾時保護)"]
    X -- 成功 --> P[PDF 下載]
    X -- 失敗 --> Err["回傳編譯日誌末段<br/>方便除錯"]`}
          />
          <p className="text-sm text-muted-foreground">
            匯出 PDF 需要伺服器具備
            XeLaTeX；若環境未安裝會明確回報，而不是默默失敗。
          </p>
        </Section>

        {/* 8. 技術一覽 */}
        <Section id="tech" title="技術一覽（給工程讀者）">
          <p>
            前後端分離；<strong>缺陷分析</strong>與{" "}
            <strong>AI 寫作編輯器</strong>兩大子系統共用同一個後端與資料層。
            後端把抽取與判讀外包給 LLM，論文結構存知識圖譜、其餘存關聯式資料庫。
          </p>
          <MermaidDiagram
            caption="整體架構：兩大子系統共用後端與資料層"
            code={`flowchart TB
    User([使用者])
    subgraph FE["前端 · Next.js / React（PWA · 可安裝）"]
        direction LR
        S1["缺陷分析<br/>上傳 · 結果 · 知識圖譜"]
        S2["AI 寫作編輯器<br/>寫作 · 引用 · 匯出"]
    end
    BE["後端 · FastAPI (Python)"]
    LLM[(OpenAI<br/>gpt-5.4)]
    Neo[(Neo4j<br/>知識圖譜)]
    SQL[(SQLite<br/>資料 / 結果 / 成本)]

    User --> FE
    S1 --> BE
    S2 --> BE
    BE -- 抽取 / 判讀 / 寫作 --> LLM
    BE -- 論文結構 --> Neo
    BE -- 流水資料 --> SQL`}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <FeatureCard
              title="前端"
              desc="Next.js 16 · React 19 · TypeScript · Tailwind · TipTap 編輯器 · 知識圖譜視覺化。"
            />
            <FeatureCard
              title="後端"
              desc="Python · FastAPI · PyMuPDF（PDF 解析）；LLM 用 OpenAI gpt-5.4，可換 Azure / 自架。"
            />
            <FeatureCard
              title="資料"
              desc="Neo4j 存論文結構（圖）、SQLite 存中繼資料 / 分析結果 / 成本紀錄。"
            />
            <FeatureCard
              title="部署"
              desc="Docker Compose 一鍵起；生產用 Caddy 反向代理收斂成單一對外 port。"
            />
            <FeatureCard
              title="PWA（可安裝）"
              desc="可「加入主畫面」當原生 App 用（平板全螢幕）；網路不穩離線顯示上次畫面，資料一律走網路、不會看到過期內容。"
            />
          </div>
        </Section>

        {/* 8.5 AI 採用一覽 */}
        <Section id="ai" title="AI 採用一覽（哪裡用 AI、用什麼模型）">
          <p>
            系統<strong>不是「把全文丟給一個大模型」</strong>
            ，而是把工作切成許多小步驟， 每步挑<strong>剛好夠用</strong>
            的模型——重判讀用大模型、量大的輕任務用 mini、
            語意比對用向量模型。依任務分三層：
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            {AI_MODELS.map((m) => (
              <Card key={m.model} className="border-l-4 border-l-primary/60">
                <CardContent className="space-y-1.5 p-4 text-sm">
                  <p className="font-mono text-[13px] font-semibold">
                    {m.model}
                  </p>
                  <p className="text-xs text-muted-foreground">{m.role}</p>
                  <p>{m.desc}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <h3>每個功能用到的模型</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs">
                <tr>
                  <th className="p-2 text-left">子系統</th>
                  <th className="p-2 text-left">功能 / 步驟</th>
                  <th className="p-2 text-left">用 AI 做什麼</th>
                  <th className="p-2 text-left">模型</th>
                </tr>
              </thead>
              <tbody>
                {AI_USAGE.map((r, i) => (
                  <tr key={`${r.feature}-${i}`} className="border-t align-top">
                    <td className="p-2 whitespace-nowrap text-muted-foreground">
                      {r.group}
                    </td>
                    <td className="p-2 font-medium whitespace-nowrap">
                      {r.feature}
                    </td>
                    <td className="p-2 text-muted-foreground">{r.use}</td>
                    <td className="p-2 font-mono text-[12px] whitespace-nowrap">
                      {r.model}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-sm text-muted-foreground">
            注意：<strong>「哪裡有缺陷」不是 AI 決定的</strong>—— AI
            只負責把論文拆成結構、抽特徵、給文字建議；判定缺陷的是
            <strong>固定規則</strong>
            （見「它怎麼運作」），所以結果可重現、可追溯。
          </p>

          <h3>每個功能吃什麼、怎麼判、上限多少</h3>
          <p className="text-sm text-muted-foreground">
            每個 AI 功能只拿到「剛好夠用」的輸入，並各自有字數 /
            句數上限，避免把整篇硬塞給模型：
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs">
                <tr>
                  <th className="p-2 text-left">功能</th>
                  <th className="p-2 text-left">吃什麼（input）</th>
                  <th className="p-2 text-left">怎麼判（規則）</th>
                  <th className="p-2 text-left">上限</th>
                </tr>
              </thead>
              <tbody>
                {AI_DETAIL.map((r) => (
                  <tr key={r.feature} className="border-t align-top">
                    <td className="p-2 font-medium whitespace-nowrap">
                      {r.feature}
                    </td>
                    <td className="p-2 text-muted-foreground">{r.input}</td>
                    <td className="p-2 text-muted-foreground">{r.rule}</td>
                    <td className="p-2 text-xs whitespace-nowrap">{r.limit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Card className="border-l-4 border-l-amber-400/70">
            <CardContent className="space-y-1.5 p-4 text-sm">
              <p className="font-semibold">
                易混淆：「是否支持」vs.「語意檢查」
              </p>
              <p className="text-muted-foreground">
                兩者都在查「來源撐不撐得起這句主張」，但機制不同：
                <strong>是否支持（verify）</strong>用{" "}
                <strong>LLM 看摘要</strong>，給 supports / partial / unsupported
                的紅綠燈；<strong>語意檢查（ground）</strong>用{" "}
                <strong>向量相似度在全文裡排名</strong>，只回最相符的 3
                句原文＋分數，<strong>不下支持與否的判定</strong>。
              </p>
            </CardContent>
          </Card>
          <p className="text-xs text-muted-foreground">
            三個模型皆透過環境變數設定（
            <code>OPENAI_MODEL_HEAVY</code> / <code>_LIGHT</code> /{" "}
            <code>OPENAI_MODEL_EMBED</code>），可整批換成 Azure OpenAI
            或自架相容模型而不動程式碼；DOI 解析、文獻查詢走 Crossref / OpenAlex
            等學術 API，本身不耗 LLM。
          </p>
        </Section>

        {/* 9. 上雲規劃 */}
        <Section id="cloud" title="上雲規劃">
          <p>
            目前是單機 Docker
            Compose（適合實驗室自用）。要對外開放、承受多人同時用，瓶頸在三個「綁在單機上的狀態」：
            <strong>SQLite 單檔、本機磁碟檔案、記憶體裡的任務進度</strong>
            。上雲就是把這三個解耦，換成可水平擴展的託管服務。
          </p>
          <MermaidDiagram
            caption="上雲後的目標架構"
            code={`flowchart TB
    Users([使用者]) --> CDN["CDN / 邊緣<br/>前端"]
    CDN --> LB["負載平衡 + TLS"]
    LB --> API["後端 API<br/>容器 ×N（可水平擴展）"]
    API --> Q[("任務佇列")]
    Q --> WK["分析 Worker ×N"]
    API --> PG[("託管 Postgres<br/>(原 SQLite)")]
    WK --> PG
    API --> NEO[("託管 Neo4j")]
    WK --> NEO
    API --> OBJ[("物件儲存<br/>PDF / 匯出檔")]
    WK --> OBJ
    WK --> LLM["LLM API"]
    API --> SEC["機密管理"]`}
          />

          <h3>現在 → 上雲 對照</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs">
                <tr>
                  <th className="p-2 text-left">項目</th>
                  <th className="p-2 text-left">現在</th>
                  <th className="p-2 text-left">上雲後</th>
                </tr>
              </thead>
              <tbody>
                {CLOUD_MAP.map((r) => (
                  <tr key={r.item} className="border-t align-top">
                    <td className="p-2 font-medium whitespace-nowrap">
                      {r.item}
                    </td>
                    <td className="p-2 text-muted-foreground">{r.now}</td>
                    <td className="p-2">{r.cloud}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3>分三階段走</h3>
          <ol>
            <li>
              <strong>階段一 · 搬遷（最少改動）：</strong>
              整套 Compose 直接搬到一台雲端 VM 先上線，TLS
              改用雲端憑證。功能不變，先求「在雲上跑起來」。
            </li>
            <li>
              <strong>階段二 · 解耦狀態：</strong>
              換掉三個擋擴展的點——SQLite → 託管 Postgres、本機磁碟 →
              物件儲存、記憶體任務 → 持久佇列 + 獨立 worker；Neo4j
              改託管。此時才能多實例、可重試。
            </li>
            <li>
              <strong>階段三 · 彈性與維運：</strong>
              API 與分析 worker 依負載自動擴縮；補上監控 /
              告警（成本日誌已有基礎），機密進機密管理服務。
            </li>
          </ol>
          <p className="text-sm text-muted-foreground">
            LLM 已是 API 形式（可指向 OpenAI / Azure /
            自架），上雲不需改動；這也讓「本地 +
            雲端混合推論以省成本」成為可選項。
          </p>
        </Section>

        {/* 10. 為什麼可信 */}
        <Section id="trust" title="為什麼可信">
          <ul>
            <li>
              <strong>可重現：</strong>
              「哪裡有問題」由固定規則決定，同一篇跑兩次結果一致，能做學術評估。
            </li>
            <li>
              <strong>可追溯：</strong>每個缺陷都指回 PDF
              上的具體句子；助手回答也強制標出處可點擊跳轉。
            </li>
            <li>
              <strong>有方法論依據：</strong>結合「神經網路抽取 +
              符號規則推理」（Neurosymbolic
              AI），並以修辭結構理論（RST）為標註基礎。
            </li>
            <li>
              <strong>用實驗佐證：</strong>另有離線消融實驗，比較「先拆解再評論
              vs. 直接丟全文」，驗證本方法的優勢。
            </li>
          </ul>
        </Section>

        {/* 11. 未來展望 */}
        <Section id="future" title="未來展望">
          <p>
            接下來的方向，從「把現有功能補完」到「放大這套結構化資料的價值」：
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {ROADMAP.map((f) => (
              <FeatureCard key={f.title} title={f.title} desc={f.desc} />
            ))}
          </div>
        </Section>

        {/* Footer */}
        <footer className="border-t pt-6 text-center text-xs text-muted-foreground">
          想看深入的工程細節（資料 schema、完整 13 條規則、效能數據、API）見{" "}
          <code>docs/SYSTEM.md</code>；13 條規則怎麼寫、怎麼維護見{" "}
          <code>docs/REL-rules-explained.md</code>。
        </footer>
      </div>
    </div>
  );
}

// ---------- 子元件 ----------

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
      <div
        className={cn(
          "space-y-5 text-base leading-relaxed",
          "[&_h3]:mt-6 [&_h3]:text-lg [&_h3]:font-semibold",
          "[&_p]:leading-relaxed",
          "[&_ul]:list-disc [&_ul]:pl-6 [&_ul]:space-y-1.5",
          "[&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:space-y-2",
          "[&_table]:my-3 [&_table]:rounded-md [&_table]:border",
          "[&_th]:border-b [&_td]:border-b [&_td:last-child]:border-r-0",
        )}
      >
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

function PainCard({ title, desc }: { title: string; desc: string }) {
  return (
    <Card className="border-l-4 border-l-rose-400/70">
      <CardContent className="space-y-1 p-4 text-sm">
        <p className="font-semibold">{title}</p>
        <p className="text-muted-foreground">{desc}</p>
      </CardContent>
    </Card>
  );
}

function FeatureCard({ title, desc }: { title: string; desc: string }) {
  return (
    <Card>
      <CardContent className="space-y-1 p-4 text-sm">
        <p className="font-semibold">{title}</p>
        <p className="text-muted-foreground">{desc}</p>
      </CardContent>
    </Card>
  );
}

// ---------- 資料 ----------

const COMPARE = [
  { dim: "結果可重現", llm: "每次答案不同", ours: "規則決定，穩定可評估" },
  { dim: "講得清在哪", llm: "描述模糊", ours: "高亮 PDF 上具體句子" },
  { dim: "標準可維護", llm: "黑盒", ours: "規則可由人增修" },
  { dim: "跨論文比較", llm: "做不到", ours: "結構持久保存可比對" },
];

const RULE_SUMMARY = [
  { name: "主張無證據", example: "下了結論卻沒給數據或引用支撐。" },
  { name: "缺乏動機", example: "給了方法步驟，沒說為什麼這樣做。" },
  { name: "問題與解法錯位", example: "方法沒回應前言提出的問題。（跨章節）" },
  { name: "觀察未歸因", example: "報了一個現象，卻沒解釋成因。" },
  { name: "讓步未補償", example: "承認了弱點，卻沒給緩解或對策。" },
  { name: "結論失準", example: "結論與摘要 / 前言的主張對不上。（跨章節）" },
  {
    name: "其他 7 類",
    example:
      "基線未評析、實驗設定不全、概念未定義、流程順序薄弱、特例通則失衡、後設論述失衡……",
  },
];

const ANALYSIS_FEATURES = [
  {
    title: "一鍵上傳分析",
    desc: "丟 PDF / TXT（中英皆可），自動解析、顯示即時進度。",
  },
  {
    title: "結構缺陷清單",
    desc: "列出每個問題、嚴重度（高/中/低）、所屬章節與信心分數。",
  },
  {
    title: "PDF 雙向定位",
    desc: "點缺陷 → PDF 跳到該句並高亮；點高亮 → 反向選回缺陷。",
  },
  { title: "知識圖譜檢視", desc: "用互動圖呈現論文的概念關係與修辭結構。" },
  {
    title: "論文助手聊天",
    desc: "限定本篇問答，回答必附可點擊的原文出處，內建防濫用機制。",
  },
  {
    title: "報告匯出",
    desc: "把缺陷清單匯出 CSV（像資安弱掃報告），可交給指導老師。",
  },
  {
    title: "歷史與快取",
    desc: "分析過的論文都留存可回看；同檔再傳秒回、不重花錢。",
  },
  { title: "成本透明", desc: "每篇分析的 LLM 花費即時顯示，方便控管。" },
];

const MAILS = [
  {
    kind: "🔴 即時告警",
    badgeCls: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
    title: "上傳分析失敗告警",
    when: "即時，每筆分析失敗各寄一封。",
    content:
      "檔名、大小、paper_id、失敗階段、錯誤類型與訊息、上傳時間，附後台連結可下載原檔重現。",
  },
  {
    kind: "🟡 每日摘要",
    badgeCls:
      "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
    title: "每日上傳摘要",
    when: "排程，每天固定時間（預設 09:00 台北）回顧過去 24 小時；當日 0 上傳則不寄。",
    content:
      "總上傳數、分狀態（成功 / 快取命中 / 失敗 / 進行中）、失敗清單，附後台連結。",
  },
];

const EDITOR_AI = [
  {
    title: "自動補全",
    desc: "停頓或按 Cmd+J，串流續寫一兩句「幽靈文字」，參考標題與大綱語境。",
  },
  {
    title: "AI 改寫",
    desc: "選一段 → 七種模式（改寫 / 簡化 / 擴寫 / 精簡 / 通順 / 學術語氣 / 修文法）或自訂指令，原文新文並排比對。",
  },
  {
    title: "大綱生成",
    desc: "給一個主題 → 產生章節標題樹，直接插入游標位置。",
  },
];

const EDITOR_CHECK = [
  {
    title: "即時草稿檢查",
    desc: "逐段套用單章節結構規則（依內容快取，改哪段查哪段），缺陷行內標示 + 修改建議。",
  },
  {
    title: "全篇檢查 + 圖譜",
    desc: "一次建合併知識圖譜、跑跨章節規則（前後呼應），並可視覺化整篇結構。",
  },
];

const EDITOR_CITE = [
  {
    title: "文獻推薦",
    desc: "針對一句主張到 OpenAlex（Crossref 備援）找來源，中英交錯、依語意重排，回前 15 筆。",
  },
  {
    title: "DOI 解析",
    desc: "貼一個 DOI / 連結 → 自動補齊完整書目（Crossref）。",
  },
  {
    title: "引用重連",
    desc: "解析文末純文字參考清單 → 逐筆到 OpenAlex 高信心比對 → 把內文（作者, 年）換成活引用節點。",
  },
  {
    title: "引用查核（verify）",
    desc: "判斷來源摘要是否支持該主張：支持 / 部分 / 不支持，附支持節錄與信心分數。",
  },
  {
    title: "全文落地（ground）",
    desc: "抓被引論文 PDF，用語意比對找出最相符的前 5 句原文；無 PDF 則退回摘要。降低「捏造引用」。",
  },
  { title: "書目更新", desc: "依 OpenAlex id 重新抓取，保持書目最新。" },
];

const CLOUD_MAP = [
  {
    item: "運算",
    now: "單機 Docker Compose",
    cloud: "容器服務，API 與分析 worker 可各自水平擴展",
  },
  {
    item: "知識圖譜",
    now: "自架 Neo4j 容器",
    cloud: "託管 Neo4j（如 AuraDB）或雲上自架",
  },
  {
    item: "關聯式資料",
    now: "SQLite 單檔",
    cloud: "託管 Postgres（多實例共用、可備援）",
  },
  { item: "檔案", now: "本機磁碟 uploads/", cloud: "物件儲存（S3 / GCS）" },
  {
    item: "背景任務",
    now: "記憶體 dict（重啟丟失）",
    cloud: "持久佇列 + worker（可重試、可擴展）",
  },
  {
    item: "TLS / 入口",
    now: "Caddy 單機反代",
    cloud: "雲端負載平衡 + 憑證管理",
  },
  { item: "機密", now: ".env 檔", cloud: "機密管理服務" },
  { item: "LLM", now: "OpenAI API", cloud: "不變（已可換 Azure / 自架）" },
];

const AI_MODELS = [
  {
    model: "gpt-5.4",
    role: "重判讀（heavy）",
    desc: "需要深度推理的判讀：修辭結構抽取、逐條結構規則檢核、跨章節呼應檢查。",
  },
  {
    model: "gpt-5.4-mini",
    role: "輕任務（light）",
    desc: "量大但較單純：拆解、抽取、翻譯、論文助手、寫作輔助、引用的 LLM 步驟。",
  },
  {
    model: "text-embedding-3-small",
    role: "語意向量（embedding）",
    desc: "把句子轉成向量做語意比對：知識圖譜、文獻重排、引用落地。",
  },
];

const AI_USAGE = [
  {
    group: "論文審稿",
    feature: "論述拆解（EDU）",
    use: "把整篇切成最小論述單元。",
    model: "gpt-5.4-mini",
  },
  {
    group: "論文審稿",
    feature: "實體 / 關係抽取",
    use: "抽出概念與其關聯，建知識圖譜。",
    model: "gpt-5.4-mini",
  },
  {
    group: "論文審稿",
    feature: "修辭結構抽取（RST / FRU）",
    use: "判讀段落的論證 / 修辭角色。",
    model: "gpt-5.4",
  },
  {
    group: "論文審稿",
    feature: "標題偵測",
    use: "從版面推斷論文標題。",
    model: "gpt-5.4-mini",
  },
  {
    group: "論文審稿",
    feature: "13 條結構規則判讀",
    use: "對每條規則判斷該段是否觸發缺陷、給理由。",
    model: "gpt-5.4",
  },
  {
    group: "論文審稿",
    feature: "跨章節 second pass",
    use: "檢查前言 / 方法 / 結論的前後呼應。",
    model: "gpt-5.4",
  },
  {
    group: "論文審稿",
    feature: "缺陷說明多語翻譯",
    use: "把缺陷描述 / 建議在地化（中英）。",
    model: "gpt-5.4-mini",
  },
  {
    group: "論文審稿",
    feature: "知識圖譜向量",
    use: "節點語意向量，供圖譜與檢索使用。",
    model: "text-embedding-3-small",
  },
  {
    group: "論文審稿",
    feature: "論文助手聊天",
    use: "限定本篇的問答、附原文出處。",
    model: "gpt-5.4-mini",
  },
  {
    group: "寫作編輯器",
    feature: "自動補全",
    use: "依語境串流續寫一兩句。",
    model: "gpt-5.4-mini",
  },
  {
    group: "寫作編輯器",
    feature: "AI 改寫（7 模式）",
    use: "改寫 / 簡化 / 擴寫 / 通順 / 學術語氣等。",
    model: "gpt-5.4-mini",
  },
  {
    group: "寫作編輯器",
    feature: "大綱生成",
    use: "依主題產生章節標題樹。",
    model: "gpt-5.4-mini",
  },
  {
    group: "寫作編輯器",
    feature: "草稿 / 全篇結構檢查",
    use: "把審稿規則帶進寫作（與審稿同模型）。",
    model: "gpt-5.4 + mini",
  },
  {
    group: "引用工具鏈",
    feature: "文獻推薦",
    use: "依語意對候選文獻重排序。",
    model: "gpt-5.4-mini + embedding",
  },
  {
    group: "引用工具鏈",
    feature: "引用重連",
    use: "把純文字參考清單比對回真實文獻。",
    model: "gpt-5.4-mini + embedding",
  },
  {
    group: "引用工具鏈",
    feature: "引用查核（verify）",
    use: "判斷來源是否支持該主張。",
    model: "gpt-5.4-mini",
  },
  {
    group: "引用工具鏈",
    feature: "全文落地（ground）",
    use: "語意比對找出最相符的原文句子。",
    model: "text-embedding-3-small",
  },
];

const AI_DETAIL = [
  {
    feature: "自動補全",
    input: "游標前正文（取尾端）；標題與章節大綱（目錄）另塞進 system 當語境。",
    rule: "貼著章節主題續寫一兩句；送出前去重、輸出若只是把原文回放就立即截斷（防 loop）。",
    limit: "正文 ≤ 2000 字 · 輸出 ≤ 200 tok",
  },
  {
    feature: "AI 改寫",
    input: "只有選取的那一段（不帶前後文、不帶全文）。",
    rule: "不判「該不該改」；依 7 種預設或自訂指令改寫，不得新增引用 / 數據 / 事實、保留既有引用標記。",
    limit: "選取段 ≤ 4000 字 · 輸出 ≤ 600 tok",
  },
  {
    feature: "大綱生成",
    input: "一句主題。",
    rule: "產生章節標題樹，插入游標位置。",
    limit: "主題 ≤ 500 字",
  },
  {
    feature: "缺陷檢查",
    input: "知識圖譜中 Cypher 撈出的「候選子圖」（不是整篇全文）。",
    rule: "規則先框定範圍，LLM 只在候選內判 violates / 嚴重度 / 信心；信心 < 0.3 視為不違反。",
    limit: "候選 ≤ 120,000 字（跨章節 ≤ 400,000）",
  },
  {
    feature: "即時草稿檢查",
    input: "編輯器內的草稿段落（即把審稿規則帶進寫作）。",
    rule: "與缺陷檢查同一套規則；逐段檢查只跑 10 條單章節規則，依內容快取。",
    limit: "每段 ≤ 20,000 字 · 全篇 ≤ 40,000 字",
  },
  {
    feature: "文獻推薦",
    input: "一句 claim（主張）。",
    rule: "中文先用 LLM 抽英文關鍵字 → 查 OpenAlex / Crossref → embedding 依語意重排。",
    limit: "回前 15 筆",
  },
  {
    feature: "是否支持（verify）",
    input: "claim + 來源的標題與摘要。",
    rule: "LLM 判 supports / partial / unsupported，只憑摘要、不得腦補，附逐字佐證句。",
    limit: "claim ≤ 2000 字 · 摘要 ≤ 8000 字",
  },
  {
    feature: "語意檢查（ground）",
    input: "claim + 被引論文全文的每一句（無全文則退回摘要）。",
    rule: "沒有 LLM、沒有門檻、不分類；純算 cosine 相似度排名取最相符的 3 句。",
    limit: "每句 ≥ 20 字 · ≤ 400 句 · 取 top 3",
  },
  {
    feature: "論文助手",
    input: "本篇的 EDU + 缺陷 + 規則當脈絡，加使用者提問。",
    rule: "限定本篇問答、強制附可點擊出處；內建越界拒答與防注入。",
    limit: "單則 ≤ 2000 字 · 歷史 ≤ 10 輪 · 15/分",
  },
];

const ROADMAP = [
  {
    title: "規則隨用越準",
    desc: "把使用者的人工判定（判對 / 誤判）回饋給系統，自動校準規則精準度。",
  },
  {
    title: "跨論文比較與文獻網絡",
    desc: "善用已存成圖的論文結構，做多篇對齊、概念與引用關係分析。",
  },
  {
    title: "領域規則包",
    desc: "社科量化與 CS/NLP 的失準型態不同，未來提供分領域的規則變體。",
  },
  {
    title: "成本優化",
    desc: "本地 + 雲端混合推論、批次 API 折扣，降低大量分析的花費。",
  },
  {
    title: "帳號與多人協作",
    desc: "個人空間與權限，讓實驗室多位成員各自管理論文與草稿。",
  },
];
