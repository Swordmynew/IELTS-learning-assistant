"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { BookOpen, ChevronRight, ExternalLink, LoaderCircle, Send, X } from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Answer, coach, Source } from "@/lib/coach";

export const typeLabels: Record<string, string> = { all: "全部", public: "公共依据", document: "我的笔记", vocabulary: "单词", mistake: "错题", writing: "写作", reading: "阅读", listening: "听力", speaking: "口语", live: "实时反馈", cache: "历史缓存", demo: "离线示例", offline: "离线", insufficient: "证据不足" };
const provenanceLabels: Record<string, string> = { "official-rubric-paraphrase": "官方标准摘要", "project-authored-guidance": "项目原创", "user-uploaded-document": "个人上传", "personal-learning-record": "个人练习", "public-document-unverified-origin": "公共资料" };

export function Sources({ items }: { items: Source[] }) {
  return <div className="coach-sources">{items.map((item, index) => <details key={item.source_id}>
    <summary><span className="source-number">{item.number ?? index + 1}</span><span className="coach-chip">{typeLabels[item.source_type] ?? item.source_type}</span><span>{item.title}</span><ChevronRight size={14} /></summary>
    <blockquote>{item.excerpt}</blockquote><div className="coach-source-footer">{item.provenance && <small>{provenanceLabels[item.provenance] ?? item.provenance}</small>}{item.recorded_at && <small>{new Date(item.recorded_at).toLocaleDateString()}</small>}{item.page && <small>p. {item.page}</small>}{(item.url || item.source_link) && <a href={item.url || item.source_link} target="_blank" rel="noreferrer">原始来源 <ExternalLink size={12} /></a>}</div>
  </details>)}</div>;
}

export function DemoPanel({ token, onClose }: { token: string; onClose: () => void }) {
  const demo = useQuery({ queryKey: ["coach-demo", token], queryFn: () => coach.demo(token) });
  const [version, setVersion] = useState(0);
  const [hint, setHint] = useState(0);
  if (!demo.data) return <div className="panel">{demo.error ? demo.error.message : "载入示例…"}<button onClick={onClose}>关闭</button></div>;
  const data = demo.data, current = data.versions[version];
  return <section className="panel coach-demo">
    <header className="coach-section-heading"><div><span className="coach-chip demo">离线示例</span><h2>从阅读词汇到写作修改</h2></div><button className="coach-icon-button" onClick={onClose} aria-label="关闭示例"><X /></button></header>
    <div className="coach-demo-memory">{data.knowledge.map(item => <article key={item.title}><span className="coach-chip">{typeLabels[item.category]}</span><strong>{item.title}</strong><p>{item.content}</p></article>)}</div>
    <div className="coach-version-tabs">{data.versions.map((_, index) => <button className={version === index ? "active" : ""} key={index} onClick={() => { setVersion(index); setHint(0); }}>V{index + 1} · {index ? "修改稿" : "初稿"}</button>)}</div>
    <div className="coach-workspace"><article className="coach-paper"><small>Task 2</small><h3>{data.prompt}</h3><p>{current.essay}</p></article><div className="coach-feedback">{current.issues.map(issue => <article className="coach-issue" key={issue.title}><h3>{issue.title}</h3><blockquote>{issue.quote}</blockquote><p>{issue.text}</p><small>{issue.source}</small></article>)}<div className="coach-hint-tabs">{["思考", "方向", "示例"].map((label, index) => <button key={label} onClick={() => setHint(index)} className={hint === index ? "active" : ""}>{label}</button>)}</div><p>{current.hints[hint]}</p></div></div>
    <details className="coach-demo-answer"><summary>为什么 however 不合适？</summary><p>{data.answer}</p><Sources items={data.citations} /></details>
    <small>固定原创示例 · 不计入个人学习记录</small>
  </section>;
}

export function DemoDialog({ token, onClose }: { token: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return createPortal(<dialog ref={dialog} className="coach-demo-dialog" aria-label="离线示例" onCancel={event => { event.preventDefault(); onClose(); }}><DemoPanel token={token} onClose={onClose} /></dialog>, document.body);
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

export function Tutor({ token, versionId, sourceType = "all", documentIds = [], writingPage = false, onClose }: {
  token: string; versionId?: string; sourceType?: string; documentIds?: string[]; writingPage?: boolean; onClose?: () => void;
}) {
  const [query, setQuery] = useState("");
  const [messages, setMessages] = useState<(Answer & { query: string })[]>([]);
  const [conversation, setConversation] = useState<string>();
  const [showDemo, setShowDemo] = useState(false);
  const messageList = useRef<HTMLDivElement>(null);
  const history = useQuery({ queryKey: ["coach-conversations", token, versionId], queryFn: () => coach.conversations(token) });
  useEffect(() => {
    setMessages([]); setConversation(undefined);
  }, [versionId, sourceType, documentIds.join(","), writingPage]);
  useEffect(() => {
    if (!versionId) return;
    const found = history.data?.find(item => item.parent_id === versionId);
    if (found) setMessages(found.messages);
  }, [history.data, versionId]);
  const ask = useMutation({ mutationFn: (text: string) => versionId ? coach.askWriting(token, versionId, text) : coach.ask(token, text, { source_type: sourceType, document_ids: documentIds, conversation_id: conversation }),
    onSuccess: (value, text) => { setMessages(items => [...items, { ...value, query: text }]); if (value.conversation_id) setConversation(value.conversation_id); setQuery(""); history.refetch(); },
  });
  useEffect(() => {
    const list = messageList.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages, ask.isPending]);
  const noEssay = writingPage && !versionId;
  const submit = (event: FormEvent) => { event.preventDefault(); if (!ask.isPending && !noEssay && query.trim().length >= 2) ask.mutate(query.trim()); };
  const resourceHistory = history.data?.filter(c => !c.parent_id && (c.scope?.source_type ?? "all") === sourceType && JSON.stringify([...(c.scope?.document_ids ?? [])].sort()) === JSON.stringify([...documentIds].sort())) ?? [];
  return <section className="panel coach-tutor"><header className="coach-section-heading"><h2><BookOpen size={19} /> {writingPage ? "问问这篇作文" : "个人学习助手"}</h2><div className="tutor-header-actions"><button className="text-button" onClick={() => setShowDemo(true)}>离线示例</button>{onClose && <button className="coach-icon-button" aria-label="关闭学习助手" onClick={onClose}><X size={18} /></button>}</div></header>
    {!versionId && !!resourceHistory.length && <select aria-label="对话历史" value={conversation ?? ""} onChange={event => { const found = resourceHistory.find(c => c.id === event.target.value); setConversation(found?.id); setMessages(found?.messages ?? []); }}><option value="">新对话</option>{resourceHistory.map(c => <option key={c.id} value={c.id}>{c.messages[0]?.query.slice(0, 30) ?? "空对话"}</option>)}</select>}
    <div ref={messageList} className="coach-messages" aria-live="polite">{!messages.length && <div className="coach-chat-empty"><BookOpen size={32} />{noEssay ? <p>先选择稿件</p> : <div className="coach-prompts">{(versionId ? ["我应该先修改哪个问题？", "这次修改改善在哪里？"] : ["我的单词错误如何影响写作？", "怎样展开 Task 2 的论据？"]).map(text => <button onClick={() => setQuery(text)} key={text}>{text}<ChevronRight size={14} /></button>)}</div>}</div>}{messages.map((message, index) => <article key={index}><div className="coach-user-message">{message.query}</div><div className="coach-ai-message"><span className={`coach-chip ${message.mode}`}>{typeLabels[message.mode] ?? message.mode}</span>{message.generated_at && message.mode === "cache" && <small>{new Date(message.generated_at).toLocaleString()}</small>}<AnswerText text={message.answer} /><Sources items={message.citations} />{message.mode === "offline" && <button onClick={() => setShowDemo(true)}>打开离线示例</button>}</div></article>)}{ask.isPending && <div className="coach-thinking"><LoaderCircle className="spin" size={16} />正在思考…</div>}</div>
    <form className="coach-chat-input" onSubmit={submit}><input value={query} onChange={event => setQuery(event.target.value)} placeholder={writingPage ? "问问这篇作文…" : "输入问题…"} aria-label="学习问题" maxLength={2000} disabled={noEssay} /><button type="submit" className="primary-button" aria-label="发送问题" disabled={noEssay || ask.isPending || query.trim().length < 2}>{ask.isPending ? <LoaderCircle className="spin" size={18} /> : <Send size={18} />}</button></form>{ask.error && <p className="error-text">{ask.error.message}</p>}{showDemo && <DemoDialog token={token} onClose={() => setShowDemo(false)} />}
  </section>;
}
