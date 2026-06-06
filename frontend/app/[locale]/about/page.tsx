"use client";

import { ArrowDownIcon, Check, X } from "lucide-react";
import { useTranslations } from "next-intl";

import { MermaidDiagram } from "@/components/mermaid-diagram";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const SECTION_IDS = [
  "intro",
  "arch",
  "pipeline",
  "kg",
  "rds",
  "rules",
  "example",
  "phase2",
  "guards",
  "literature",
  "perf",
  "editor",
] as const;

const EDITOR_MODULES = ["writing", "citation", "block", "export"] as const;

export default function AboutPage() {
  const t = useTranslations("about");

  return (
    <div className="mx-auto w-full max-w-7xl gap-8 px-4 py-8 sm:px-6 lg:flex">
      {/* Sticky TOC */}
      <aside className="lg:sticky lg:top-20 lg:h-[calc(100vh-6rem)] lg:w-56 lg:shrink-0 lg:overflow-y-auto">
        <nav className="mb-6 rounded-md border bg-card p-3 lg:mb-0">
          <p className="mb-2 text-[11px] font-semibold uppercase text-muted-foreground">
            {t("toc")}
          </p>
          <ul className="space-y-1">
            {SECTION_IDS.map((id) => (
              <li key={id}>
                <a
                  href={`#${id}`}
                  className="block rounded px-2 py-1 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  {t(`nav.${id}`)}
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
            {t("hero.badge")}
          </Badge>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            {t("hero.title")}
          </h1>
          <p className="text-lg text-muted-foreground">{t("hero.subtitle")}</p>
          <p className="max-w-3xl text-base leading-relaxed">{t("hero.lead")}</p>
          <a
            href="#intro"
            className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
          >
            {t("hero.startReading")} <ArrowDownIcon className="h-3 w-3" />
          </a>
        </header>

        {/* 1. 系統定位 */}
        <Section id="intro" title={t("sections.intro.title")}>
          <p>{t("intro.p1")}</p>

          <h3>{t("intro.compareHeading")}</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs">
                <tr>
                  <th className="p-2 text-left">{t("intro.compareColDim")}</th>
                  <th className="p-2 text-left">{t("intro.compareColLlm")}</th>
                  <th className="p-2 text-left">{t("intro.compareColOurs")}</th>
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    "reproducible",
                    "trace",
                    "maintainable",
                    "crossPaper",
                    "methodology",
                  ] as const
                ).map((key) => (
                  <ComparisonRow
                    key={key}
                    dim={t(`intro.compare.${key}.dim`)}
                    llm={t(`intro.compare.${key}.llm`)}
                    ours={t(`intro.compare.${key}.ours`)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        {/* 2. 系統架構 */}
        <Section id="arch" title={t("sections.arch.title")}>
          <p>{t("arch.p1")}</p>
          <MermaidDiagram
            caption={t("arch.diagramCaption")}
            code={`flowchart LR
    User([${t("arch.diagram.user")}])
    FE["${t("arch.diagram.fe")}"]
    BE["${t("arch.diagram.be")}"]
    Claude[(Anthropic Claude API<br/>Sonnet 4.6 / Opus 4.7)]
    Neo[(${t("arch.diagram.neo")})]
    SQL[(${t("arch.diagram.sql")})]
    Disk[(${t("arch.diagram.disk")})]

    User -- ${t("arch.diagram.edgeUpload")} --> FE
    FE -- ${t("arch.diagram.edgeHttp")} --> BE
    BE -- ${t("arch.diagram.edgeExtract")} --> Claude
    BE -- ${t("arch.diagram.edgeWrite")} --> Neo
    BE -- ${t("arch.diagram.edgeMeta")} --> SQL
    BE -- ${t("arch.diagram.edgeStore")} --> Disk
    FE -- ${t("arch.diagram.edgePull")} --> BE`}
          />
        </Section>

        {/* 3. Pipeline 時序圖 */}
        <Section id="pipeline" title={t("sections.pipeline.title")}>
          <p>
            {t.rich("pipeline.p1", {
              maxWorkers: () => <code>OPENAI_MAX_WORKERS</code>,
              jobId: () => <code>job_id</code>,
            })}
          </p>
          <MermaidDiagram
            caption={t("pipeline.diagramCaption")}
            code={`sequenceDiagram
    autonumber
    participant U as ${t("pipeline.diagram.user")}
    participant F as ${t("pipeline.diagram.fe")}
    participant B as ${t("pipeline.diagram.be")}
    participant O as ${t("pipeline.diagram.openai")}
    participant N as ${t("pipeline.diagram.neo")}
    participant S as ${t("pipeline.diagram.sql")}

    U->>F: ${t("pipeline.diagram.upload")}
    F->>B: POST /api/upload
    B->>B: ${t("pipeline.diagram.dedupe")}
    alt ${t("pipeline.diagram.hitAlt")}
        B-->>F: ${t("pipeline.diagram.hitReturn")}
    else ${t("pipeline.diagram.newFile")}
        B-->>F: ${t("pipeline.diagram.newReturn")}
        Note over B: ${t("pipeline.diagram.bgNote")}
        B->>B: ${t("pipeline.diagram.extractSpans")}
        alt ${t("pipeline.diagram.garbledAlt")}
            B->>B: ${t("pipeline.diagram.ocr")}
        end
        B->>B: ${t("pipeline.diagram.splitSections")}
        par ${t("pipeline.diagram.parSections")}
            B->>O: ${t("pipeline.diagram.sectionA")}
        and
            B->>O: ${t("pipeline.diagram.sectionB")}
        and
            B->>O: ${t("pipeline.diagram.sectionEtc")}
        end
        B->>N: ${t("pipeline.diagram.writeKg")}
        par ${t("pipeline.diagram.parRules")}
            B->>N: ${t("pipeline.diagram.cypherCand")}
            B->>O: ${t("pipeline.diagram.llmJudge")}
        end
        B->>O: ${t("pipeline.diagram.crossSection")}
        B->>S: ${t("pipeline.diagram.writeResult")}
        B-->>F: ${t("pipeline.diagram.jobDone")}
    end
    F->>B: ${t("pipeline.diagram.pullResult")}
    F-->>U: ${t("pipeline.diagram.resultPage")}`}
          />
        </Section>

        {/* 4. KG 資料結構 */}
        <Section id="kg" title={t("sections.kg.title")}>
          <p>{t("kg.p1")}</p>

          <h3>{t("kg.nodesHeading")}</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <NodeCard
              name="Paper"
              color="bg-rose-100 dark:bg-rose-950"
              attrs={["id", "title"]}
              meaning={t("kg.nodes.paper")}
            />
            <NodeCard
              name="EDU"
              color="bg-violet-100 dark:bg-violet-950"
              attrs={["id", "text", "section", "order", "page", "bbox", "paper_id"]}
              meaning={t("kg.nodes.edu")}
            />
            <NodeCard
              name="Entity"
              color="bg-emerald-100 dark:bg-emerald-950"
              attrs={["id", "name", "type", "paper_id"]}
              meaning={t("kg.nodes.entity")}
            />
            <NodeCard
              name="FRU"
              color="bg-cyan-100 dark:bg-cyan-950"
              attrs={["id", "function", "summary", "paper_id"]}
              meaning={t("kg.nodes.fru")}
            />
            <NodeCard
              name="RST"
              color="bg-amber-100 dark:bg-amber-950"
              attrs={["id", "rst_type", "paper_id"]}
              meaning={t("kg.nodes.rst")}
            />
          </div>

          <h3>{t("kg.edgesHeading")}</h3>
          <MermaidDiagram
            caption={t("kg.edgesDiagramCaption")}
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

          <h4 className="mt-4 mb-2 text-base font-semibold">
            {t("kg.edgesTableHeading")}
          </h4>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs">
                <tr>
                  <th className="p-2 text-left">{t("kg.edgesColEdge")}</th>
                  <th className="p-2 text-left">{t("kg.edgesColDir")}</th>
                  <th className="p-2 text-left">{t("kg.edgesColMeaning")}</th>
                  <th className="p-2 text-left">{t("kg.edgesColExample")}</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t">
                  <td className="p-2 font-mono text-xs">HAS_EDU</td>
                  <td className="p-2 text-xs">Paper → EDU</td>
                  <td className="p-2">{t("kg.edges.hasEdu.meaning")}</td>
                  <td className="p-2 text-xs">
                    {t("kg.edges.hasEdu.examplePrefix")}
                    <em>{t("kg.edges.hasEdu.examplePaper")}</em>
                    {t("kg.edges.hasEdu.exampleSuffix")}
                  </td>
                </tr>
                <tr className="border-t">
                  <td className="p-2 font-mono text-xs">COVERS</td>
                  <td className="p-2 text-xs">FRU → EDU</td>
                  <td className="p-2">{t("kg.edges.covers.meaning")}</td>
                  <td className="p-2 text-xs">{t("kg.edges.covers.example")}</td>
                </tr>
                <tr className="border-t">
                  <td className="p-2 font-mono text-xs">NUCLEUS</td>
                  <td className="p-2 text-xs">RST → EDU</td>
                  <td className="p-2">{t("kg.edges.nucleus.meaning")}</td>
                  <td className="p-2 text-xs">{t("kg.edges.nucleus.example")}</td>
                </tr>
                <tr className="border-t">
                  <td className="p-2 font-mono text-xs">SATELLITE</td>
                  <td className="p-2 text-xs">RST → EDU</td>
                  <td className="p-2">{t("kg.edges.satellite.meaning")}</td>
                  <td className="p-2 text-xs">{t("kg.edges.satellite.example")}</td>
                </tr>
                <tr className="border-t">
                  <td className="p-2 font-mono text-xs">ER</td>
                  <td className="p-2 text-xs">Entity → Entity</td>
                  <td className="p-2">{t("kg.edges.er.meaning")}</td>
                  <td className="p-2 text-xs">
                    {t("kg.edges.er.examplePrefix")}
                    {`{predicate: "based_on"}`}
                    {t("kg.edges.er.exampleSuffix")}
                  </td>
                </tr>
                <tr className="border-t">
                  <td className="p-2 font-mono text-xs">MENTIONED_IN</td>
                  <td className="p-2 text-xs">Entity → EDU</td>
                  <td className="p-2">{t("kg.edges.mentionedIn.meaning")}</td>
                  <td className="p-2 text-xs">
                    {t("kg.edges.mentionedIn.example")}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <h3>{t("kg.fruHeading")}</h3>
          <p className="text-xs text-muted-foreground">{t("kg.fruIntro")}</p>
          <SubtypeTable items={FRU_FUNCTION_NAMES} kind="fruFunctions" />

          <h3>{t("kg.rstHeading")}</h3>
          <p className="text-xs text-muted-foreground">{t("kg.rstIntro")}</p>
          <SubtypeTable items={RST_TYPE_NAMES} kind="rstTypes" />

          <h3>{t("kg.whyHeading")}</h3>
          <p>{t("kg.whyIntro")}</p>
          <ul>
            <li>
              <strong>REL-01 Claim-Evidence</strong>：{t("kg.why.rel01")}
            </li>
            <li>
              <strong>REL-09 Observation-Attribution</strong>：{t("kg.why.rel09")}
            </li>
            <li>
              <strong>REL-04 Macro-Decomposition</strong>：{t("kg.why.rel04")}
            </li>
            <li>
              <strong>{t("kg.why.entityLabel")}</strong>：{t("kg.why.entity")}
            </li>
          </ul>
        </Section>

        {/* 5. SQLite 資料結構 */}
        <Section id="rds" title={t("sections.rds.title")}>
          <p>{t("rds.p1")}</p>
          <MermaidDiagram
            caption={t("rds.diagramCaption")}
            code={`erDiagram
    papers ||--o| results : "${t("rds.erd.rel1to1")}"
    papers ||--o{ llm_calls : "${t("rds.erd.rel1toManyCalls")}"
    papers ||--o{ defect_judgments : "${t("rds.erd.rel1toManyJudgments")}"
    results ||--o{ defect_judgments : "${t("rds.erd.relLogical")}"

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

          <h3>{t("rds.schemaHeading")}</h3>

          <TableSchema
            name="papers"
            purpose={t("rds.tables.papers.purpose")}
            keyDesign={t("rds.tables.papers.keyDesign")}
            columns={[
              { col: "paper_id", type: "TEXT PK", desc: t("rds.tables.papers.cols.paper_id") },
              { col: "title", type: "TEXT", desc: t("rds.tables.papers.cols.title") },
              { col: "content_hash", type: "TEXT", desc: t("rds.tables.papers.cols.content_hash") },
              { col: "pdf_path", type: "TEXT", desc: t("rds.tables.papers.cols.pdf_path") },
              { col: "created_at", type: "TEXT NOT NULL", desc: t("rds.tables.papers.cols.created_at") },
            ]}
          />

          <TableSchema
            name="results"
            purpose={t("rds.tables.results.purpose")}
            keyDesign={t("rds.tables.results.keyDesign")}
            columns={[
              { col: "paper_id", type: "TEXT PK / FK", desc: t("rds.tables.results.cols.paper_id") },
              { col: "result_json", type: "TEXT NOT NULL", desc: t("rds.tables.results.cols.result_json") },
              { col: "finished_at", type: "TEXT NOT NULL", desc: t("rds.tables.results.cols.finished_at") },
            ]}
          />

          <TableSchema
            name="llm_calls"
            purpose={t("rds.tables.llm_calls.purpose")}
            keyDesign={t("rds.tables.llm_calls.keyDesign")}
            columns={[
              { col: "id", type: "INTEGER PK AUTOINCREMENT", desc: t("rds.tables.llm_calls.cols.id") },
              { col: "paper_id", type: "TEXT", desc: t("rds.tables.llm_calls.cols.paper_id") },
              { col: "stage", type: "TEXT NOT NULL", desc: t("rds.tables.llm_calls.cols.stage") },
              { col: "model", type: "TEXT NOT NULL", desc: t("rds.tables.llm_calls.cols.model") },
              { col: "input_tokens", type: "INTEGER NOT NULL", desc: t("rds.tables.llm_calls.cols.input_tokens") },
              { col: "output_tokens", type: "INTEGER NOT NULL", desc: t("rds.tables.llm_calls.cols.output_tokens") },
              { col: "cache_read_tokens", type: "INTEGER DEFAULT 0", desc: t("rds.tables.llm_calls.cols.cache_read_tokens") },
              { col: "cache_write_tokens", type: "INTEGER DEFAULT 0", desc: t("rds.tables.llm_calls.cols.cache_write_tokens") },
              { col: "cost_usd", type: "REAL NOT NULL", desc: t("rds.tables.llm_calls.cols.cost_usd") },
              { col: "created_at", type: "TEXT NOT NULL", desc: t("rds.tables.llm_calls.cols.created_at") },
            ]}
          />

          <TableSchema
            name="defect_judgments"
            purpose={t("rds.tables.defect_judgments.purpose")}
            keyDesign={t("rds.tables.defect_judgments.keyDesign")}
            columns={[
              { col: "paper_id", type: "TEXT PK", desc: t("rds.tables.defect_judgments.cols.paper_id") },
              { col: "defect_id", type: "TEXT PK", desc: t("rds.tables.defect_judgments.cols.defect_id") },
              { col: "rule_id", type: "TEXT NOT NULL", desc: t("rds.tables.defect_judgments.cols.rule_id") },
              { col: "verdict", type: "TEXT CHECK", desc: t("rds.tables.defect_judgments.cols.verdict") },
              { col: "note", type: "TEXT", desc: t("rds.tables.defect_judgments.cols.note") },
              { col: "created_at", type: "TEXT NOT NULL", desc: t("rds.tables.defect_judgments.cols.created_at") },
            ]}
          />

          <h3>{t("rds.strengthHeading")}</h3>
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs">
              <tr>
                <th className="p-2 text-left">{t("rds.strengthColRel")}</th>
                <th className="p-2 text-left">{t("rds.strengthColStrength")}</th>
                <th className="p-2 text-left">{t("rds.strengthColWhy")}</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t">
                <td className="p-2 font-mono text-xs">papers ↔ results</td>
                <td className="p-2">{t("rds.strength.papersResults.strength")}</td>
                <td className="p-2">{t("rds.strength.papersResults.why")}</td>
              </tr>
              <tr className="border-t">
                <td className="p-2 font-mono text-xs">papers ↔ llm_calls</td>
                <td className="p-2">{t("rds.strength.papersCalls.strength")}</td>
                <td className="p-2">{t("rds.strength.papersCalls.why")}</td>
              </tr>
              <tr className="border-t">
                <td className="p-2 font-mono text-xs">papers ↔ judgments</td>
                <td className="p-2">{t("rds.strength.papersJudgments.strength")}</td>
                <td className="p-2">{t("rds.strength.papersJudgments.why")}</td>
              </tr>
              <tr className="border-t">
                <td className="p-2 font-mono text-xs">judgments ↔ results.json</td>
                <td className="p-2">{t("rds.strength.judgmentsResults.strength")}</td>
                <td className="p-2">{t("rds.strength.judgmentsResults.why")}</td>
              </tr>
            </tbody>
          </table>
        </Section>

        {/* 6. 13 條 REL 規則 */}
        <Section id="rules" title={t("sections.rules.title")}>
          <p>{t("rules.p1")}</p>
          <MermaidDiagram
            caption={t("rules.diagramCaption")}
            code={`flowchart LR
    Y[${t("rules.diagram.yaml")}] --> S1
    S1[${t("rules.diagram.step1")}] --> C[${t("rules.diagram.candidates")}]
    C --> S2[${t("rules.diagram.step2")}]
    S2 --> D[${t("rules.diagram.defect")}]`}
          />
          <h3>{t("rules.listHeading")}</h3>
          <p className="text-xs text-muted-foreground">{t("rules.listIntro")}</p>

          <div className="space-y-3">
            {REL_RULES.map((r) => (
              <RuleCard key={r.id} rule={r} />
            ))}
          </div>
        </Section>

        {/* 7. 範例走查 */}
        <Section id="example" title={t("sections.example.title")}>
          <p>{t.rich("example.intro", { b: (c) => <strong>{c}</strong> })}</p>

          <ExampleStep n={1} title={t("example.step1.title")}>
            <Quote>
              While single-head attention is 0.9 BLEU worse than the best setting,
              quality also drops off with too many heads.
            </Quote>
            <p>{t("example.step1.translation")}</p>
            <p className="text-xs text-muted-foreground">
              {t("example.step1.location")}
            </p>
          </ExampleStep>

          <ExampleStep n={2} title={t("example.step2.title")}>
            <p>{t("example.step2.intro")}</p>
            <ul>
              <li>
                <strong>{t("example.step2.observationLabel")}</strong>
                {t("example.step2.observation")}
              </li>
              <li>
                <strong>{t("example.step2.locationLabel")}</strong>
                {t("example.step2.location")}
              </li>
              <li>
                <strong>{t("example.step2.rstLabel")}</strong>
                {t("example.step2.rst")}
              </li>
            </ul>
            <p>{t("example.step2.key")}</p>
          </ExampleStep>

          <ExampleStep n={3} title={t("example.step3.title")}>
            <p>{t("example.step3.intro")}</p>
            <blockquote className="my-2 border-l-2 border-primary bg-primary/5 p-3 text-sm font-medium">
              {t("example.step3.quote")}
            </blockquote>
            <p>{t.rich("example.step3.body", { b: (c) => <strong>{c}</strong> })}</p>
            <p className="text-xs text-muted-foreground">
              {t("example.step3.contrast")}
            </p>
          </ExampleStep>

          <ExampleStep n={4} title={t("example.step4.title")}>
            <p>{t("example.step4.intro")}</p>
            <ul>
              <li>
                <strong>{t("example.step4.verdictLabel")}</strong>
                {t("example.step4.verdict")}
              </li>
              <li>
                <strong>{t("example.step4.severityLabel")}</strong>
                {t("example.step4.severity")}
              </li>
              <li>
                <strong>{t("example.step4.confidenceLabel")}</strong>
                {t("example.step4.confidence")}
              </li>
              <li>
                <strong>{t("example.step4.suggestionLabel")}</strong>
                {t("example.step4.suggestion")}
              </li>
            </ul>
          </ExampleStep>

          <ExampleStep n={5} title={t("example.step5.title")}>
            <Card className="border-l-4 border-l-orange-500">
              <CardContent className="space-y-2 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant="outline" className="font-mono text-[10px]">
                    REL-09
                  </Badge>
                  <span className="font-semibold">
                    {t("example.step5.defectName")}
                  </span>
                  <span className="rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-medium text-orange-700">
                    {t("example.step5.severityBadge")}
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
                <p>{t("example.step5.body")}</p>
                <div className="rounded bg-muted/60 p-2 text-xs">
                  <strong>{t("example.step5.suggestionLabel")}</strong>
                  {t("example.step5.suggestion")}
                </div>
              </CardContent>
            </Card>
            <p className="mt-2 text-xs text-muted-foreground">
              {t("example.step5.footnote")}
            </p>
          </ExampleStep>

          <ExampleStep n={6} title={t("example.step6.title")}>
            <p>
              {t("example.step6.body1Prefix")}
              <strong>{t("example.step6.verdictCorrect")}</strong> /{" "}
              <strong>{t("example.step6.verdictPartial")}</strong> /{" "}
              <strong>{t("example.step6.verdictWrong")}</strong>
              {t("example.step6.body1Suffix")}
            </p>
            <p>
              {t("example.step6.body2Prefix")}
              <strong>{t("example.step6.body2Bold")}</strong>
              {t("example.step6.body2Suffix")}
            </p>
          </ExampleStep>
        </Section>

        {/* 8. 人工評估機制 */}
        <Section id="phase2" title={t("sections.phase2.title")}>
          <p>
            {t("phase2.p1Prefix")}
            <strong>{t("phase2.p1Bold")}</strong>
            {t("phase2.p1Suffix")}
          </p>
          <MermaidDiagram
            caption={t("phase2.diagramCaption")}
            code={`flowchart LR
    A[${t("phase2.diagram.newPaper")}] --> B[${t("phase2.diagram.cypher")}]
    B --> D[${t("phase2.diagram.llm")}]
    D --> G[${t("phase2.diagram.defectList")}]
    G -. ${t("phase2.diagram.manualLabel")} .-> H[("${t("phase2.diagram.sqlite")}")]
    H --> I["${t("phase2.diagram.summary")}"]
    H --> J["${t("phase2.diagram.export")}"]`}
          />
          <p>{t("phase2.p2")}</p>
        </Section>

        {/* 9. 聊天 Guardrails */}
        <Section id="guards" title={t("sections.guards.title")}>
          <p>{t("guards.p1")}</p>
          <ol className="text-sm">
            <li>
              <strong>{t("guards.scopeLabel")}</strong>
              {t("guards.scope")}
            </li>
            <li>
              <strong>{t("guards.citeLabel")}</strong>
              {t("guards.citePrefix")}
              <code className="rounded bg-muted px-1 text-xs">[EDU:xxx]</code>
              {t("guards.citeMid")}
              <code className="rounded bg-muted px-1 text-xs">[DEFECT:xxx]</code>
              {t("guards.citeSuffix")}
            </li>
            <li>
              <strong>{t("guards.injectionLabel")}</strong>
              {t("guards.injection")}
            </li>
            <li>
              <strong>{t("guards.rateLabel")}</strong>
              {t("guards.rate")}
            </li>
          </ol>
        </Section>

        {/* 10. 理論文獻 */}
        <Section id="literature" title={t("sections.literature.title")}>
          <p>{t("literature.p1")}</p>
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs">
              <tr>
                <th className="p-2 text-left">{t("literature.colDesign")}</th>
                <th className="p-2 text-left">{t("literature.colWork")}</th>
              </tr>
            </thead>
            <tbody>
              {LITERATURE.map((row) => (
                <tr key={row.key} className="border-t">
                  <td className="p-2">{t(`literature.items.${row.key}`)}</td>
                  <td className="p-2 italic">{row.work}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        {/* 11. 效能與穩定性 */}
        <Section id="perf" title={t("sections.perf.title")}>
          <p>
            {t("perf.p1Prefix")}
            <strong>{t("perf.p1Calls")}</strong>
            {t("perf.p1Mid")}
            <strong>{t("perf.p1Minutes")}</strong>
            {t("perf.p1Suffix")}
          </p>

          <h3>{t("perf.h1")}</h3>
          <p>{t.rich("perf.h1p", { table: () => <code>llm_calls</code> })}</p>
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs">
              <tr>
                <th className="p-2 text-left">{t("perf.diag1ColBlock")}</th>
                <th className="p-2 text-left">{t("perf.diag1ColCalls")}</th>
                <th className="p-2 text-left">{t("perf.diag1ColTime")}</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t">
                <td className="p-2">{t("perf.diag1.extractBlock")}</td>
                <td className="p-2">{t("perf.diag1.extractCalls")}</td>
                <td className="p-2">{t("perf.diag1.extractTime")}</td>
              </tr>
              <tr className="border-t">
                <td className="p-2">{t("perf.diag1.rulesBlock")}</td>
                <td className="p-2">{t("perf.diag1.rulesCalls")}</td>
                <td className="p-2">{t("perf.diag1.rulesTime")}</td>
              </tr>
              <tr className="border-t">
                <td className="p-2">{t("perf.diag1.crossBlock")}</td>
                <td className="p-2">{t("perf.diag1.crossCalls")}</td>
                <td className="p-2">{t("perf.diag1.crossTime")}</td>
              </tr>
              <tr className="border-t font-medium">
                <td className="p-2">{t("perf.diag1.totalBlock")}</td>
                <td className="p-2">{t("perf.diag1.totalCalls")}</td>
                <td className="p-2">{t("perf.diag1.totalTime")}</td>
              </tr>
            </tbody>
          </table>

          <h3>{t("perf.h2")}</h3>
          <p>{t.rich("perf.h2p", { maxWorkers: () => <code>OPENAI_MAX_WORKERS</code> })}</p>
          <ul>
            <li>
              <strong>{t("perf.h2li.crossSectionLabel")}</strong>
              {t("perf.h2li.crossSection")}
            </li>
            <li>
              <strong>{t("perf.h2li.crossRuleLabel")}</strong>
              {t("perf.h2li.crossRule")}
            </li>
            <li>
              <strong>{t("perf.h2li.safeLabel")}</strong>
              {t.rich("perf.h2li.safe", { poolMap: () => <code>pool.map</code> })}
            </li>
            <li>
              <strong>{t("perf.h2li.rateLabel")}</strong>
              {t("perf.h2li.ratePrefix")}
              <code>call_with_tool</code>
              {t("perf.h2li.rateSuffix")}
            </li>
          </ul>

          <h3>{t("perf.h3")}</h3>
          <p>
            {t("perf.h3p1Prefix")}
            <strong>{t("perf.h3p1Bold")}</strong>
            {t("perf.h3p1Suffix")}
          </p>
          <p>
            {t("perf.h3p2Prefix")}
            <code>{`{candidate_index, violates:false}`}</code>
            {t("perf.h3p2Suffix")}
          </p>

          <h3>{t("perf.h4")}</h3>
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs">
              <tr>
                <th className="p-2 text-left">{t("perf.h4ColStage")}</th>
                <th className="p-2 text-left">{t("perf.h4ColBefore")}</th>
                <th className="p-2 text-left">{t("perf.h4ColAfter")}</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t">
                <td className="p-2">build_paper_graph</td>
                <td className="p-2">{t("perf.diag4.buildBefore")}</td>
                <td className="p-2">{t("perf.diag4.buildAfter")}</td>
              </tr>
              <tr className="border-t">
                <td className="p-2">check_all_rules</td>
                <td className="p-2">{t("perf.diag4.checkBefore")}</td>
                <td className="p-2">{t("perf.diag4.checkAfter")}</td>
              </tr>
              <tr className="border-t">
                <td className="p-2">cross_section</td>
                <td className="p-2">{t("perf.diag4.crossBefore")}</td>
                <td className="p-2">{t("perf.diag4.crossAfter")}</td>
              </tr>
              <tr className="border-t font-medium">
                <td className="p-2">{t("perf.diag4.totalStage")}</td>
                <td className="p-2">{t("perf.diag4.totalBefore")}</td>
                <td className="p-2">{t("perf.diag4.totalAfter")}</td>
              </tr>
            </tbody>
          </table>

          <h3>{t("perf.h5")}</h3>
          <p>
            {t.rich("perf.h5p", {
              garbled: () => <code>*?Ti2`</code>,
              chapter: () => <code>Chapter</code>,
            })}
          </p>

          <h3>{t("perf.h6")}</h3>
          <p>{t.rich("perf.h6p", { tests: () => <code>backend/tests/</code> })}</p>
        </Section>

        {/* 12. 寫作編輯器 */}
        <Section id="editor" title={t("sections.editor.title")}>
          <p>{t("editor.p1")}</p>

          <h3>{t("editor.modulesHeading")}</h3>
          <ul>
            {EDITOR_MODULES.map((k) => (
              <li key={k}>
                <strong>{t(`editor.modules.${k}.title`)}</strong>
                {t(`editor.modules.${k}.desc`)}
              </li>
            ))}
          </ul>

          <MermaidDiagram
            caption={t("editor.diagramCaption")}
            code={`flowchart LR
    U([${t("editor.diagram.author")}])
    ED["${t("editor.diagram.ed")}"]
    SVC["${t("editor.diagram.svc")}"]
    CT["${t("editor.diagram.cite")}"]
    OA[(OpenAlex)]
    EX["${t("editor.diagram.export")}"]
    DB[("${t("editor.diagram.db")}")]

    U --> ED
    ED -- ${t("editor.diagram.edgeStream")} --> SVC
    ED -- ${t("editor.diagram.edgeSearch")} --> CT
    CT --> OA
    ED -- ${t("editor.diagram.edgeExport")} --> EX
    ED -- ${t("editor.diagram.edgeSave")} --> DB`}
          />

          <h3>{t("editor.diffHeading")}</h3>
          <p>{t("editor.diff")}</p>
        </Section>

        {/* Footer */}
        <footer className="border-t pt-6 text-center text-xs text-muted-foreground">
          {t("footer.prefix")}
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
  const t = useTranslations("about");
  const hitBadge: Record<RelRule["vaswaniHit"], { label: string; cls: string }> = {
    fire: { label: t("rules.card.hitFire"), cls: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300" },
    partial: { label: t("rules.card.hitPartial"), cls: "bg-yellow-100 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-300" },
    healthy: { label: t("rules.card.hitHealthy"), cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" },
  };
  const badge = hitBadge[rule.vaswaniHit];
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <Badge variant="outline" className="font-mono">
            {rule.id}
          </Badge>
          <span>{t(`relRules.${rule.id}.name`)}</span>
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
          <strong className="text-muted-foreground text-xs">{t("rules.card.meaningLabel")}</strong>
          <p>{t(`relRules.${rule.id}.meaning`)}</p>
        </div>
        <div>
          <strong className="text-muted-foreground text-xs">{t("rules.card.triggerLabel")}</strong>
          <p>{t(`relRules.${rule.id}.trigger`)}</p>
        </div>
        <div className="space-y-2 rounded bg-muted/40 p-3">
          <div className="text-xs leading-relaxed">
            <strong>{t("rules.card.exampleLabel")}</strong>
            {t(`relRules.${rule.id}.example`)}
          </div>
          <div className="border-l-2 border-primary/40 pl-3">
            <p className="mb-1 text-[10px] font-semibold uppercase text-muted-foreground">
              {t("rules.card.englishLabel", { location: rule.vaswaniLocation })}
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
  const t = useTranslations("about");
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
          <strong>{t("rds.tablePurpose")}</strong>
          {purpose}
        </p>
        <p className="text-xs text-muted-foreground">
          <strong>{t("rds.tableKeyDesign")}</strong>
          {keyDesign}
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 text-[11px] uppercase text-muted-foreground">
              <tr>
                <th className="p-2 text-left">{t("rds.tableColCol")}</th>
                <th className="p-2 text-left">{t("rds.tableColType")}</th>
                <th className="p-2 text-left">{t("rds.tableColDesc")}</th>
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
  const t = useTranslations("about");
  return (
    <div className="my-4 rounded-md border-l-4 border-l-primary/40 bg-card p-4">
      <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
        {t("example.stepLabel", { n })}
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

const FRU_FUNCTION_NAMES = [
  "Motivation",
  "Claim",
  "Evidence",
  "Background",
  "Definition",
  "MethodStep",
  "Observation",
  "Attribution",
  "Concession",
  "Compensation",
  "Specific",
  "Generalization",
  "Restatement",
  "MetaDiscourse",
  "Other",
] as const;

const RST_TYPE_NAMES = [
  "Elaboration",
  "Background",
  "Cause",
  "Result",
  "Contrast",
  "Concession",
  "Evidence",
  "Justify",
  "Motivation",
  "Solutionhood",
  "Sequence",
  "Restatement",
  "Summary",
  "Condition",
  "Other",
] as const;

function SubtypeTable({
  items,
  kind,
}: {
  items: readonly string[];
  kind: "fruFunctions" | "rstTypes";
}) {
  const t = useTranslations("about");
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-xs">
          <tr>
            <th className="p-2 text-left">{t("subtypeTable.colName")}</th>
            <th className="p-2 text-left">{t("subtypeTable.colMeaning")}</th>
            <th className="p-2 text-left">{t("subtypeTable.colExample")}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((name) => (
            <tr key={name} className="border-t align-top">
              <td className="p-2">
                <Badge variant="outline" className="font-mono text-[10px]">
                  {name}
                </Badge>
              </td>
              <td className="p-2 text-xs">{t(`${kind}.${name}.meaning`)}</td>
              <td className="p-2 text-xs leading-relaxed">
                {t(`${kind}.${name}.example`)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type RelRule = {
  id: string;
  defectLabel: string;
  vaswaniEnglish: string;
  vaswaniLocation: string;
  vaswaniHit: "fire" | "healthy" | "partial";
};

const REL_RULES: RelRule[] = [
  {
    id: "REL-01",
    defectLabel: "NakedClaim",
    vaswaniEnglish:
      "The Transformer allows for significantly more parallelization and can reach a new state of the art in translation quality after being trained for as little as twelve hours on eight P100 GPUs.",
    vaswaniLocation: "Section 1 Introduction, p.2",
    vaswaniHit: "fire",
  },
  {
    id: "REL-02",
    defectLabel: "BaselineNotCritiqued",
    vaswaniEnglish:
      "Table 2: The Transformer achieves better BLEU scores than previous state-of-the-art models on the English-to-German and English-to-French newstest2014 tests at a fraction of the training cost. (Lists ByteNet 23.75, GNMT+RL 24.6, ConvS2S 25.16, MoE 26.03 — but no discussion of each baseline's design weaknesses.)",
    vaswaniLocation: "Section 6.1 / Table 2, p.8",
    vaswaniHit: "partial",
  },
  {
    id: "REL-03",
    defectLabel: "MissingMotivation",
    vaswaniEnglish:
      "We used the Adam optimizer with β1 = 0.9, β2 = 0.98 and ϵ = 10^−9. We varied the learning rate over the course of training, according to the formula: ... We used warmup_steps = 4000.",
    vaswaniLocation: "Section 5.3 Optimizer, p.7",
    vaswaniHit: "fire",
  },
  {
    id: "REL-04",
    defectLabel: "NoMacroDecomposition",
    vaswaniEnglish:
      "[Intro] This inherently sequential nature precludes parallelization within training examples ... [+] One key factor affecting the ability to learn such [long-range] dependencies is the length of the paths forward and backward signals have to traverse in the network. [— Method 章節直接給 Self-Attention / Multi-Head Attention 而沒重述「我們解 problem 1 + 2」的對應映射]",
    vaswaniLocation: "Intro p.2 ↔ Section 3 Model Architecture p.3",
    vaswaniHit: "fire",
  },
  {
    id: "REL-05",
    defectLabel: "WeakProcessSequence",
    vaswaniEnglish:
      "3.1 Encoder and Decoder Stacks / 3.2 Attention / 3.3 Position-wise Feed-Forward Networks / 3.4 Embeddings and Softmax / 3.5 Positional Encoding — 子章節編號清楚對應 forward pass 的順序。",
    vaswaniLocation: "Section 3 Model Architecture, p.3–6",
    vaswaniHit: "healthy",
  },
  {
    id: "REL-06",
    defectLabel: "ConceptNotFormalized",
    vaswaniEnglish:
      "Experiments on two machine translation tasks show these models to be superior in quality while being more parallelizable and requiring significantly less time to train.",
    vaswaniLocation: "Abstract, p.1",
    vaswaniHit: "fire",
  },
  {
    id: "REL-07",
    defectLabel: "SetupNotScoped",
    vaswaniEnglish:
      "We trained on the standard WMT 2014 English-German dataset consisting of about 4.5 million sentence pairs ... Each training batch contained a set of sentence pairs containing approximately 25000 source tokens and 25000 target tokens. We trained our models on one machine with 8 NVIDIA P100 GPUs.",
    vaswaniLocation: "Section 5.1–5.2 Training Data / Hardware, p.7",
    vaswaniHit: "healthy",
  },
  {
    id: "REL-08",
    defectLabel: "ProblemSolutionMismatch",
    vaswaniEnglish:
      "[Section 2] In the Transformer this is reduced to a constant number of operations, albeit at the cost of reduced effective resolution due to averaging attention-weighted positions, an effect we counteract with Multi-Head Attention as described in section 3.2. [— Section 3.2 Multi-Head Attention 一開頭沒重述「降解析度問題」就直接給公式]",
    vaswaniLocation: "Section 2 p.2 ↔ Section 3.2.2 Multi-Head Attention p.4",
    vaswaniHit: "fire",
  },
  {
    id: "REL-09",
    defectLabel: "ObservationWithoutAttribution",
    vaswaniEnglish:
      "While single-head attention is 0.9 BLEU worse than the best setting, quality also drops off with too many heads. [— 此段後直接跳到 row (B)，沒解釋為什麼太多 head 會掉品質]",
    vaswaniLocation: "Section 6.2 Model Variations / Table 3 row (A), p.9",
    vaswaniHit: "fire",
  },
  {
    id: "REL-10",
    defectLabel: "UncompensatedConcession",
    vaswaniEnglish:
      "...albeit at the cost of reduced effective resolution due to averaging attention-weighted positions, an effect we counteract with Multi-Head Attention as described in section 3.2.",
    vaswaniLocation: "Section 2 Background, p.2",
    vaswaniHit: "healthy",
  },
  {
    id: "REL-11",
    defectLabel: "SpecificGeneralizationImbalance",
    vaswaniEnglish:
      "We show that the Transformer generalizes well to other tasks by applying it successfully to English constituency parsing both with large and limited training data.",
    vaswaniLocation: "Abstract, p.1",
    vaswaniHit: "fire",
  },
  {
    id: "REL-12",
    defectLabel: "ConclusionMisaligned",
    vaswaniEnglish:
      "[Abstract] We show that the Transformer generalizes well to other tasks by applying it successfully to English constituency parsing ... [Conclusion] On both WMT 2014 English-to-German and WMT 2014 English-to-French translation tasks, we achieve a new state of the art. [— Conclusion 只重申翻譯成果，沒重申 constituency parsing 的泛化驗證]",
    vaswaniLocation: "Abstract p.1 ↔ Section 7 Conclusion p.10",
    vaswaniHit: "fire",
  },
  {
    id: "REL-13",
    defectLabel: "MetaDiscourseImbalance",
    vaswaniEnglish:
      "To the best of our knowledge, however, the Transformer is the first transduction model relying entirely on self-attention to compute representations of its input and output without using sequence-aligned RNNs or convolution. In the following sections, we will describe the Transformer, motivate self-attention and discuss its advantages over models such as [17, 18] and [9].",
    vaswaniLocation: "Section 2 Background, last paragraph, p.2",
    vaswaniHit: "healthy",
  },
];

const LITERATURE: { key: string; work: string }[] = [
  { key: "transformer", work: "Vaswani et al. 2017 — Attention Is All You Need" },
  { key: "rst", work: "Mann & Thompson 1988 — Rhetorical Structure Theory" },
  { key: "argMining", work: "Stab & Gurevych 2017 — Parsing Argumentation Structures (CL Journal)" },
  { key: "kgLlm", work: "Pan et al. 2024 — Unifying LLMs and KGs: A Roadmap (TKDE)" },
  { key: "neurosymbolic", work: "Garcez & Lamb 2020 — Neurosymbolic AI: The 3rd Wave" },
  { key: "toolUse", work: "Schick et al. 2023 — Toolformer" },
  { key: "longContext", work: "Liu et al. 2024 — Lost in the Middle (TACL)" },
  { key: "hallucination", work: "Tonmoy et al. 2024 — Hallucination Mitigation Survey" },
  { key: "humanJudge", work: "Chiang & Lee 2023 — Can LLMs Be Alternative to Human Evaluations (ACL)" },
];
