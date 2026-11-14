import { localizeError, translate } from "./i18n";

export interface WordSource {
  reason: "spelling" | "usage" | "accumulate"; original_form: string; original_quote: string;
  explanation: string; example: string; source_link: string; source_id: string; job_id: string;
}
export interface WordCard {
  word: string; meaning: string; phonetic: string; part_of_speech: string; example: string; note: string;
  personal: boolean; sources: WordSource[]; status: string; due_at: string | null;
  interval_days: number; review_count: number; revision: number; suspended: boolean;
  legacy_source?: string;
}
export interface Deck {
  items: WordCard[]; total: number; offset: number;
  counts: { total: number; starter: number; personal: number; due: number; new: number; learned: number; suspended: number };
}
export interface ExtractionJob {
  id: string; status: "queued" | "running" | "completed" | "unavailable" | "failed";
  request_type: "automatic" | "requested";
  words: { word: string; meaning: string; reason: string; original_form: string; original_quote: string; explanation: string; example: string }[];
}
export type SourceKind = "writing_version" | "assessment";
export class VocabularyRequestError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
async function request<T>(token: string, path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? "/api/v1"}/vocabulary${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new VocabularyRequestError(response.status, response.status === 409 ? translate("error.cardChanged") : typeof error.detail === "string" ? localizeError(error.detail) : translate("error.save"));
  }
  return response.json();
}
export const vocabulary = {
  deck: (t: string, scope = "all", q = "", offset = 0) => request<Deck>(t, `/deck?${new URLSearchParams({ scope, q, offset: String(offset) })}`),
  study: (t: string, scope = "all") => request<{ items: WordCard[]; due_count: number; new_count: number }>(t, `/study?scope=${encodeURIComponent(scope)}`),
  review: (t: string, body: { word: string; rating: string; revision: number; event_id: string }) => request<WordCard>(t, "/reviews", "POST", body),
  edit: (t: string, body: { word: string; meaning?: string; example?: string; note?: string; suspended?: boolean }) => request<WordCard>(t, "/words", "PATCH", body),
  jobs: (t: string, id: string, kind: SourceKind) => request<ExtractionJob[]>(t, `/extractions?${new URLSearchParams({ source_id: id, source_kind: kind })}`),
  extract: (t: string, id: string, kind: SourceKind, type: "requested" | "automatic" = "requested") => request<ExtractionJob>(t, "/extractions", "POST", { source_id: id, source_kind: kind, request_type: type }),
};
