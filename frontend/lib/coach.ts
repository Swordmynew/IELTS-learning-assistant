import type { WritingAssessment } from "./api";
import { localizeError, translate } from "./i18n";

export interface Source {
  source_id: string; title: string; excerpt: string; source_type: string;
  source_link?: string; url?: string; recorded_at?: string; page?: number;
  number?: number;
  provenance?: string; license_type?: string; topic_tags?: string[]; match_reasons?: string[]; memory_status?: string;
}
export interface KnowledgeItem {
  id: string; title: string; content: string; note?: string; category: string;
  module: string; source_summary?: string; status: string; source_link: string;
  source_kind?: string; source_url?: string; topic_tags?: string[]; related_ids?: string[];
  state_source?: string; practice_count?: number; mistake_count?: number; last_practiced_at?: string;
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
export interface WritingVersion { id: string; created_at: string; essay: string; status: string; feedback: Feedback | null; failure_reason?: string; failure_message?: string }
export interface WritingSession { id: string; prompt: string; versions?: WritingVersion[] }
export interface KnowledgeDraft {
  title: string; content: string; note: string; module: string; topic_tags: string[]; related_ids: string[]; source_url?: string | null; request_id: string;
}
export interface BookmarkSource { source_type: "question" | "writing_version" | "conversation" | "document"; source_id: string; message_index?: number; chunk_id?: string }
export interface MemoryEvent { id: string; event_type: string; occurred_at: string; title: string; content: string; status: string; provenance: string }
export interface KnowledgeTopics { presets: { id: string; label: string }[]; items: { id: string; label: string; item_ids: string[]; note_count: number; unresolved_count: number; mistake_count: number }[] }
export interface Answer { answer: string; citations: Source[]; mode: string; conversation_id?: string; generated_at?: string; context_stale?: boolean; failure_reason?: string | null; system_message_key?: string | null; generation_mode?: string | null; retrieved_sources?: Source[] }
export interface Conversation { id: string; parent_id?: string; messages: (Answer & { query: string })[]; scope?: { source_type: string; document_ids: string[]; topic_tags?: string[] } }
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
    throw new Error(typeof error.detail === "string" ? localizeError(error.detail) : translate("error.request"));
  }
  return response.status === 204 ? undefined as T : response.json();
}
export const coach = {
  legacyAssessment: (t: string, id: string) => call<{ submission: { task_type: string; prompt: string; essay: string }; assessment: WritingAssessment }>(t, `/writing/assessments/${id}`),
  vocabularyReview: (t: string, id: string) => call<{ word: string; selected: string; meaning: string; correct: boolean }[]>(t, `/vocabulary/tests/${id}/review`),
  items: (t: string) => call<KnowledgeItem[]>(t, "/knowledge/items"),
  topics: (t: string) => call<KnowledgeTopics>(t, "/knowledge/topics"),
  createNote: (t: string, body: KnowledgeDraft) => call<KnowledgeItem>(t, "/knowledge/items", "POST", body),
  bookmark: (t: string, body: BookmarkSource & { title: string; excerpt: string; note: string; topic_tags: string[]; related_ids: string[] }) => call<KnowledgeItem>(t, "/knowledge/bookmarks", "POST", body),
  events: (t: string, id: string) => call<MemoryEvent[]>(t, `/knowledge/items/${id}/events`),
  review: (t: string, id: string, body: { outcome: string; note: string; request_id: string }) => call<KnowledgeItem>(t, `/knowledge/items/${id}/reviews`, "POST", body),
  preview: (t: string, query: string, options: { source_type?: string; topic_tags?: string[] } = {}) => call<{ citations: Source[]; embedding_model: string; generated: false }>(t, "/rag/preview", "POST", { query, ...options }),
  backfill: (t: string) => call(t, "/knowledge/backfill", "POST"),
  edit: (t: string, id: string, body: Partial<Omit<KnowledgeDraft, "module" | "request_id">>) => call(t, `/knowledge/items/${id}`, "PATCH", body),
  remove: (t: string, id: string) => call(t, `/knowledge/items/${id}`, "DELETE"),
  merge: (t: string, id: string, ids: string[]) => call(t, `/knowledge/items/${id}/merge`, "POST", { source_ids: ids }),
  ask: (t: string, query: string, options: { source_type?: string; document_ids?: string[]; topic_tags?: string[]; conversation_id?: string } = {}) => call<Answer>(t, "/rag/query", "POST", { query, ...options }),
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
