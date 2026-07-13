// Browser fetches use NEXT_PUBLIC_API_BASE (baked in at build time).
// SSR fetches run inside the Next.js container, where `localhost` is the
// frontend itself — use API_INTERNAL_BASE (compose network hostname) instead.
const API_BASE =
  typeof window === "undefined"
    ? (process.env.API_INTERNAL_BASE ??
      process.env.NEXT_PUBLIC_API_BASE ??
      "http://localhost:8000")
    : (process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000");

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
  locale: string,
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

export type JobStatus = "queued" | "extracting" | "checking" | "done" | "error";

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
  title: string; // 顯示用：使用者填的 title，沒填 fallback 到 filename
  filename: string; // 原始檔名（永遠記錄）
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

export async function fetchPaperResult(
  paperId: string,
): Promise<AnalysisResult> {
  return get<AnalysisResult>(
    `/api/papers/${encodeURIComponent(paperId)}/result`,
  );
}

export async function fetchJob(jobId: string): Promise<Job> {
  return get<Job>(`/api/jobs/${encodeURIComponent(jobId)}`);
}

export async function uploadPaper(
  file: File,
  title?: string,
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
    { method: "DELETE" },
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
    `/api/papers/${encodeURIComponent(paperId)}/judgments`,
  );
}

export async function submitJudgment(
  paperId: string,
  body: { defect_id: string; rule_id: string; verdict: Verdict; note?: string },
): Promise<void> {
  const res = await fetch(
    `${API_BASE}/api/papers/${encodeURIComponent(paperId)}/judgments`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) throw new Error(`submitJudgment failed: ${await res.text()}`);
}

export async function deleteJudgment(
  paperId: string,
  defectId: string,
): Promise<void> {
  const res = await fetch(
    `${API_BASE}/api/papers/${encodeURIComponent(paperId)}/judgments/${encodeURIComponent(defectId)}`,
    { method: "DELETE" },
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
  lang?: string,
): Promise<ChatResponse> {
  const res = await fetch(
    `${API_BASE}/api/papers/${encodeURIComponent(paperId)}/chat`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, lang }),
    },
  );
  if (res.status === 429) {
    const text = await res.text();
    const m = text.match(/~(\d+)s/);
    const wait = m ? Number(m[1]) : 30;
    throw new ChatRateLimitError(text, wait);
  }
  if (!res.ok)
    throw new Error(`chat failed: ${res.status} ${await res.text()}`);
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

export type RelinkStats = {
  references: number;
  academic: number;
  matched: number;
  intext_linked: number;
};

/**
 * High-confidence citation relinking for an imported paper: parse the reference
 * list, match each on OpenAlex (kept only on a strong title match), and replace
 * in-text (Author, year) markers with live citation nodes. Heavy (LLM + OpenAlex
 * + embeddings) — can take a minute. Returns the rewritten doc + stats.
 */
export async function relinkCitations(
  docId: string,
  content_json: ProseMirrorDoc,
): Promise<{ content_json: ProseMirrorDoc; stats: RelinkStats }> {
  const res = await fetch(`${API_BASE}/api/editor/citations/relink`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ doc_id: docId, content_json }),
  });
  if (!res.ok) {
    throw new Error(
      `relinkCitations failed: ${res.status} ${await res.text()}`,
    );
  }
  return res.json();
}

export type ImportResult = { title: string; content_json: ProseMirrorDoc };

// PDF 匯入走後端背景 job（掃描檔要跑 OCR，數分鐘），其餘格式同步回結果。
export type ImportResponse =
  | ImportResult
  | { job_id: string; status: "processing" };

export type ImportJobStatus =
  | { status: "processing"; stage: "parse" | "ocr" }
  | ({ status: "done" } & ImportResult)
  | { status: "error"; detail: string };

/**
 * Parse an uploaded .txt / .md / .docx / .tex / .pdf file into editor
 * (ProseMirror) JSON server-side. Non-PDF formats return the detected title and
 * content synchronously; PDFs return a job_id to poll via fetchImportJob (the
 * scanned-PDF OCR path takes minutes). Embedded images are saved server-side
 * and referenced by figure nodes, so they render and re-export like any
 * uploaded image.
 */
export async function importDocument(file: File): Promise<ImportResponse> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API_BASE}/api/editor/import`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    throw new Error(`importDocument failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

export async function fetchImportJob(jobId: string): Promise<ImportJobStatus> {
  return get<ImportJobStatus>(
    `/api/editor/import/jobs/${encodeURIComponent(jobId)}`,
  );
}

/** Thrown when a PUT is rejected because the document was modified elsewhere
 * (optimistic-concurrency 409). Carries the server's current updated_at. */
export class DocumentConflictError extends Error {
  serverUpdatedAt?: string;
  constructor(serverUpdatedAt?: string) {
    super("document changed elsewhere");
    this.name = "DocumentConflictError";
    this.serverUpdatedAt = serverUpdatedAt;
  }
}

export async function updateDocument(
  docId: string,
  body: {
    title?: string;
    content_json?: ProseMirrorDoc;
    expected_updated_at?: string | null;
  },
): Promise<{ updated_at?: string }> {
  const res = await fetch(
    `${API_BASE}/api/editor/documents/${encodeURIComponent(docId)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (res.status === 409) {
    let serverTs: string | undefined;
    try {
      serverTs = (await res.json())?.detail?.updated_at;
    } catch {
      /* ignore */
    }
    throw new DocumentConflictError(serverTs);
  }
  if (!res.ok) throw new Error(`updateDocument failed: ${await res.text()}`);
  return res.json().catch(() => ({}));
}

export async function deleteDocument(docId: string): Promise<void> {
  const res = await fetch(
    `${API_BASE}/api/editor/documents/${encodeURIComponent(docId)}`,
    { method: "DELETE" },
  );
  if (!res.ok) throw new Error(`deleteDocument failed: ${await res.text()}`);
}

export async function snapshotDocument(
  docId: string,
  content_json: ProseMirrorDoc,
  label = "autosave",
): Promise<{ version_id: number }> {
  const res = await fetch(
    `${API_BASE}/api/editor/documents/${encodeURIComponent(docId)}/versions`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content_json, label }),
    },
  );
  if (!res.ok) throw new Error(`snapshotDocument failed: ${await res.text()}`);
  return res.json();
}

export async function listDocumentVersions(
  docId: string,
): Promise<DocumentVersion[]> {
  return get<DocumentVersion[]>(
    `/api/editor/documents/${encodeURIComponent(docId)}/versions`,
  );
}

export async function getDocumentVersion(
  docId: string,
  versionId: number,
): Promise<DocumentVersion & { doc_id: string; content_json: ProseMirrorDoc }> {
  return get(
    `/api/editor/documents/${encodeURIComponent(docId)}/versions/${versionId}`,
  );
}

/** Restore a document to a past version (server snapshots the current state as
 * 'restore-backup' first). Returns the restored content for the editor. */
export async function restoreDocumentVersion(
  docId: string,
  versionId: number,
): Promise<{ content_json: ProseMirrorDoc }> {
  const res = await fetch(
    `${API_BASE}/api/editor/documents/${encodeURIComponent(docId)}/restore/${versionId}`,
    { method: "POST" },
  );
  if (!res.ok)
    throw new Error(`restoreDocumentVersion failed: ${await res.text()}`);
  return res.json();
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
  signal: AbortSignal,
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
  signal: AbortSignal,
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

// ---------- editor mode: defect check (Thesis Critic on the draft) ----------

export type DraftDefect = {
  rule_id: string;
  defect_type: string;
  severity: string; // high | medium | low
  section: string;
  description: string;
  suggestion: string;
  confidence: number | null;
  evidence: string[]; // the EDU sentences the defect cites
};

/**
 * Run the Thesis Critic's single-section REL rules on the draft text and return
 * structural defects. Heavy (several LLM calls); a 429 throws ChatRateLimitError.
 */
export async function checkDraft(
  docId: string,
  // A single passage (selection) or the doc split into sections (per-section
  // incremental caching — only changed sections re-run the LLM).
  payload: { text: string } | { sections: string[] },
  locale: string,
  signal?: AbortSignal,
): Promise<DraftDefect[]> {
  const res = await fetch(`${API_BASE}/api/editor/check`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ doc_id: docId, ...payload, locale }),
    signal,
  });
  if (res.status === 429) {
    const t = await res.text();
    const m = t.match(/~(\d+)s/);
    throw new ChatRateLimitError(t, m ? Number(m[1]) : 30);
  }
  if (!res.ok) {
    throw new Error(`checkDraft failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { defects: DraftDefect[] };
  return data.defects;
}

// Deep check: whole-draft graph + cross-section rules. Returns the editor-shaped
// defects (for the defect panel) AND the full AnalysisResult, so the editor can
// render the SAME rich KGFlow knowledge-graph view as the paper-analysis page.
export async function deepCheckDraft(
  docId: string,
  sections: string[],
  locale: string,
  signal?: AbortSignal,
): Promise<{ defects: DraftDefect[]; result: AnalysisResult | null }> {
  const res = await fetch(`${API_BASE}/api/editor/check`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ doc_id: docId, sections, locale, full: true }),
    signal,
  });
  if (res.status === 429) {
    const t = await res.text();
    const m = t.match(/~(\d+)s/);
    throw new ChatRateLimitError(t, m ? Number(m[1]) : 30);
  }
  if (!res.ok)
    throw new Error(`deepCheckDraft failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as {
    defects: DraftDefect[];
    result: AnalysisResult | null;
  };
}

// ---------- editor mode: image upload ----------

/**
 * Upload an image for the editor; returns an absolute URL to embed in a figure
 * node. The backend returns a relative serve path which we resolve against the
 * API base (images load cross-origin in the browser).
 */
export async function uploadImage(file: File): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API_BASE}/api/editor/upload`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    throw new Error(`uploadImage failed: ${res.status} ${await res.text()}`);
  }
  const { url } = (await res.json()) as { url: string };
  return `${API_BASE}${url}`;
}

// ---------- editor mode: export (DOCX / LaTeX) ----------

// "latex" may come back as a .zip when figures exist; "pdf" is compiled
// server-side with XeLaTeX (thesis-grade typesetting).
export type ExportFormat = "docx" | "latex" | "pdf" | "md" | "txt" | "html";

/**
 * Render the live document to a .docx or .tex file and return it as a Blob. The
 * content is sent directly (not read from the DB) so the export reflects the
 * latest edits even within the autosave debounce.
 */
export async function exportDocument(body: {
  title: string;
  content_json: ProseMirrorDoc;
  style: string; // citation style
  locale: string;
  format: ExportFormat;
  template?: string; // LaTeX only: article | twocolumn | ieee | twthesis
  cover?: Record<string, string>; // twthesis bilingual title page (optional)
}): Promise<{ blob: Blob; filename: string }> {
  const res = await fetch(`${API_BASE}/api/editor/export`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`exportDocument failed: ${res.status} ${await res.text()}`);
  }
  // The backend's real extension may differ from `format` (LaTeX with figures
  // is returned as a .zip), so honor the Content-Disposition filename.
  const cd = res.headers.get("Content-Disposition") || "";
  let filename = "";
  const star = cd.match(/filename\*=UTF-8''([^;]+)/i);
  if (star) filename = decodeURIComponent(star[1]);
  else {
    const m = cd.match(/filename="?([^";]+)"?/i);
    if (m) filename = m[1];
  }
  return { blob: await res.blob(), filename };
}

// ---------- editor mode: outline generation ----------

export type OutlineHeading = { level: number; text: string };

/**
 * Generate a thesis outline (heading tree) from a topic. A 429 throws
 * ChatRateLimitError so the caller can show a retry hint.
 */
export async function generateOutline(
  docId: string,
  topic: string,
  locale: string,
): Promise<OutlineHeading[]> {
  const res = await fetch(`${API_BASE}/api/editor/outline`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ doc_id: docId, topic, locale }),
  });
  if (res.status === 429) {
    const text = await res.text();
    const m = text.match(/~(\d+)s/);
    throw new ChatRateLimitError(text, m ? Number(m[1]) : 30);
  }
  if (!res.ok) {
    throw new Error(
      `generateOutline failed: ${res.status} ${await res.text()}`,
    );
  }
  const data = (await res.json()) as { headings: OutlineHeading[] };
  return data.headings;
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
  similarity?: number; // claim↔abstract semantic similarity (0–1), set by rerank
};

/**
 * Recommend citation candidates (OpenAlex) for a selected claim sentence. A 429
 * surfaces as ChatRateLimitError so the caller can show a retry hint. Pass an
 * AbortSignal to cancel a superseded search, and `yearFrom` to filter by recency.
 */
export type CitationLang = "all" | "en" | "zh";

export async function recommendCitations(
  docId: string,
  claim: string,
  opts: { signal?: AbortSignal; yearFrom?: number; lang?: CitationLang } = {},
): Promise<CitationCandidate[]> {
  const res = await fetch(`${API_BASE}/api/editor/citations/recommend`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      doc_id: docId,
      claim,
      year_from: opts.yearFrom ?? null,
      lang: opts.lang ?? "all",
    }),
    signal: opts.signal,
  });
  if (res.status === 429) {
    const text = await res.text();
    const m = text.match(/~(\d+)s/);
    throw new ChatRateLimitError(text, m ? Number(m[1]) : 30);
  }
  if (!res.ok) {
    throw new Error(
      `recommendCitations failed: ${res.status} ${await res.text()}`,
    );
  }
  const data = (await res.json()) as { candidates: CitationCandidate[] };
  return data.candidates;
}

/**
 * Resolve a DOI (or a URL containing one) to a citation candidate via Crossref —
 * the free manual fallback when OpenAlex search is rate-limited or a work isn't
 * indexed. Returns null when the input has no DOI or the DOI is unknown (404).
 */
export async function resolveDoi(
  doi: string,
): Promise<CitationCandidate | null> {
  const res = await fetch(`${API_BASE}/api/editor/citations/resolve-doi`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ doi }),
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`resolveDoi failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { candidate: CitationCandidate };
  return data.candidate;
}

// Claim–evidence verdict: does a cited source actually support the claim?
export type CitationVerdict = {
  verdict: "supports" | "partial" | "unsupported" | "unknown";
  evidence: string; // supporting sentence from the abstract ("" if none)
  reason: string;
  confidence: number;
};

/**
 * Verify whether a candidate source supports a claim (the "traffic light"). The
 * abstract is sent from the candidate already on the client — no extra fetch. A
 * 429 throws ChatRateLimitError.
 */
export async function verifyCitation(
  docId: string,
  claim: string,
  title: string,
  abstract: string,
  locale: string,
  openalexId?: string,
): Promise<CitationVerdict> {
  const res = await fetch(`${API_BASE}/api/editor/citations/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      doc_id: docId,
      claim,
      title,
      abstract,
      locale,
      openalex_id: openalexId ?? null,
    }),
  });
  if (res.status === 429) {
    const text = await res.text();
    const m = text.match(/~(\d+)s/);
    throw new ChatRateLimitError(text, m ? Number(m[1]) : 30);
  }
  if (!res.ok) {
    throw new Error(`verifyCitation failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as CitationVerdict;
}

// Full-text grounding: the source sentences that best support a claim.
export type GroundResult = {
  source: "fulltext" | "abstract" | "none";
  supporting: { sentence: string; score: number }[];
};

/**
 * Ground a citation: fetch the source's full text and return the sentences that
 * best match the claim. Falls back to the abstract when no OA full text. A 429
 * throws ChatRateLimitError.
 */
export async function groundCitation(
  docId: string,
  openalexId: string,
  oaUrl: string,
  claim: string,
): Promise<GroundResult> {
  const res = await fetch(`${API_BASE}/api/editor/citations/ground`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      doc_id: docId,
      openalex_id: openalexId,
      oa_url: oaUrl,
      claim,
    }),
  });
  if (res.status === 429) {
    const t = await res.text();
    const m = t.match(/~(\d+)s/);
    throw new ChatRateLimitError(t, m ? Number(m[1]) : 30);
  }
  if (!res.ok) {
    throw new Error(`groundCitation failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as GroundResult;
}

/**
 * Re-fetch citations by OpenAlex id to refresh stale metadata (chiefly links
 * that have rotted). Returns a map keyed by openalex_id; ids OpenAlex no longer
 * knows are absent, so the caller leaves those citations untouched.
 */
export async function refreshCitations(
  openalexIds: string[],
): Promise<Record<string, CitationCandidate>> {
  const res = await fetch(`${API_BASE}/api/editor/citations/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ openalex_ids: openalexIds }),
  });
  if (!res.ok) {
    throw new Error(
      `refreshCitations failed: ${res.status} ${await res.text()}`,
    );
  }
  const data = (await res.json()) as {
    citations: Record<string, CitationCandidate>;
  };
  return data.citations;
}

// ---------- Admin: upload audit trail ----------

export type UploadEvent = {
  id: number;
  job_id: string;
  paper_id: string | null;
  filename: string | null;
  file_size: number | null;
  content_hash: string | null;
  status: "pending" | "done" | "error" | "cached";
  error_type: string | null;
  error_stage: string | null;
  error_message: string | null;
  pdf_path: string | null;
  created_at: string;
  finished_at: string | null;
};

// Thrown so the admin page can distinguish "wrong token" (re-prompt) and
// "admin disabled" (ADMIN_TOKEN unset on the server) from generic errors.
export class AdminAuthError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "AdminAuthError";
  }
}

export async function fetchAdminUploads(
  token: string,
  status?: string,
  limit = 200,
): Promise<UploadEvent[]> {
  const qs = new URLSearchParams({ limit: String(limit) });
  if (status) qs.set("status", status);
  const res = await fetch(`${API_BASE}/api/admin/uploads?${qs.toString()}`, {
    cache: "no-store",
    headers: { "X-Admin-Token": token },
  });
  if (res.status === 401 || res.status === 503) {
    throw new AdminAuthError(res.status, await res.text());
  }
  if (!res.ok)
    throw new Error(`admin/uploads → ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { items: UploadEvent[] };
  return data.items;
}

// Download the original uploaded file via fetch+blob so the admin token rides
// in a header (not the URL). Triggers a browser download client-side.
export async function downloadAdminUploadFile(
  token: string,
  event: UploadEvent,
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/admin/uploads/${event.id}/file`, {
    headers: { "X-Admin-Token": token },
  });
  if (!res.ok) throw new Error(`download → ${res.status} ${await res.text()}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = event.filename || `${event.job_id}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
