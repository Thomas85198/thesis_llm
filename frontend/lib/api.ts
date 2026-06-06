// Browser fetches use NEXT_PUBLIC_API_BASE (baked in at build time).
// SSR fetches run inside the Next.js container, where `localhost` is the
// frontend itself — use API_INTERNAL_BASE (compose network hostname) instead.
const API_BASE =
  typeof window === "undefined"
    ? process.env.API_INTERNAL_BASE ??
      process.env.NEXT_PUBLIC_API_BASE ??
      "http://localhost:8000"
    : process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";

export const apiBase = API_BASE;

// ---------- Types ----------

export type Rule = {
  id: string;
  name: string;
  description: string;
};

export type SectionName =
  | "Abstract"
  | "Introduction"
  | "Method"
  | "Experiment"
  | "Results"
  | "Discussion"
  | "Conclusion"
  | "Other";

export type EDU = {
  id: string;
  text: string;
  section: SectionName;
  order: number;
  page: number;
  bbox: [number, number, number, number];
};

export type Entity = {
  id: string;
  name: string;
  type: string;
};

export type ERTriple = {
  id: string;
  source_entity_id: string;
  target_entity_id: string;
  predicate: string;
  evidence_edu_id: string;
};

export type RSTNode = {
  id: string;
  rst_type: string;
  nucleus_edu_id: string;
  satellite_edu_ids: string[];
};

export type FRUNode = {
  id: string;
  function: string;
  edu_ids: string[];
  summary: string;
};

export type PaperGraph = {
  paper_id: string;
  title: string;
  edus: EDU[];
  entities: Entity[];
  er_triples: ERTriple[];
  rst_nodes: RSTNode[];
  fru_nodes: FRUNode[];
};

export type Severity = "high" | "medium" | "low";

// LLM-generated text, keyed by locale: { "zh-Hant": "…", "en": "…" }. A plain
// string is tolerated for safety (legacy / not-yet-translated data).
export type LocalizedText = Record<string, string>;

/** Read a localized value for `locale`, falling back to zh-Hant then any value. */
export function pickLocalized(
  value: LocalizedText | string | null | undefined,
  locale: string
): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  return value[locale] ?? value["zh-Hant"] ?? Object.values(value)[0] ?? "";
}

export type Defect = {
  id: string;
  rule_id: string;
  defect_type: string;
  severity: Severity;
  section: SectionName;
  evidence_edu_ids: string[];
  description: LocalizedText | string;
  suggestion: LocalizedText | string;
  confidence?: number | null; // 0.0–1.0
};

export type RuleRunMeta = {
  rule_id: string;
  candidate_count: number;
  defect_count: number;
};

export type AnalysisResult = {
  paper_id: string;
  graph: PaperGraph;
  defects: Defect[];
  rule_meta?: RuleRunMeta[];
};

export type JobStatus =
  | "queued"
  | "extracting"
  | "checking"
  | "done"
  | "error";

export type Job = {
  status: JobStatus;
  paper_id: string;
  title: string;
  message?: string;
  error?: string;
  result?: AnalysisResult;
  created_at: string;
  finished_at?: string;
};

export type PaperListItem = {
  paper_id: string;
  title: string;        // 顯示用：使用者填的 title，沒填 fallback 到 filename
  filename: string;     // 原始檔名（永遠記錄）
  defect_count: number;
  edu_count: number;
  finished_at?: string | null;
};

export type CostStageRow = {
  stage: string;
  model: string;
  calls: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
};

export type CostSummary = {
  total: {
    calls: number;
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    cache_write_tokens: number;
    cost_usd: number;
  };
  by_stage: CostStageRow[];
};

// ---------- Calls ----------

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`${path} → ${res.status} ${await res.text()}`);
  return res.json();
}

export async function fetchRules(): Promise<Rule[]> {
  return get<Rule[]>("/api/rules");
}

export async function listPapers(): Promise<PaperListItem[]> {
  return get<PaperListItem[]>("/api/papers");
}

export async function fetchPaperResult(paperId: string): Promise<AnalysisResult> {
  return get<AnalysisResult>(
    `/api/papers/${encodeURIComponent(paperId)}/result`
  );
}

export async function fetchJob(jobId: string): Promise<Job> {
  return get<Job>(`/api/jobs/${encodeURIComponent(jobId)}`);
}

export async function uploadPaper(
  file: File,
  title?: string
): Promise<{ job_id: string; paper_id: string; cached?: boolean }> {
  const fd = new FormData();
  fd.append("file", file);
  if (title) fd.append("title", title);
  const res = await fetch(`${API_BASE}/api/upload`, {
    method: "POST",
    body: fd,
  });
  if (!res.ok) throw new Error(`upload failed: ${await res.text()}`);
  return res.json();
}

export function pdfUrl(paperId: string): string {
  return `${API_BASE}/api/papers/${encodeURIComponent(paperId)}/pdf`;
}

export async function deletePaper(paperId: string): Promise<void> {
  const res = await fetch(
    `${API_BASE}/api/papers/${encodeURIComponent(paperId)}`,
    { method: "DELETE" }
  );
  if (!res.ok) throw new Error(`deletePaper failed: ${await res.text()}`);
}

export async function fetchOverallCost(): Promise<CostSummary> {
  return get<CostSummary>("/api/cost");
}

export async function fetchPaperCost(paperId: string): Promise<CostSummary> {
  return get<CostSummary>(`/api/papers/${encodeURIComponent(paperId)}/cost`);
}

// ---------- Human-as-judge ----------

export type Verdict = "correct" | "wrong" | "partial";

export type Judgment = {
  defect_id: string;
  rule_id: string;
  verdict: Verdict;
  note: string | null;
  created_at: string;
};

export async function fetchJudgments(paperId: string): Promise<Judgment[]> {
  return get<Judgment[]>(
    `/api/papers/${encodeURIComponent(paperId)}/judgments`
  );
}

export async function submitJudgment(
  paperId: string,
  body: { defect_id: string; rule_id: string; verdict: Verdict; note?: string }
): Promise<void> {
  const res = await fetch(
    `${API_BASE}/api/papers/${encodeURIComponent(paperId)}/judgments`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  if (!res.ok) throw new Error(`submitJudgment failed: ${await res.text()}`);
}

export async function deleteJudgment(
  paperId: string,
  defectId: string
): Promise<void> {
  const res = await fetch(
    `${API_BASE}/api/papers/${encodeURIComponent(paperId)}/judgments/${encodeURIComponent(defectId)}`,
    { method: "DELETE" }
  );
  if (!res.ok) throw new Error(`deleteJudgment failed: ${await res.text()}`);
}

export type JudgmentRuleStat = {
  rule_id: string;
  total: number;
  correct: number;
  wrong: number;
  partial: number;
  precision: number | null;
};

export type JudgmentSummary = {
  by_rule: JudgmentRuleStat[];
  total: {
    total: number;
    correct: number;
    wrong: number;
    partial: number;
    precision: number | null;
  };
};

export async function fetchJudgmentSummary(): Promise<JudgmentSummary> {
  return get<JudgmentSummary>("/api/judgments/summary");
}

// ---------- Rule firing stats ----------

export type RuleStatRow = {
  rule_id: string;
  name: string;
  defect_label: string;
  papers_fired: number;
  total_defects: number;
  judged_total: number;
  judged_correct: number;
  judged_wrong: number;
  judged_partial: number;
  precision: number | null;
};

export type RulesStats = {
  papers_analyzed: number;
  items: RuleStatRow[];
};

export async function fetchRuleStats(): Promise<RulesStats> {
  return get<RulesStats>("/api/rules/stats");
}

// ---------- Evaluation (LLM vs Human-as-judge) ----------

export type EvalBucket = {
  total: number;
  correct: number;
  wrong: number;
  partial: number;
  soft_precision: number | null;
};

export type EvalSummary = {
  overall: EvalBucket;
  by_rule: (EvalBucket & { rule_id: string })[];
  by_severity: (EvalBucket & { severity: string })[];
  by_confidence: (EvalBucket & { bucket: string })[];
  orphan_judgments: number;
};

export async function fetchEvalSummary(): Promise<EvalSummary> {
  return get<EvalSummary>("/api/eval/summary");
}

export type JudgmentExport = {
  exported_at: string;
  total_judgments: number;
  items: {
    paper_id: string;
    paper_title: string | null;
    defect_id: string;
    rule_id: string;
    verdict: "correct" | "wrong" | "partial";
    note: string | null;
    judged_at: string;
    defect: {
      id: string;
      rule_id: string;
      defect_type: string;
      severity: string;
      section: string;
      confidence: number | null;
      description: string;
      suggestion: string;
      evidence_edu_ids: string[];
      evidence_texts: string[];
    };
  }[];
};

export async function fetchJudgmentExport(): Promise<JudgmentExport> {
  return get<JudgmentExport>("/api/judgments/export");
}

// ---------- Paper-scoped chat ----------

export type ChatRole = "user" | "assistant";

export type ChatMessage = {
  role: ChatRole;
  content: string;
};

export type ChatResponse = {
  reply: string;
  cost_usd: number;
  cited_edu_ids: string[];
  cited_defect_ids: string[];
  model: string;
};

export class ChatRateLimitError extends Error {
  retryAfter: number;
  constructor(message: string, retryAfter: number) {
    super(message);
    this.name = "ChatRateLimitError";
    this.retryAfter = retryAfter;
  }
}

export async function sendChat(
  paperId: string,
  messages: ChatMessage[],
  lang?: string
): Promise<ChatResponse> {
  const res = await fetch(
    `${API_BASE}/api/papers/${encodeURIComponent(paperId)}/chat`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, lang }),
    }
  );
  if (res.status === 429) {
    const text = await res.text();
    const m = text.match(/~(\d+)s/);
    const wait = m ? Number(m[1]) : 30;
    throw new ChatRateLimitError(text, wait);
  }
  if (!res.ok) throw new Error(`chat failed: ${res.status} ${await res.text()}`);
  return res.json();
}

// ---------- editor mode: writing documents ----------

// TipTap/ProseMirror serialized document. Kept structurally opaque here so the
// API layer doesn't depend on the editor library; the editor casts it to its
// own JSONContent type.
export type ProseMirrorDoc = Record<string, unknown>;

export type EditorDoc = {
  doc_id: string;
  title: string;
  content_json: ProseMirrorDoc;
  locale: string;
  created_at: string;
  updated_at: string;
};

// List view omits the heavy content blob.
export type EditorDocListItem = Omit<EditorDoc, "content_json">;

export type DocumentVersion = {
  id: number;
  label: string;
  created_at: string;
};

export async function listDocuments(): Promise<EditorDocListItem[]> {
  return get<EditorDocListItem[]>("/api/editor/documents");
}

export async function createDocument(body: {
  title?: string;
  locale: string;
  content_json?: ProseMirrorDoc;
}): Promise<EditorDoc> {
  const res = await fetch(`${API_BASE}/api/editor/documents`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`createDocument failed: ${await res.text()}`);
  return res.json();
}

export async function fetchDocument(docId: string): Promise<EditorDoc> {
  return get<EditorDoc>(`/api/editor/documents/${encodeURIComponent(docId)}`);
}

export async function updateDocument(
  docId: string,
  body: { title?: string; content_json?: ProseMirrorDoc }
): Promise<void> {
  const res = await fetch(
    `${API_BASE}/api/editor/documents/${encodeURIComponent(docId)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  if (!res.ok) throw new Error(`updateDocument failed: ${await res.text()}`);
}

export async function deleteDocument(docId: string): Promise<void> {
  const res = await fetch(
    `${API_BASE}/api/editor/documents/${encodeURIComponent(docId)}`,
    { method: "DELETE" }
  );
  if (!res.ok) throw new Error(`deleteDocument failed: ${await res.text()}`);
}

export async function snapshotDocument(
  docId: string,
  content_json: ProseMirrorDoc,
  label = "autosave"
): Promise<{ version_id: number }> {
  const res = await fetch(
    `${API_BASE}/api/editor/documents/${encodeURIComponent(docId)}/versions`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content_json, label }),
    }
  );
  if (!res.ok) throw new Error(`snapshotDocument failed: ${await res.text()}`);
  return res.json();
}

export async function listDocumentVersions(
  docId: string
): Promise<DocumentVersion[]> {
  return get<DocumentVersion[]>(
    `/api/editor/documents/${encodeURIComponent(docId)}/versions`
  );
}

// ---------- editor mode: AI autocomplete (SSE) ----------

export type AutocompleteRequest = {
  doc_id: string;
  text_before: string;
  title: string;
  outline: string;
  locale: string;
};

/**
 * Stream an inline writing suggestion. Calls `onDelta` for each token as it
 * arrives. Pass an AbortSignal to cancel an in-flight request (the caller does
 * this on every keystroke). A 429 (rate limit) resolves silently — autocomplete
 * is best-effort and should never interrupt the writer. AbortError is swallowed.
 */
export async function streamAutocomplete(
  body: AutocompleteRequest,
  onDelta: (text: string) => void,
  signal: AbortSignal
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/editor/autocomplete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return;
    throw e;
  }
  if (res.status === 429) return; // rate-limited: skip this suggestion silently
  if (!res.ok || !res.body) {
    throw new Error(`autocomplete failed: ${res.status} ${await res.text()}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // SSE events are separated by a blank line.
      const events = buffer.split("\n\n");
      buffer = events.pop() ?? "";
      for (const evt of events) {
        const line = evt.trim();
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") return;
        try {
          const parsed = JSON.parse(data) as { t?: string; error?: string };
          if (parsed.t) onDelta(parsed.t);
        } catch {
          // ignore malformed chunk
        }
      }
    }
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return;
    throw e;
  }
}

// ---------- editor mode: AI rewrite (highlight → rewrite menu) ----------

export type RewriteRequest = {
  doc_id: string;
  text: string; // the selected passage
  instruction: string; // a preset key (paraphrase, simplify, …) or custom directive
  locale: string;
};

/**
 * Stream an AI rewrite of a selected passage. Calls `onDelta` for each token.
 * Pass an AbortSignal to cancel (e.g. when retrying or closing the menu). A 429
 * throws ChatRateLimitError so the caller can show a retry hint; AbortError is
 * swallowed.
 */
export async function streamRewrite(
  body: RewriteRequest,
  onDelta: (text: string) => void,
  signal: AbortSignal
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/editor/rewrite`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return;
    throw e;
  }
  if (res.status === 429) {
    const text = await res.text();
    const m = text.match(/~(\d+)s/);
    throw new ChatRateLimitError(text, m ? Number(m[1]) : 30);
  }
  if (!res.ok || !res.body) {
    throw new Error(`rewrite failed: ${res.status} ${await res.text()}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop() ?? "";
      for (const evt of events) {
        const line = evt.trim();
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") return;
        let parsed: { t?: string; error?: string };
        try {
          parsed = JSON.parse(data);
        } catch {
          continue; // ignore malformed chunk
        }
        if (parsed.error) throw new Error(parsed.error);
        if (parsed.t) onDelta(parsed.t);
      }
    }
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return;
    throw e;
  }
}

// ---------- editor mode: Smart Citation (OpenAlex) ----------

// Flat candidate shape returned by /api/editor/citations/recommend, in
// OpenAlex's own relevance order (no rerank in this slice). snake_case to match
// the backend payload verbatim.
export type CitationCandidate = {
  openalex_id: string;
  title: string;
  authors: string[];
  year: number | null;
  venue: string;
  doi: string;
  oa_url: string; // open-access full text — most useful, but can rot ("" if none)
  url: string; // always-resolvable source link (OA full text → DOI → … )
  cited_by_count: number;
  type: string;
  abstract: string;
  relevance_score: number | null;
};

/**
 * Recommend citation candidates (OpenAlex) for a selected claim sentence. A 429
 * surfaces as ChatRateLimitError so the caller can show a retry hint. Pass an
 * AbortSignal to cancel a superseded search, and `yearFrom` to filter by recency.
 */
export async function recommendCitations(
  docId: string,
  claim: string,
  opts: { signal?: AbortSignal; yearFrom?: number } = {}
): Promise<CitationCandidate[]> {
  const res = await fetch(`${API_BASE}/api/editor/citations/recommend`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      doc_id: docId,
      claim,
      year_from: opts.yearFrom ?? null,
    }),
    signal: opts.signal,
  });
  if (res.status === 429) {
    const text = await res.text();
    const m = text.match(/~(\d+)s/);
    throw new ChatRateLimitError(text, m ? Number(m[1]) : 30);
  }
  if (!res.ok) {
    throw new Error(`recommendCitations failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { candidates: CitationCandidate[] };
  return data.candidates;
}

/**
 * Re-fetch citations by OpenAlex id to refresh stale metadata (chiefly links
 * that have rotted). Returns a map keyed by openalex_id; ids OpenAlex no longer
 * knows are absent, so the caller leaves those citations untouched.
 */
export async function refreshCitations(
  openalexIds: string[]
): Promise<Record<string, CitationCandidate>> {
  const res = await fetch(`${API_BASE}/api/editor/citations/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ openalex_ids: openalexIds }),
  });
  if (!res.ok) {
    throw new Error(`refreshCitations failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as {
    citations: Record<string, CitationCandidate>;
  };
  return data.citations;
}
