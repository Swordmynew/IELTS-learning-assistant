"use client";

import { useI18n, localizeError } from "@/lib/i18n";

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
  const { t } = useI18n();
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
  return createPortal(<dialog ref={dialog} className="coach-edit-dialog memory-editor-dialog" aria-label={item ? t("ui.editKnowledgeEntry") : source ? t("ui.saveAsNote") : t("ui.newQuickNote")} onCancel={event => { event.preventDefault(); if (!save.isPending) onClose(); }}>
    <form className="panel coach-edit memory-editor" onSubmit={submit}>
      <header className="coach-section-heading"><h3>{item ? t("ui.editKnowledgeEntry") : source ? t("ui.saveAsNote") : t("ui.newQuickNote")}</h3><button type="button" className="coach-icon-button" aria-label={t("ui.closeEditor")} disabled={save.isPending} onClick={onClose}><X size={18} /></button></header>
      <label className="field">{t("ui.title")}<input required value={title} maxLength={200} onChange={event => setTitle(event.target.value)} autoFocus /></label>
      <label className="field">{source || !mutableContent ? t("ui.sourceExcerpt") : t("ui.noteContent")}<textarea aria-label={source || !mutableContent ? t("ui.sourceExcerpt") : t("ui.noteContent")} required value={content} maxLength={8000} readOnly={!mutableContent} onChange={event => setContent(event.target.value)} /></label>
      <label className="field">{t("ui.myNotes")}<textarea aria-label={t("ui.myNotes")} value={note} maxLength={8000} onChange={event => setNote(event.target.value)} /></label>
      <label className="field">{t("ui.topicTags")}<input list="memory-topic-options" value={tags} maxLength={1300} placeholder={t("ui.eGUncountableNounsCollocations")} onChange={event => setTags(event.target.value)} /><datalist id="memory-topic-options">{topics.data?.presets?.map(topic => <option value={topic.id} label={t(`topic.${topic.id}`) === `topic.${topic.id}` ? topic.label : t(`topic.${topic.id}`)} key={topic.id} />)}</datalist></label>
      <details className="memory-extra"><summary>{t("ui.linksAndSources")}</summary><div className="memory-extra-fields">
        {!item && !source && <label className="field">{t("ui.subject")}<select value={module} onChange={event => setModule(event.target.value)}>{Object.entries({ general: t("ui.general"), writing: t("ui.writing"), reading: t("ui.reading"), listening: t("ui.listening"), speaking: t("ui.speaking"), vocabulary: t("ui.vocabulary2") }).map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></label>}
        {(!source && mutableContent) && <label className="field">{t("ui.sourceUrlOptional")}<input type="url" value={sourceUrl} onChange={event => setSourceUrl(event.target.value)} placeholder={t("common.urlPlaceholder")} maxLength={2000} /></label>}
        <label className="field">{t("ui.linkExistingEntries")}<select aria-label={t("ui.linkExistingEntries")} multiple value={related} onChange={event => setRelated(Array.from(event.target.selectedOptions, option => option.value))}>{items.data?.filter(record => record.id !== item?.id).map(record => <option key={record.id} value={record.id}>{record.title_message_key ? t(record.title_message_key) : record.title}</option>)}</select></label>
      </div></details>
      {save.error && <p role="alert" className="error-text">{localizeError(save.error.message)}</p>}
      <footer className="memory-form-actions"><button type="button" className="text-button" onClick={onClose} disabled={save.isPending}>{t("ui.cancel")}</button><button type="submit" className="primary-button" disabled={save.isPending || !title.trim() || !content.trim()}>{save.isPending ? t("ui.saving2") : t("ui.saveNote")}</button></footer>
    </form>
  </dialog>, document.body);
}

export function SaveNoteButton({ token, source, title, text }: { token: string; source: BookmarkSource; title: string; text: string }) {
  const { t } = useI18n();
  const [excerpt, setExcerpt] = useState<string>();
  const [saved, setSaved] = useState(false);
  return <><button className="memory-save-button" type="button" disabled={saved} onClick={() => {
    const selected = window.getSelection()?.toString().trim();
    setExcerpt(selected && text.includes(selected) ? selected.slice(0, 8000) : text.slice(0, 8000));
  }} aria-label={saved ? t("ui.savedAsNote") : t("ui.saveAsNote")}>{saved ? <Check size={14} /> : <BookmarkPlus size={14} />}{saved ? t("ui.saved2") : t("ui.save")}</button>
    {excerpt !== undefined && <KnowledgeEditor token={token} source={source} initialTitle={title.slice(0, 200)} initialContent={excerpt} onClose={() => setExcerpt(undefined)} onSaved={() => setSaved(true)} />}</>;
}
