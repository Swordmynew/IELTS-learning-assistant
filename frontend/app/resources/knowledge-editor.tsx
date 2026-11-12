"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookmarkPlus, Check, X } from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BookmarkSource, coach, KnowledgeItem } from "@/lib/coach";

export async function refreshMemory(client: ReturnType<typeof useQueryClient>) {
  await Promise.all(["personal-knowledge", "knowledge-topics", "memory-events", "coach-conversations"].map(key => client.invalidateQueries({ queryKey: [key] })));
}

export function KnowledgeEditor({ token, item, source, initialTitle = "", initialContent = "", onClose, onSaved }: {
  token: string; item?: KnowledgeItem; source?: BookmarkSource; initialTitle?: string; initialContent?: string;
  onClose: () => void; onSaved?: () => void;
}) {
  const client = useQueryClient();
  const dialog = useRef<HTMLDialogElement>(null);
  const requestId = useRef(crypto.randomUUID());
  const [title, setTitle] = useState(item?.title ?? initialTitle);
  const [content, setContent] = useState(item?.content ?? initialContent);
  const [note, setNote] = useState(item?.note ?? "");
  const [module, setModule] = useState(item?.module ?? "general");
  const [tags, setTags] = useState((item?.topic_tags ?? []).join(", "));
  const [sourceUrl, setSourceUrl] = useState(item?.source_url ?? "");
  const [related, setRelated] = useState(item?.related_ids ?? []);
  const topics = useQuery({ queryKey: ["knowledge-topics", token], queryFn: () => coach.topics(token) });
  const items = useQuery({ queryKey: ["personal-knowledge", token], queryFn: () => coach.items(token) });
  const mutableContent = !item || item.source_kind === "manual";
  useEffect(() => { dialog.current?.showModal(); }, []);
  const save = useMutation({ mutationFn: async () => {
    const common = { title: title.trim(), note, topic_tags: tags.split(/[,，;；]/).map(tag => tag.trim()).filter(Boolean), related_ids: related };
    if (item) return coach.edit(token, item.id, { ...common, ...(mutableContent ? { content: content.trim(), source_url: sourceUrl.trim() || null } : {}) });
    if (source) return coach.bookmark(token, { ...source, ...common, excerpt: content.trim() });
    return coach.createNote(token, { ...common, content: content.trim(), module, source_url: sourceUrl.trim() || null, request_id: requestId.current });
  }, onSuccess: async () => { await refreshMemory(client); onSaved?.(); onClose(); } });
  const submit = (event: FormEvent) => { event.preventDefault(); if (!save.isPending) save.mutate(); };
  return createPortal(<dialog ref={dialog} className="coach-edit-dialog memory-editor-dialog" aria-label={item ? "编辑知识条目" : source ? "收藏为笔记" : "新建碎片笔记"} onCancel={event => { event.preventDefault(); if (!save.isPending) onClose(); }}>
    <form className="panel coach-edit memory-editor" onSubmit={submit}>
      <header className="coach-section-heading"><h3>{item ? "编辑知识条目" : source ? "收藏为笔记" : "新建碎片笔记"}</h3><button type="button" className="coach-icon-button" aria-label="关闭编辑" disabled={save.isPending} onClick={onClose}><X size={18} /></button></header>
      <label className="field">标题<input required value={title} maxLength={200} onChange={event => setTitle(event.target.value)} autoFocus /></label>
      <label className="field">{source || !mutableContent ? "原文摘录" : "笔记内容"}<textarea aria-label={source || !mutableContent ? "原文摘录" : "笔记内容"} required value={content} maxLength={8000} readOnly={!mutableContent} onChange={event => setContent(event.target.value)} /></label>
      <label className="field">我的备注<textarea aria-label="我的备注" value={note} maxLength={8000} onChange={event => setNote(event.target.value)} /></label>
      <label className="field">知识点标签<input list="memory-topic-options" value={tags} maxLength={1300} placeholder="例如：不可数名词, 搭配" onChange={event => setTags(event.target.value)} /><datalist id="memory-topic-options">{topics.data?.presets?.map(topic => <option value={topic.label} key={topic.id} />)}</datalist></label>
      <details className="memory-extra"><summary>关联与来源</summary><div className="memory-extra-fields">
        {!item && !source && <label className="field">科目<select value={module} onChange={event => setModule(event.target.value)}>{Object.entries({ general: "通用", writing: "写作", reading: "阅读", listening: "听力", speaking: "口语", vocabulary: "词汇" }).map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></label>}
        {(!source && mutableContent) && <label className="field">来源链接（可选）<input type="url" value={sourceUrl} onChange={event => setSourceUrl(event.target.value)} placeholder="https://…" maxLength={2000} /></label>}
        <label className="field">关联已有记录<select aria-label="关联已有记录" multiple value={related} onChange={event => setRelated(Array.from(event.target.selectedOptions, option => option.value))}>{items.data?.filter(record => record.id !== item?.id).map(record => <option key={record.id} value={record.id}>{record.title}</option>)}</select></label>
      </div></details>
      {save.error && <p role="alert" className="error-text">{save.error.message}</p>}
      <footer className="memory-form-actions"><button type="button" className="text-button" onClick={onClose} disabled={save.isPending}>取消</button><button type="submit" className="primary-button" disabled={save.isPending || !title.trim() || !content.trim()}>{save.isPending ? "保存中…" : "保存笔记"}</button></footer>
    </form>
  </dialog>, document.body);
}

export function SaveNoteButton({ token, source, title, text }: { token: string; source: BookmarkSource; title: string; text: string }) {
  const [excerpt, setExcerpt] = useState<string>();
  const [saved, setSaved] = useState(false);
  return <><button className="memory-save-button" type="button" disabled={saved} onClick={() => {
    const selected = window.getSelection()?.toString().trim();
    setExcerpt(selected && text.includes(selected) ? selected.slice(0, 8000) : text.slice(0, 8000));
  }} aria-label={saved ? "已收藏为笔记" : "收藏为笔记"}>{saved ? <Check size={14} /> : <BookmarkPlus size={14} />}{saved ? "已收藏" : "收藏"}</button>
    {excerpt !== undefined && <KnowledgeEditor token={token} source={source} initialTitle={title.slice(0, 200)} initialContent={excerpt} onClose={() => setExcerpt(undefined)} onSaved={() => setSaved(true)} />}</>;
}
