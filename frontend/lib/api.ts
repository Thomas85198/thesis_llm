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
};

export type AnalysisResult = {
  paper_id: string;
  graph: PaperGraph;
  defects: Defect[];
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
