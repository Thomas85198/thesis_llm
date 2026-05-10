const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";

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

export type Defect = {
  id: string;
  rule_id: string;
  defect_type: string;
  severity: Severity;
  section: SectionName;
  evidence_edu_ids: string[];
  description: string;
  suggestion: string;
  confidence?: number | null; // 0.0–1.0
};

export type RuleRunMeta = {
  rule_id: string;
  examples_used: number;
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
  title: string;
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
  messages: ChatMessage[]
): Promise<ChatResponse> {
  const res = await fetch(
    `${API_BASE}/api/papers/${encodeURIComponent(paperId)}/chat`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages }),
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
