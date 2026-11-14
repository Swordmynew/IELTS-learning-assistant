"use client";

import { useI18n, translate, localizeError } from "@/lib/i18n";

import { useMutation, useQuery } from "@tanstack/react-query";
import { BookOpen, ChevronRight, ExternalLink, LoaderCircle, Send, X } from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Answer, coach, Source } from "@/lib/coach";
import { demoView } from "@/lib/system-content";
import { SaveNoteButton } from "./resources/knowledge-editor";

export const typeLabels: Record<string, string> = { all: "ui.all", note: "ui.quickNotes", general: "ui.general", public: "ui.publicSources", document: "ui.myDocuments", vocabulary: "ui.words", mistake: "ui.mistakes", writing: "ui.writing", reading: "ui.reading", listening: "ui.listening", speaking: "ui.speaking", live: "ui.liveFeedback", cache: "ui.cachedResponse", demo: "ui.offlineDemo", offline: "ui.offline", insufficient: "ui.insufficientEvidence" };
const provenanceLabels: Record<string, string> = { "official-rubric-paraphrase": "ui.officialCriteriaSummary", "project-authored-guidance": "ui.originalGuidance", "user-uploaded-document": "ui.personalUpload", "personal-learning-record": "ui.personalPractice", "public-document-unverified-origin": "ui.publicMaterial", "user-authored-note": "ui.personalNote", "practice-excerpt": "ui.practiceExcerpt", "learner-writing-excerpt": "ui.essayExcerpt", "ai-answer-bookmark": "ui.savedAiAnswer", "document-excerpt": "ui.documentExcerpt" };

function matchReasonLabel(reason: string) {
  const keys: Record<string, string> = { "关联学习记录": "source.relatedRecord", "向量匹配（演示）": "source.vectorDemo", "语义相近": "source.semanticMatch", "关键词匹配": "source.keywordMatch", "同一知识点": "source.sameTopic", "待复习": "ui.toReview2", "最近已改善": "source.recentlyImproved" };
  const mistakes = /^历史错误 (\d+) 次$/.exec(reason);
  return mistakes ? translate("source.previousMistakes", { count: Number(mistakes[1]) }) : keys[reason] ? translate(keys[reason]) : reason;
}

function systemMessageKey(message: Answer) {
  if (message.system_message_key) return message.system_message_key;
  // Old saved fallbacks predate explicit system-message metadata; do not rewrite history.
  if (!message.citations.length && ["当前知识库证据不足以回答该问题。", "当前资料不足以回答这个问题。"].includes(message.answer)) return "rag.insufficientEvidence";
  return null;
}

function answerModeLabel(message: Answer) {
  if (systemMessageKey(message) || message.mode === "insufficient") return translate("ui.insufficientEvidence");
  if (!message.failure_reason || message.failure_reason === "offline") return translate(typeLabels[message.mode] ?? message.mode);
  return message.failure_reason.startsWith("invalid_") ? translate("ui.responseValidationFailed") : translate("ui.noAnswerGenerated");
}

export function Sources({ items }: { items: Source[] }) {
  const { t, formatDate } = useI18n();
  return <div className="coach-sources">{items.map((item, index) => {
    const original = item.url || item.source_link;
    const href = item.url && item.page && /\.pdf(?:[?#]|$)/i.test(item.url) ? item.url.split("#")[0] + `#page=${item.page}` : original;
    return <details key={item.source_id}>
    <summary><span className="source-number">{item.number ?? index + 1}</span><span className="coach-chip">{t(typeLabels[item.source_type] ?? item.source_type)}</span><span>{item.title}</span><ChevronRight size={14} /></summary>
    <blockquote>{item.excerpt}</blockquote>{!!item.match_reasons?.length && <small className="memory-match-reasons">{item.match_reasons.map(matchReasonLabel).join(" · ")}</small>}<div className="coach-source-footer">{item.provenance && <small>{t(provenanceLabels[item.provenance] ?? item.provenance)}</small>}{item.recorded_at && <small>{formatDate(item.recorded_at)}</small>}{item.page && <small>{t("source.pageNumber", { page: item.page })}</small>}{(item.url || item.source_link) && <a href={href} target="_blank" rel="noreferrer">{t("ui.originalSource")}<ExternalLink size={12} /></a>}</div>
  </details>; })}</div>;
}

export function DemoPanel({ token, onClose }: { token: string; onClose: () => void }) {
  const { t } = useI18n();
  const demo = useQuery({ queryKey: ["coach-demo", token], queryFn: () => coach.demo(token) });
  const [version, setVersion] = useState(0);
  const [hint, setHint] = useState(0);
  if (!demo.data) return <div className="panel">{demo.error ? localizeError(demo.error.message) : t("ui.loadingDemo")}<button onClick={onClose}>{t("ui.close")}</button></div>;
  const data = demoView(demo.data), current = data.versions[version];
  return <section className="panel coach-demo">
    <header className="coach-section-heading"><div><span className="coach-chip demo">{t("ui.offlineDemo")}</span><h2>{t("ui.fromReadingVocabularyToEssayRevision")}</h2></div><button className="coach-icon-button" onClick={onClose} aria-label={t("ui.closeDemo")}><X /></button></header>
    <div className="coach-demo-memory">{data.knowledge.map(item => <article key={item.title}><span className="coach-chip">{t(typeLabels[item.category] ?? "")}</span><strong>{item.title}</strong><p>{item.content}</p></article>)}</div>
    <div className="coach-version-tabs">{data.versions.map((_, index) => <button className={version === index ? "active" : ""} key={index} onClick={() => { setVersion(index); setHint(0); }}>{t("writing.demoVersion", { version: index + 1, draft: index ? t("ui.revision") : t("ui.firstDraft") })}</button>)}</div>
    <div className="coach-workspace"><article className="coach-paper"><small>{t("ui.task2")}</small><h3>{data.prompt}</h3><p>{current.essay}</p></article><div className="coach-feedback">{current.issues.map(issue => <article className="coach-issue" key={issue.title}><h3>{issue.title}</h3><blockquote>{issue.quote}</blockquote><p>{issue.text}</p><small>{issue.source}</small></article>)}<div className="coach-hint-tabs">{[t("ui.think"), t("ui.guidance"), t("ui.example")].map((label, index) => <button key={label} onClick={() => setHint(index)} className={hint === index ? "active" : ""}>{label}</button>)}</div><p>{current.hints[hint]}</p></div></div>
    <details className="coach-demo-answer"><summary>{t("ui.whyDoesHoweverNotFitHere")}</summary><p>{data.answer}</p><Sources items={data.citations} /></details>
    <small>{t("ui.originalDemoNotSavedToYourLearningHistory")}</small>
  </section>;
}

export function DemoDialog({ token, onClose }: { token: string; onClose: () => void }) {
  const { t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return createPortal(<dialog ref={dialog} className="coach-demo-dialog" aria-label={t("ui.offlineDemo")} onCancel={event => { event.preventDefault(); onClose(); }}><DemoPanel token={token} onClose={onClose} /></dialog>, document.body);
}

function inlineText(text: string) {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => part.startsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : part.startsWith("`") ? <code key={i}>{part.slice(1, -1)}</code> : part);
}

function AnswerText({ text }: { text: string }) {

  return <div className="coach-answer-text">{text.split(/\n\s*\n/).map((block, index) => {
    const lines = block.trim().split("\n");
    if (lines.every(line => /^\s*[-*] /.test(line))) return <ul key={index}>{lines.map((line, i) => <li key={i}>{inlineText(line.replace(/^\s*[-*] /, ""))}</li>)}</ul>;
    if (lines.every(line => /^\s*\d+[.)、] /.test(line))) return <ol key={index} start={parseInt(lines[0], 10)}>{lines.map((line, i) => <li key={i}>{inlineText(line.replace(/^\s*\d+[.)、] /, ""))}</li>)}</ol>;
    return <p key={index}>{inlineText(block.replace(/^#{1,6}\s+/gm, ""))}</p>;
  })}</div>;
}

export function Tutor({ token, versionId, sourceType = "all", documentIds = [], topicTags = [], writingPage = false, onClose }: {
  token: string; versionId?: string; sourceType?: string; documentIds?: string[]; topicTags?: string[]; writingPage?: boolean; onClose?: () => void;
}) {
  const { t, formatDate } = useI18n();
  const [query, setQuery] = useState("");
  const [messages, setMessages] = useState<(Answer & { query: string })[]>([]);
  const [conversation, setConversation] = useState<string>();
  const [showDemo, setShowDemo] = useState(false);
  const messageList = useRef<HTMLDivElement>(null);
  const history = useQuery({ queryKey: ["coach-conversations", token, versionId], queryFn: () => coach.conversations(token) });
  useEffect(() => {
    setMessages([]); setConversation(undefined);
  }, [versionId, sourceType, documentIds.join(","), topicTags.join(","), writingPage]);
  useEffect(() => {
    const found = history.data?.find(item => versionId ? item.parent_id === versionId : item.id === conversation);
    if (found) setMessages(found.messages);
  }, [history.data, versionId, conversation]);
  const ask = useMutation({ mutationFn: (text: string) => versionId ? coach.askWriting(token, versionId, text) : coach.ask(token, text, { source_type: sourceType, document_ids: documentIds, topic_tags: topicTags, conversation_id: conversation }),
    onSuccess: (value, text) => { setMessages(items => [...items, { ...value, query: text }]); if (value.conversation_id) setConversation(value.conversation_id); setQuery(""); history.refetch(); },
  });
  useEffect(() => {
    const list = messageList.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages, ask.isPending]);
  const noEssay = writingPage && !versionId;
  const submit = (event: FormEvent) => { event.preventDefault(); if (!ask.isPending && !noEssay && query.trim().length >= 2) ask.mutate(query.trim()); };
  const resourceHistory = history.data?.filter(c => !c.parent_id && (c.scope?.source_type ?? "all") === sourceType && JSON.stringify([...(c.scope?.document_ids ?? [])].sort()) === JSON.stringify([...documentIds].sort()) && JSON.stringify([...(c.scope?.topic_tags ?? [])].sort()) === JSON.stringify([...topicTags].sort())) ?? [];
  return <section className="panel coach-tutor"><header className="coach-section-heading"><h2><BookOpen size={19} /> {writingPage ? t("ui.askAboutThisEssay") : t("ui.learningAssistant")}</h2><div className="tutor-header-actions"><button className="text-button" onClick={() => setShowDemo(true)}>{t("ui.offlineDemo")}</button>{onClose && <button className="coach-icon-button" aria-label={t("ui.closeLearningAssistant")} onClick={onClose}><X size={18} /></button>}</div></header>
    {!versionId && !!resourceHistory.length && <select aria-label={t("ui.conversationHistory")} value={conversation ?? ""} onChange={event => { const found = resourceHistory.find(c => c.id === event.target.value); setConversation(found?.id); setMessages(found?.messages ?? []); }}><option value="">{t("ui.newConversation")}</option>{resourceHistory.map(c => <option key={c.id} value={c.id}>{c.messages[0]?.query.slice(0, 30) ?? t("ui.emptyConversation")}</option>)}</select>}
    <div ref={messageList} className="coach-messages" aria-live="polite">{!messages.length && <div className="coach-chat-empty"><BookOpen size={32} />{noEssay ? <p>{t("ui.selectADraftFirst")}</p> : <div className="coach-prompts">{(versionId ? [t("ui.whatShouldIReviseFirst"), t("ui.whatImprovedInThisRevision")] : [t("ui.howDoMyVocabularyMistakesAffectMyWriting"), t("ui.howCanIDevelopArgumentsForTask2")]).map(text => <button onClick={() => setQuery(text)} key={text}>{text}<ChevronRight size={14} /></button>)}</div>}</div>}{messages.map((message, index) => <article key={index}><div className="coach-user-message">{message.query}</div><div className="coach-ai-message"><span className={`coach-chip ${systemMessageKey(message) ? "insufficient" : message.mode}`}>{answerModeLabel(message)}</span>{message.generated_at && message.mode === "cache" && <small>{formatDate(message.generated_at, { dateStyle: "medium", timeStyle: "short" })}</small>}<AnswerText text={systemMessageKey(message) ? t(systemMessageKey(message)!) : message.failure_reason ? localizeError(message.answer) : message.answer} />{message.context_stale && <small className="memory-context-stale">{t("ui.sourcesHaveChangedPleaseAskAgain")}</small>}{!versionId && conversation && ["live", "cache"].includes(message.mode) && !systemMessageKey(message) && !message.failure_reason && !message.context_stale && <SaveNoteButton token={token} source={{ source_type: "conversation", source_id: conversation, message_index: index }} title={message.query} text={message.answer} />}<Sources items={message.citations} />{!!message.retrieved_sources?.length && <details className="coach-retrieved-sources"><summary>{t("rag.retrievedSources")}</summary><Sources items={message.retrieved_sources} /></details>}{message.mode === "offline" && <button onClick={() => setShowDemo(true)}>{t("ui.openOfflineDemo")}</button>}</div></article>)}{ask.isPending && <div className="coach-thinking"><LoaderCircle className="spin" size={16} />{t("ui.thinking")}</div>}</div>
    <form className="coach-chat-input" onSubmit={submit}><input value={query} onChange={event => setQuery(event.target.value)} placeholder={writingPage ? t("ui.askAboutThisEssay2") : t("ui.enterAQuestion")} aria-label={t("ui.learningQuestion")} maxLength={2000} disabled={noEssay} /><button type="submit" className="primary-button" aria-label={t("ui.sendQuestion")} disabled={noEssay || ask.isPending || query.trim().length < 2}>{ask.isPending ? <LoaderCircle className="spin" size={18} /> : <Send size={18} />}</button></form>{ask.error && <p className="error-text">{localizeError(ask.error.message)}</p>}{showDemo && <DemoDialog token={token} onClose={() => setShowDemo(false)} />}
  </section>;
}
