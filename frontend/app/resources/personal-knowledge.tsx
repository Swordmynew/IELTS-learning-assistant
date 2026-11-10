"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, GitMerge, Pencil, RefreshCw, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { coach, KnowledgeItem } from "@/lib/coach";
import { typeLabels } from "../coach-components";
import { TutorScope } from "../floating-tutor";

export function PersonalKnowledge({ token }: { token: string }) {
  const client = useQueryClient();
  const items = useQuery({ queryKey: ["personal-knowledge", token], queryFn: () => coach.items(token) });
  const [filter, setFilter] = useState("all");
  const [editing, setEditing] = useState<KnowledgeItem | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState("");
  const editDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (editing) editDialog.current?.showModal(); }, [editing?.id]);
  const update = useMutation({ mutationFn: async ({ action, item }: { action: string; item?: KnowledgeItem }) => {
    if (action === "sync") return coach.backfill(token);
    if (action === "merge") return coach.merge(token, selected[0], selected.slice(1));
    if (!item) return;
    if (action === "delete") return coach.remove(token, item.id);
    return coach.edit(token, item.id, { title: item.title, note: item.note ?? "" });
  }, onSuccess: () => { setEditing(null); setSelected([]); setError(""); client.invalidateQueries({ queryKey: ["personal-knowledge"] }); }, onError: (reason: Error) => setError(reason.message) });
  const visible = items.data?.filter(item => filter === "all" || item.category === filter) ?? [];
  const sameType = new Set(items.data?.filter(item => selected.includes(item.id)).map(item => item.category)).size === 1;
  return <div className="coach-knowledge-layout"><TutorScope sourceType={filter} /><section className="coach-knowledge">
    <div className="coach-section-heading"><div className="coach-filter-tabs">{["all", "vocabulary", "mistake", "writing"].map(kind => <button key={kind} className={filter === kind ? "active" : ""} onClick={() => { setFilter(kind); setSelected([]); }}>{typeLabels[kind]}<small>{items.data?.filter(item => kind === "all" || item.category === kind).length ?? 0}</small></button>)}</div><button className="coach-icon-button" title="导入已有学习记录" aria-label="导入已有学习记录" disabled={update.isPending} onClick={() => update.mutate({ action: "sync" })}><RefreshCw size={18} className={update.isPending ? "spin" : ""} /></button></div>
    {selected.length > 0 && <div className="coach-selection"><span>{selected.length} 项</span><button title="合并同类知识条目" disabled={selected.length < 2 || !sameType || update.isPending} onClick={() => update.mutate({ action: "merge" })}><GitMerge size={15} />合并</button><button onClick={() => setSelected([])}>取消</button></div>}
    {items.error && <p className="error-text">{items.error.message}</p>}{error && <p className="error-text">{error}</p>}
    <div className="coach-knowledge-grid">{visible.map(item => <article className="panel coach-knowledge-card" key={item.id}>
      <header><label className="coach-select-label"><input type="checkbox" aria-label={`选择 ${item.title}`} checked={selected.includes(item.id)} onChange={event => setSelected(ids => event.target.checked ? [...ids, item.id] : ids.filter(id => id !== item.id))} /><span className="coach-chip">{typeLabels[item.category]}</span></label></header>
      <h3>{item.title}</h3><small>{typeLabels[item.module] ?? item.module} · {item.status === "correct_latest" ? "最近答对" : item.status === "improved" ? "已改善" : item.status === "partial" ? "部分改善" : "待复习"}</small>
      <details><summary>原始记录</summary>{item.source_summary && <p className="coach-knowledge-source"><Link href={item.source_link}>来源：{item.source_summary} ↗</Link></p>}<p className="coach-record-content">{item.content}</p>{Object.entries(item.merged_records ?? {}).map(([key, source]) => <div key={key}><Link href={source.source_link}>{source.title} ↗</Link>{source.source_summary && <p className="coach-knowledge-source">来源：{source.source_summary}</p>}<p className="coach-record-content">{source.content}</p>{source.note && <p>{source.note}</p>}</div>)}</details>{item.note && <p>{item.note}</p>}
      <footer><Link href={item.source_link}>来源 ↗</Link><div><button aria-label="编辑记录" title="编辑记录" onClick={() => setEditing({ ...item })}><Pencil size={16} /></button><button aria-label="删除知识条目" title="删除知识条目，练习历史保留" disabled={update.isPending} onClick={() => update.mutate({ action: "delete", item })}><Trash2 size={16} /></button></div></footer>
    </article>)}</div>
    {!visible.length && !items.isLoading && <div className="panel coach-empty"><BookOpen size={36} /><h3>暂无积累</h3><div className="coach-empty-actions"><Link href="/vocabulary">背单词 →</Link><Link href="/question-bank">做练习 →</Link><Link href="/writing">写作文 →</Link></div><button onClick={() => update.mutate({ action: "sync" })} disabled={update.isPending}>导入已有记录</button></div>}
    {editing && <dialog ref={editDialog} className="coach-edit-dialog" aria-label="编辑知识条目" onCancel={() => setEditing(null)}><section className="panel coach-edit"><header className="coach-section-heading"><h3>编辑知识条目</h3><button className="coach-icon-button" aria-label="关闭编辑" onClick={() => setEditing(null)}><X size={18} /></button></header><label className="field">标题<input value={editing.title} maxLength={200} onChange={event => setEditing({ ...editing, title: event.target.value })} /></label><label className="field">我的备注<textarea value={editing.note ?? ""} maxLength={8000} onChange={event => setEditing({ ...editing, note: event.target.value })} /></label><button className="primary-button" disabled={update.isPending || !editing.title.trim()} onClick={() => update.mutate({ action: "edit", item: editing })}>保存</button>{error && <p className="error-text">{error}</p>}</section></dialog>}
  </section></div>;
}
