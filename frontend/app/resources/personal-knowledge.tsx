"use client";

import { useI18n, localizeError } from "@/lib/i18n";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, GitMerge, Pencil, Plus, RefreshCw, Search, Trash2, X } from "lucide-react";
import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { coach, KnowledgeItem } from "@/lib/coach";
import { Sources, typeLabels } from "../coach-components";
import { TutorScope } from "../floating-tutor";
import { KnowledgeEditor, refreshMemory } from "./knowledge-editor";

const statusLabels: Record<string, string> = { saved: "ui.saved2", review: "ui.toReview2", remaining: "ui.needsMorePractice", correct_latest: "ui.latestAnswerCorrect", improved: "ui.improved", partial: "ui.partlyImproved" };

function MemoryHistory({ token, item }: { token: string; item: KnowledgeItem }) {
  const { t, formatDate } = useI18n();
  const [open, setOpen] = useState(false);
  const events = useQuery({ queryKey: ["memory-events", token, item.id], queryFn: () => coach.events(token, item.id), enabled: open });
  const labels: Record<string, string> = { capture: t("ui.savedExcerpt"), practice: t("ui.practiceResult"), self_review: t("ui.selfReview"), revision: t("ui.essayReassessment") };
  return <details className="memory-history" onToggle={event => setOpen(event.currentTarget.open)}><summary>{t("ui.learningHistory")}</summary>
    {events.isLoading ? <p>{t("common.loadingContent")}</p> : events.error ? <p className="error-text">{localizeError(events.error.message)}</p> : events.data?.length ? <ol>{events.data.map(event => <li key={event.id}><div><strong>{labels[event.event_type] ?? event.event_type}</strong><small>{formatDate(event.occurred_at, { dateStyle: "medium", timeStyle: "short" })}</small></div><span>{t(statusLabels[event.status] ?? event.status)}</span><p>{event.content}</p></li>)}</ol> : <p>{t("ui.noHistoryYet")}</p>}
  </details>;
}

function ReviewDialog({ token, item, onClose }: { token: string; item: KnowledgeItem; onClose: () => void }) {
  const { t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const client = useQueryClient();
  const requestId = useRef(crypto.randomUUID());
  const [outcome, setOutcome] = useState("review");
  const [note, setNote] = useState("");
  useEffect(() => { dialog.current?.showModal(); }, []);
  const save = useMutation({ mutationFn: () => coach.review(token, item.id, { outcome, note, request_id: requestId.current }), onSuccess: async () => { await refreshMemory(client); onClose(); } });
  return createPortal(<dialog ref={dialog} className="coach-edit-dialog" aria-label={t("ui.logAReview")} onCancel={event => { event.preventDefault(); if (!save.isPending) onClose(); }}><form className="panel coach-edit" onSubmit={event => { event.preventDefault(); save.mutate(); }}>
    <header className="coach-section-heading"><h3>{t("ui.recordYourSelfAssessment")}</h3><button type="button" aria-label={t("ui.closeReview")} className="coach-icon-button" onClick={onClose} disabled={save.isPending}><X size={18} /></button></header>
    <strong>{item.title}</strong><label className="field">{t("ui.afterThisPractice")}<select aria-label={t("ui.afterThisPractice")} value={outcome} onChange={event => setOutcome(event.target.value)}><option value="review">{t("ui.needsMorePractice2")}</option><option value="improved">{t("ui.understoodThisTime")}</option></select></label>
    <label className="field">{t("ui.practiceOrRevisionNotes")}<textarea aria-label={t("ui.practiceOrRevisionNotes")} value={note} onChange={event => setNote(event.target.value)} maxLength={4000} /></label>
    {save.error && <p role="alert" className="error-text">{localizeError(save.error.message)}</p>}<button className="primary-button" disabled={save.isPending}>{save.isPending ? t("ui.saving2") : t("ui.saveReview")}</button>
  </form></dialog>, document.body);
}

export function PersonalKnowledge({ token }: { token: string }) {
  const { t } = useI18n();
  const client = useQueryClient();
  const items = useQuery({ queryKey: ["personal-knowledge", token], queryFn: () => coach.items(token) });
  const topics = useQuery({ queryKey: ["knowledge-topics", token], queryFn: () => coach.topics(token) });
  const [filter, setFilter] = useState("all");
  const [topic, setTopic] = useState("");
  const [editing, setEditing] = useState<KnowledgeItem>();
  const [creating, setCreating] = useState(false);
  const [reviewing, setReviewing] = useState<KnowledgeItem>();
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");
  const update = useMutation({ mutationFn: async ({ action, id }: { action: string; id?: string }) => {
    if (action === "sync") return coach.backfill(token);
    if (action === "merge") return coach.merge(token, selected[0], selected.slice(1));
    if (id) return coach.remove(token, id);
  }, onSuccess: async () => { setSelected([]); await refreshMemory(client); } });
  const preview = useMutation({ mutationFn: () => coach.preview(token, query.trim(), { source_type: filter, topic_tags: topic ? [topic] : [] }) });
  useEffect(() => { preview.reset(); }, [filter, topic, items.dataUpdatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("item");
    if (id && items.data) document.getElementById(`memory-${id}`)?.scrollIntoView({ block: "center" });
  }, [items.data]);
  const visible = items.data?.filter(item => (filter === "all" || item.category === filter) && (!topic || item.topic_tags?.includes(topic))) ?? [];
  const sameType = new Set(items.data?.filter(item => selected.includes(item.id)).map(item => item.category)).size === 1;
  const labels = Object.fromEntries((topics.data?.presets ?? []).map(value => [value.id, t(`topic.${value.id}`) === `topic.${value.id}` ? value.label : t(`topic.${value.id}`)]));
  const currentTopic = topics.data?.items?.find(value => value.id === topic);
  const find = (event: FormEvent) => { event.preventDefault(); if (query.trim().length >= 2) preview.mutate(); };
  return <div className="coach-knowledge-layout"><TutorScope sourceType={filter} topicTags={topic ? [topic] : []} /><section className="coach-knowledge">
    <div className="coach-section-heading memory-heading"><div className="coach-filter-tabs">{["all", "note", "vocabulary", "mistake", "writing"].map(kind => <button key={kind} className={filter === kind ? "active" : ""} onClick={() => { setFilter(kind); setSelected([]); }}>{t(typeLabels[kind] ?? "")}<small>{items.data?.filter(item => kind === "all" || item.category === kind).length ?? 0}</small></button>)}</div><div className="memory-heading-actions"><button className="coach-icon-button" title={t("ui.importExistingLearningRecords")} aria-label={t("ui.importExistingLearningRecords")} disabled={update.isPending} onClick={() => update.mutate({ action: "sync" })}><RefreshCw size={18} className={update.isPending ? "spin" : ""} /></button><button className="primary-button" onClick={() => setCreating(true)}><Plus size={16} />{t("ui.newNote")}</button></div></div>
    <div className="memory-topic-toolbar"><select aria-label={t("ui.filterByTopic")} value={topic} onChange={event => { setTopic(event.target.value); setSelected([]); }}><option value="">{t("ui.allTopics")}</option>{topics.data?.items?.map(value => <option key={value.id} value={value.id}>{t("memory.topicOption", { label: t(`topic.${value.id}`) === `topic.${value.id}` ? value.label : t(`topic.${value.id}`), count: value.item_ids.length })}</option>)}</select>{currentTopic && <span>{t("memory.topicSummary", { mistakes: currentTopic.mistake_count, notes: currentTopic.note_count })}</span>}</div>
    <details className="memory-find"><summary><Search size={16} />{t("ui.findRelatedSources")}</summary><form onSubmit={find}><input aria-label={t("ui.searchNotesAndMistakes")} value={query} onChange={event => setQuery(event.target.value)} maxLength={2000} placeholder={t("ui.enterAQuestionOrTopic")} /><button className="secondary-button" disabled={preview.isPending || query.trim().length < 2}>{preview.isPending ? t("ui.searching") : t("ui.find")}</button></form>{preview.error && <p className="error-text">{localizeError(preview.error.message)}</p>}{preview.data && (preview.data.citations.length ? <Sources items={preview.data.citations} /> : <p>{t("ui.noRelatedSourcesFound")}</p>)}</details>
    {!!selected.length && <div className="coach-selection"><span>{t("common.itemsCount", { count: selected.length })}</span><button title={t("ui.mergeEntriesOfTheSameType")} disabled={selected.length < 2 || !sameType || update.isPending} onClick={() => update.mutate({ action: "merge" })}><GitMerge size={15} />{t("ui.merge")}</button><button onClick={() => setSelected([])}>{t("ui.cancel")}</button></div>}
    {notice && <p role="status" className="memory-notice">{t(notice)}</p>}{(items.error || update.error || topics.error) && <p role="alert" className="error-text">{localizeError(items.error?.message ?? "") || localizeError(update.error?.message ?? "") || localizeError(topics.error?.message ?? "")}</p>}
    <div className="coach-knowledge-grid">{visible.map(item => <article className="panel coach-knowledge-card" id={`memory-${item.id}`} key={item.id}>
      <header><label className="coach-select-label"><input type="checkbox" aria-label={t("ui.selectValue", { value1: item.title })} checked={selected.includes(item.id)} onChange={event => setSelected(ids => event.target.checked ? [...ids, item.id] : ids.filter(id => id !== item.id))} /><span className="coach-chip">{t(typeLabels[item.category] ?? "")}</span></label></header>
      <h3>{item.title}</h3><small>{t(typeLabels[item.module] ?? item.module)} · {item.state_source === "self_review" ? t("memory.selfReviewStatus", { status: t(statusLabels[item.status] ?? item.status) }) : t(statusLabels[item.status] ?? item.status)}{!!item.mistake_count && t("memory.mistakeCount", { count: item.mistake_count })}</small>
      {!!item.topic_tags?.length && <div className="memory-tags">{item.topic_tags.map(tag => <button key={tag} onClick={() => { setTopic(tag); setSelected([]); }}>{labels[tag] ?? tag}</button>)}</div>}
      <details><summary>{t("ui.originalRecords")}</summary>{item.source_summary && <p className="coach-knowledge-source"><Link href={item.source_link}>{t("common.sourceSummary", { source: item.source_summary })} ↗</Link></p>}<p className="coach-record-content">{item.content}</p>{item.source_url && <a className="memory-original-link" href={item.source_url} target="_blank" rel="noreferrer">{t("ui.originalLink")}</a>}{Object.entries(item.merged_records ?? {}).map(([key, source]) => <div key={key}><Link href={source.source_link}>{source.title} ↗</Link>{source.source_summary && <p className="coach-knowledge-source">{t("common.sourceSummary", { source: source.source_summary })}</p>}<p className="coach-record-content">{source.content}</p>{source.note && <p>{source.note}</p>}</div>)}</details>
      {item.note && <p>{item.note}</p>}<MemoryHistory token={token} item={item} />
      <footer><button className="memory-review-button" onClick={() => setReviewing(item)}>{t("ui.logAReview")}</button><div><Link href={item.source_link}>{t("ui.source2")}</Link><button aria-label={t("ui.editEntry")} title={t("ui.editEntry")} onClick={() => setEditing(item)}><Pencil size={16} /></button><button aria-label={t("ui.deleteKnowledgeEntry")} title={t("ui.deleteKnowledgeEntryPracticeHistoryIsKept")} disabled={update.isPending} onClick={() => update.mutate({ action: "delete", id: item.id })}><Trash2 size={16} /></button></div></footer>
    </article>)}</div>
    {!visible.length && !items.isLoading && <div className="panel coach-empty"><BookOpen size={36} /><h3>{t("ui.nothingSavedYet")}</h3><div className="coach-empty-actions"><button onClick={() => setCreating(true)}>{t("ui.writeANote")}</button><Link href="/question-bank">{t("ui.practice3")}</Link><Link href="/writing">{t("ui.writeAnEssay")}</Link></div></div>}
    {creating && <KnowledgeEditor token={token} onClose={() => setCreating(false)} onSaved={() => { setFilter("note"); setTopic(""); setNotice("ui.noteSaved"); }} />}
    {editing && <KnowledgeEditor token={token} item={editing} onClose={() => setEditing(undefined)} onSaved={() => setNotice("ui.noteUpdated")} />}
    {reviewing && <ReviewDialog token={token} item={reviewing} onClose={() => setReviewing(undefined)} />}
  </section></div>;
}
