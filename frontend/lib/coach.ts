import type { WritingAssessment } from "./api";

export interface Source {
  source_id: string; title: string; excerpt: string; source_type: string;
  source_link?: string; url?: string; recorded_at?: string; page?: number;
  number?: number;
  provenance?: string; license_type?: string;
}
export interface KnowledgeItem {
  id: string; title: string; content: string; note?: string; category: string;
  module: string; source_summary?: string; status: string; source_link: string;
  merged_records?: Record<string, { title: string; content: string; source_link: string; source_summary?: string; note?: string }>;
}
export interface Issue { id: string; criterion: string; quote: string; explanation: string; goal: string; source_ids: string[] }
export interface Feedback {
  mode: string; generated_at: string; model: string;
  citations?: Source[];
  data: { assessment: WritingAssessment; issues: Issue[];
    improvements: { issue_id: string; status: string; old_quote: string; new_quote: string; explanation: string }[];
    personal_note: string; personal_source_ids: string[] };
}
export interface WritingVersion { id: string; created_at: string; essay: string; status: string; feedback: Feedback | null }
export interface WritingSession { id: string; prompt: string; versions?: WritingVersion[] }
export interface Answer { answer: string; citations: Source[]; mode: string; conversation_id?: string; generated_at?: string }
export interface Conversation { id: string; parent_id?: string; messages: (Answer & { query: string })[]; scope?: { source_type: string; document_ids: string[] } }
export interface Demo {
  prompt: string; knowledge: { title: string; content: string; category: string }[];
  versions: { essay: string; issues: { title: string; quote: string; text: string; source: string }[]; hints: string[] }[];
  answer: string; citations: Source[];
}

async function call<T>(token: string, path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? "/api/v1"}${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: response.statusText }));
    throw new Error(typeof error.detail === "string" ? error.detail : "请求失败，请重试");
  }
  return response.status === 204 ? undefined as T : response.json();
}
export const coach = {
  legacyAssessment: (t: string, id: string) => call<{ submission: { task_type: string; prompt: string; essay: string }; assessment: WritingAssessment }>(t, `/writing/assessments/${id}`),
  vocabularyReview: (t: string, id: string) => call<{ word: string; selected: string; meaning: string; correct: boolean }[]>(t, `/vocabulary/tests/${id}/review`),
  items: (t: string) => call<KnowledgeItem[]>(t, "/knowledge/items"),
  backfill: (t: string) => call(t, "/knowledge/backfill", "POST"),
  edit: (t: string, id: string, body: { title: string; note: string }) => call(t, `/knowledge/items/${id}`, "PATCH", body),
  remove: (t: string, id: string) => call(t, `/knowledge/items/${id}`, "DELETE"),
  merge: (t: string, id: string, ids: string[]) => call(t, `/knowledge/items/${id}/merge`, "POST", { source_ids: ids }),
  ask: (t: string, query: string, options: { source_type?: string; document_ids?: string[]; conversation_id?: string } = {}) => call<Answer>(t, "/rag/query", "POST", { query, ...options }),
  conversations: (t: string) => call<Conversation[]>(t, "/knowledge/conversations"),
  sessions: (t: string) => call<WritingSession[]>(t, "/writing/sessions"),
  create: (t: string, prompt: string) => call<WritingSession>(t, "/writing/sessions", "POST", { prompt }),
  session: (t: string, id: string) => call<WritingSession>(t, `/writing/sessions/${id}`),
  submit: (t: string, id: string, essay: string) => call<WritingVersion>(t, `/writing/sessions/${id}/versions`, "POST", { essay }),
  assess: (t: string, id: string) => call<WritingVersion>(t, `/writing/versions/${id}/assess`, "POST"),
  hint: (t: string, id: string, issue: string, level: number) => call<{ data: { text: string }; mode: string }>(t, `/writing/versions/${id}/issues/${encodeURIComponent(issue)}/hints/${level}`, "POST"),
  askWriting: (t: string, id: string, query: string) => call<Answer>(t, `/writing/versions/${id}/questions`, "POST", { query }),
  demo: (t: string) => call<Demo>(t, "/coach/demo"),
};
