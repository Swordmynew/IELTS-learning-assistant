"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, GitMerge, Pencil, Plus, RefreshCw, Search, Trash2, X } from "lucide-react";
import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { coach, KnowledgeItem } from "@/lib/coach";
import { Sources, typeLabels } from "../coach-components";
import { TutorScope } from "../floating-tutor";
import { KnowledgeEditor, refreshMemory } from "./knowledge-editor";

const statusLabels: Record<string, string> = { saved: "已收藏", review: "待复习", remaining: "仍需练习", correct_latest: "最近答对", improved: "已改善", partial: "部分改善" };

function MemoryHistory({ token, item }: { token: string; item: KnowledgeItem }) {
  const [open, setOpen] = useState(false);
  const events = useQuery({ queryKey: ["memory-events", token, item.id], queryFn: () => coach.events(token, item.id), enabled: open });
  const labels: Record<string, string> = { capture: "收藏记录", practice: "练习结果", self_review: "自评复习", revision: "作文复评" };
  return <details className="memory-history" onToggle={event => setOpen(event.currentTarget.open)}><summary>学习记录</summary>
    {events.isLoading ? <p>读取中…</p> : events.error ? <p className="error-text">{events.error.message}</p> : events.data?.length ? <ol>{events.data.map(event => <li key={event.id}><div><strong>{labels[event.event_type] ?? event.event_type}</strong><small>{new Date(event.occurred_at).toLocaleString()}</small></div><span>{statusLabels[event.status] ?? event.status}</span><p>{event.content}</p></li>)}</ol> : <p>暂无事件记录</p>}
  </details>;
}

function ReviewDialog({ token, item, onClose }: { token: string; item: KnowledgeItem; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const client = useQueryClient();
  const requestId = useRef(crypto.randomUUID());
  const [outcome, setOutcome] = useState("review");
  const [note, setNote] = useState("");
  useEffect(() => { dialog.current?.showModal(); }, []);
  const save = useMutation({ mutationFn: () => coach.review(token, item.id, { outcome, note, request_id: requestId.current }), onSuccess: async () => { await refreshMemory(client); onClose(); } });
  return createPortal(<dialog ref={dialog} className="coach-edit-dialog" aria-label="记录复习" onCancel={event => { event.preventDefault(); if (!save.isPending) onClose(); }}><form className="panel coach-edit" onSubmit={event => { event.preventDefault(); save.mutate(); }}>
    <header className="coach-section-heading"><h3>记录本次自评</h3><button type="button" aria-label="关闭复习" className="coach-icon-button" onClick={onClose} disabled={save.isPending}><X size={18} /></button></header>
    <strong>{item.title}</strong><label className="field">这次练习后<select aria-label="这次练习后" value={outcome} onChange={event => setOutcome(event.target.value)}><option value="review">还需练习</option><option value="improved">本次已理解</option></select></label>
    <label className="field">练习或修改记录<textarea aria-label="练习或修改记录" value={note} onChange={event => setNote(event.target.value)} maxLength={4000} /></label>
    {save.error && <p role="alert" className="error-text">{save.error.message}</p>}<button className="primary-button" disabled={save.isPending}>{save.isPending ? "保存中…" : "保存复习记录"}</button>
  </form></dialog>, document.body);
}

export function PersonalKnowledge({ token }: { token: string }) {
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
  const labels = Object.fromEntries((topics.data?.presets ?? []).map(value => [value.id, value.label]));
  const currentTopic = topics.data?.items?.find(value => value.id === topic);
  const find = (event: FormEvent) => { event.preventDefault(); if (query.trim().length >= 2) preview.mutate(); };
  return <div className="coach-knowledge-layout"><TutorScope sourceType={filter} topicTags={topic ? [topic] : []} /><section className="coach-knowledge">
    <div className="coach-section-heading memory-heading"><div className="coach-filter-tabs">{["all", "note", "vocabulary", "mistake", "writing"].map(kind => <button key={kind} className={filter === kind ? "active" : ""} onClick={() => { setFilter(kind); setSelected([]); }}>{typeLabels[kind]}<small>{items.data?.filter(item => kind === "all" || item.category === kind).length ?? 0}</small></button>)}</div><div className="memory-heading-actions"><button className="coach-icon-button" title="导入已有学习记录" aria-label="导入已有学习记录" disabled={update.isPending} onClick={() => update.mutate({ action: "sync" })}><RefreshCw size={18} className={update.isPending ? "spin" : ""} /></button><button className="primary-button" onClick={() => setCreating(true)}><Plus size={16} />新建笔记</button></div></div>
    <div className="memory-topic-toolbar"><select aria-label="按知识点筛选" value={topic} onChange={event => { setTopic(event.target.value); setSelected([]); }}><option value="">全部知识点</option>{topics.data?.items?.map(value => <option key={value.id} value={value.id}>{value.label}（{value.item_ids.length}）</option>)}</select>{currentTopic && <span>{currentTopic.mistake_count} 次错误记录 · {currentTopic.note_count} 条笔记</span>}</div>
    <details className="memory-find"><summary><Search size={16} />查找相关资料</summary><form onSubmit={find}><input aria-label="查找笔记与错题" value={query} onChange={event => setQuery(event.target.value)} maxLength={2000} placeholder="输入问题或知识点" /><button className="secondary-button" disabled={preview.isPending || query.trim().length < 2}>{preview.isPending ? "查找中…" : "查找"}</button></form>{preview.error && <p className="error-text">{preview.error.message}</p>}{preview.data && (preview.data.citations.length ? <Sources items={preview.data.citations} /> : <p>没有找到相关资料</p>)}</details>
    {!!selected.length && <div className="coach-selection"><span>{selected.length} 项</span><button title="合并同类知识条目" disabled={selected.length < 2 || !sameType || update.isPending} onClick={() => update.mutate({ action: "merge" })}><GitMerge size={15} />合并</button><button onClick={() => setSelected([])}>取消</button></div>}
    {notice && <p role="status" className="memory-notice">{notice}</p>}{(items.error || update.error || topics.error) && <p role="alert" className="error-text">{items.error?.message || update.error?.message || topics.error?.message}</p>}
    <div className="coach-knowledge-grid">{visible.map(item => <article className="panel coach-knowledge-card" id={`memory-${item.id}`} key={item.id}>
      <header><label className="coach-select-label"><input type="checkbox" aria-label={`选择 ${item.title}`} checked={selected.includes(item.id)} onChange={event => setSelected(ids => event.target.checked ? [...ids, item.id] : ids.filter(id => id !== item.id))} /><span className="coach-chip">{typeLabels[item.category]}</span></label></header>
      <h3>{item.title}</h3><small>{typeLabels[item.module] ?? item.module} · {item.state_source === "self_review" ? "自评：" : ""}{statusLabels[item.status] ?? item.status}{!!item.mistake_count && ` · ${item.mistake_count} 次错误记录`}</small>
      {!!item.topic_tags?.length && <div className="memory-tags">{item.topic_tags.map(tag => <button key={tag} onClick={() => { setTopic(tag); setSelected([]); }}>{labels[tag] ?? tag}</button>)}</div>}
      <details><summary>原始记录</summary>{item.source_summary && <p className="coach-knowledge-source"><Link href={item.source_link}>来源：{item.source_summary} ↗</Link></p>}<p className="coach-record-content">{item.content}</p>{item.source_url && <a className="memory-original-link" href={item.source_url} target="_blank" rel="noreferrer">原始链接 ↗</a>}{Object.entries(item.merged_records ?? {}).map(([key, source]) => <div key={key}><Link href={source.source_link}>{source.title} ↗</Link>{source.source_summary && <p className="coach-knowledge-source">来源：{source.source_summary}</p>}<p className="coach-record-content">{source.content}</p>{source.note && <p>{source.note}</p>}</div>)}</details>
      {item.note && <p>{item.note}</p>}<MemoryHistory token={token} item={item} />
      <footer><button className="memory-review-button" onClick={() => setReviewing(item)}>记录复习</button><div><Link href={item.source_link}>来源 ↗</Link><button aria-label="编辑记录" title="编辑记录" onClick={() => setEditing(item)}><Pencil size={16} /></button><button aria-label="删除知识条目" title="删除知识条目，练习历史保留" disabled={update.isPending} onClick={() => update.mutate({ action: "delete", id: item.id })}><Trash2 size={16} /></button></div></footer>
    </article>)}</div>
    {!visible.length && !items.isLoading && <div className="panel coach-empty"><BookOpen size={36} /><h3>暂无积累</h3><div className="coach-empty-actions"><button onClick={() => setCreating(true)}>记一条笔记</button><Link href="/question-bank">做练习 →</Link><Link href="/writing">写作文 →</Link></div></div>}
    {creating && <KnowledgeEditor token={token} onClose={() => setCreating(false)} onSaved={() => { setFilter("note"); setTopic(""); setNotice("笔记已保存"); }} />}
    {editing && <KnowledgeEditor token={token} item={editing} onClose={() => setEditing(undefined)} onSaved={() => setNotice("笔记已更新")} />}
    {reviewing && <ReviewDialog token={token} item={reviewing} onClose={() => setReviewing(undefined)} />}
  </section></div>;
}
