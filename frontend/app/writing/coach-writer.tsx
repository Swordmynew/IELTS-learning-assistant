"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Check, FilePlus2, LoaderCircle, MessageSquareText, Pencil, RefreshCw, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { coach, Issue, WritingVersion } from "@/lib/coach";
import { DemoDialog, Sources, typeLabels } from "../coach-components";
import { TutorScope } from "../floating-tutor";
import { AnnotatedEssay, type Annotation } from "./annotated-essay";
import { WritingWords } from "./writing-words";
import { SaveNoteButton } from "../resources/knowledge-editor";

const labels: Record<string, string> = { task_achievement: "任务回应", coherence_cohesion: "连贯与衔接", lexical_resource: "词汇资源", grammar_accuracy: "语法与准确性", improved: "已改善", partial: "部分改善", remaining: "仍存在" };

function IssueCard({ token, version, issue }: { token: string; version: WritingVersion; issue: Issue }) {
  const [hint, setHint] = useState<{ text: string; mode: string }>();
  const request = useMutation({ mutationFn: (level: number) => coach.hint(token, version.id, issue.id, level), onSuccess: value => setHint({ text: value.data.text, mode: value.mode }) });
  return <article className="coach-issue"><header><strong>{labels[issue.criterion] ?? issue.criterion}</strong></header><blockquote>{issue.quote}</blockquote><p>{issue.explanation}</p><div className="coach-goal"><ArrowRight size={15} /><span>{issue.goal}</span></div><div className="coach-hint-tabs">{["思考", "方向", "示例"].map((text, index) => <button key={text} disabled={request.isPending} onClick={() => request.mutate(index + 1)}>{text}</button>)}</div>{request.isPending && <LoaderCircle className="spin" size={16} />}{hint && <p className="coach-hint"><span className="coach-chip">{typeLabels[hint.mode]}</span>{hint.text}</p>}{request.error && <p className="error-text">{request.error.message}</p>}</article>;
}

export function CoachWriter({ token }: { token: string }) {
  const client = useQueryClient();
  const sessions = useQuery({ queryKey: ["writing-sessions", token], queryFn: () => coach.sessions(token) });
  const [sessionId, setSessionId] = useState("");
  const [versionId, setVersionId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [essay, setEssay] = useState("");
  const [composing, setComposing] = useState(false);
  const [demo, setDemo] = useState(false);
  const [error, setError] = useState("");
  const [activeNote, setActiveNote] = useState<string>();
  const detailPanel = useRef<HTMLDivElement>(null);
  const drafts = useRef<Record<string, { essay: string; prompt: string; composing: boolean; versionId: string }>>({});
  const initialized = useRef(false);
  const current = useQuery({ queryKey: ["writing-session", token, sessionId], queryFn: () => coach.session(token, sessionId), enabled: !!sessionId });
  const versions = current.data?.versions ?? [];
  const selected = versions.find(v => v.id === versionId) ?? versions[versions.length - 1];
  useEffect(() => {
    if (initialized.current || !sessions.data) return;
    initialized.current = true;
    const params = new URLSearchParams(window.location.search);
    if (params.get("session")) { setSessionId(params.get("session")!); setVersionId(params.get("version") ?? ""); }
    else if (sessions.data?.length) setSessionId(sessions.data[0].id);
  }, [sessions.data]);
  const submit = useMutation({ mutationFn: async () => {
    setError("");
    const writing = sessionId ? current.data! : await coach.create(token, prompt);
    setSessionId(writing.id);
    const version = await coach.submit(token, writing.id, essay);
    setVersionId(version.id);
    client.invalidateQueries({ queryKey: ["writing-session"] });
    client.invalidateQueries({ queryKey: ["writing-sessions"] });
    return coach.assess(token, version.id);
  }, onSuccess: () => { delete drafts.current[sessionId]; setEssay(""); setComposing(false); client.invalidateQueries({ queryKey: ["writing-session"] }); client.invalidateQueries({ queryKey: ["personal-knowledge"] }); client.invalidateQueries({ queryKey: ["dashboard"] }); }, onError: (reason: Error) => setError(reason.message) });
  const retry = useMutation({ mutationFn: () => coach.assess(token, selected!.id), onSuccess: () => client.invalidateQueries({ queryKey: ["writing-session"] }), onError: (reason: Error) => setError(reason.message) });
  const feedback = selected?.feedback;
  const busy = submit.isPending || retry.isPending || (!!sessionId && current.isPending);
  const chooseSession = (id: string) => {
    drafts.current[sessionId] = { essay, prompt, composing, versionId: selected?.id ?? "" };
    const draft = drafts.current[id];
    setSessionId(id); setVersionId(draft?.versionId ?? ""); setEssay(draft?.essay ?? ""); setPrompt(draft?.prompt ?? ""); setComposing(draft?.composing ?? false); setError("");
  };
  const annotations = useMemo<Annotation[]>(() => {
    if (!feedback) return [];
    return [
      ...feedback.data.assessment.criteria.flatMap(item => item.evidence.length ? item.evidence.map((e, index) => ({
        id: `criterion-${item.criterion}-${index}`, criterion: item.criterion, label: labels[item.criterion], quote: e.quote,
        explanation: item.explanation, start: e.start, end: e.end,
      })) : [{ id: `criterion-${item.criterion}`, criterion: item.criterion, label: labels[item.criterion], quote: "", explanation: item.explanation }]),
      ...feedback.data.issues.map(issue => ({ id: `issue-${issue.id}`, criterion: issue.criterion, label: `${labels[issue.criterion]} · 修改建议`, quote: issue.quote, explanation: issue.explanation, issueId: issue.id })),
    ];
  }, [feedback]);
  const note = annotations.find(item => item.id === activeNote);
  useEffect(() => { setActiveNote(undefined); }, [selected?.id]);
  const selectNote = (id: string) => {
    setActiveNote(id);
    if (window.matchMedia("(max-width: 1000px)").matches) requestAnimationFrame(() => detailPanel.current?.scrollIntoView({ block: "start", behavior: "smooth" }));
  };
  const wordCount = (composing || !selected ? essay : selected.essay).trim().split(/\s+/).filter(Boolean).length;
  return <div className="coach-writing">
    <TutorScope versionId={selected?.id} />
    <header className="writer-header"><div><p className="eyebrow">WRITING · TASK 2</p><h1>写作工作台</h1></div><div className="writer-header-actions"><button className="text-button" onClick={() => setDemo(true)}>离线示例</button><button className="secondary-button" disabled={busy} onClick={() => chooseSession("")}><FilePlus2 size={17} />新练习</button></div></header>
    <div className="writer-navigation"><label>练习<select aria-label="选择写作练习" value={sessionId} disabled={busy} onChange={event => chooseSession(event.target.value)}><option value="">新练习 · 未提交</option>{sessions.data?.map((item, index) => <option key={item.id} value={item.id}>{index + 1}. {item.prompt}</option>)}</select></label>{!!versions.length && <nav className="writer-versions" aria-label="稿件版本"><span>稿件</span>{versions.map((version, index) => <button key={version.id} disabled={busy} aria-pressed={selected?.id === version.id} className={selected?.id === version.id ? "active" : ""} onClick={() => { if (composing) drafts.current[sessionId] = { essay, prompt, composing, versionId: selected?.id ?? "" }; setVersionId(version.id); setEssay(""); setComposing(false); }}>V{index + 1}{version.feedback && <Check size={12} />}</button>)}</nav>}</div>
    <div className="coach-writing-main">{demo && <DemoDialog token={token} onClose={() => setDemo(false)} />}
      <section className="panel coach-prompt"><small>题目</small>{sessionId ? <h2>{current.data?.prompt ?? "正在读取…"}</h2> : <textarea value={prompt} onChange={event => setPrompt(event.target.value)} maxLength={4000} placeholder="输入 Task 2 题目…" aria-label="Task 2 题目" />}</section>
      <div className="writer-workspace"><section className="panel writer-document">
        <header className="writer-document-heading"><span>{composing ? "修改稿" : selected ? `稿件 V${versions.findIndex(v => v.id === selected.id) + 1}` : "初稿"}</span><div className="memory-document-tools"><small>{wordCount} words</small>{selected && !composing && <SaveNoteButton key={selected.id} token={token} source={{ source_type: "writing_version", source_id: selected.id }} title={current.data?.prompt ?? "作文摘录"} text={selected.essay} />}</div></header>
        {selected && !composing && <AnnotatedEssay key={selected.id} text={selected.essay} annotations={annotations} activeId={activeNote} onSelect={selectNote} />}
        {selected && composing && <details className="writer-original"><summary>对照原稿</summary><p>{selected.essay}</p></details>}
        {(!selected || composing) && <textarea value={essay} onChange={event => setEssay(event.target.value)} className="writer-essay-input" aria-label="作文编辑区" maxLength={20000} placeholder={selected ? "修改你的作文…" : "开始写作…"} autoFocus={composing} />}
        <footer className="writer-document-actions">{selected && !composing ? <button className="primary-button" disabled={busy} onClick={() => { setEssay(drafts.current[sessionId]?.versionId === selected.id ? drafts.current[sessionId].essay : selected.essay); setComposing(true); }}><Pencil size={16} />继续修改</button> : <>{selected && <button className="text-button" disabled={busy} onClick={() => { drafts.current[sessionId] = { essay, prompt, composing: true, versionId: selected.id }; setComposing(false); }}>返回批注</button>}<button className="primary-button" disabled={busy || essay.trim().length < 20 || (!sessionId && prompt.trim().length < 20)} onClick={() => submit.mutate()}>{busy ? <LoaderCircle className="spin" size={17} /> : <ArrowRight size={17} />}{busy ? "分析中…" : selected ? "提交修改稿" : "提交初稿"}</button></>}</footer>
        {(error || current.error || sessions.error) && <p className="error-text">{error || current.error?.message || sessions.error?.message}</p>}
      </section><aside className="writer-review">
        {feedback ? <><section className="panel writer-score"><header><h2>文章总览</h2><span className={`coach-chip ${feedback.mode}`}>{typeLabels[feedback.mode]}</span></header><div className="writer-overall"><strong>{feedback.data.assessment.estimated_overall_band}</strong><span>学习估分</span></div><div className="writer-criterion-scores">{feedback.data.assessment.criteria.map(item => <button key={item.criterion} data-criterion={item.criterion} aria-label={`查看${labels[item.criterion]}批注`} className={note?.criterion === item.criterion ? "active" : ""} onClick={() => selectNote(annotations.find(annotation => annotation.criterion === item.criterion)!.id)}><span>{labels[item.criterion]}</span><b>{item.band}</b></button>)}</div></section>
        <section ref={detailPanel} className="panel writer-note-detail" id="writing-annotation-detail" data-criterion={note?.criterion} aria-label="批注详情" aria-live="polite"><header><h2><MessageSquareText size={17} />{note ? note.label : "正文批注"}</h2>{note && <button className="coach-icon-button" aria-label="收起批注" onClick={() => setActiveNote(undefined)}><X size={16} /></button>}</header>{note ? <>{note.issueId ? <IssueCard key={`${selected.id}:${note.id}`} token={token} version={selected} issue={feedback.data.issues.find(issue => issue.id === note.issueId)!} /> : <div className="writer-note-copy">{note.quote && <blockquote>{note.quote}</blockquote>}<p>{note.explanation}</p></div>}<nav className="writer-note-navigation" aria-label="切换批注">{annotations.map((item, index) => <button key={item.id} data-criterion={item.criterion} className={note.id === item.id ? "active" : ""} aria-label={`查看批注 ${index + 1}`} onClick={() => selectNote(item.id)}>{index + 1}</button>)}</nav></> : <div className="writer-note-empty"><MessageSquareText size={26} /><p>选择正文批注</p></div>}</section>
        <section className="panel writer-review-details">
          {!!feedback.data.improvements.length && <details className="coach-improvements"><summary>修改对照 <span className="coach-chip">{feedback.data.improvements.length}</span></summary>{feedback.data.improvements.map(item => <article key={item.issue_id}><span className={`coach-chip ${item.status}`}>{labels[item.status]}</span><div className="coach-quote-comparison"><del>{item.old_quote}</del><ins>{item.new_quote}</ins></div><p>{item.explanation}</p></article>)}</details>}

          {feedback.data.personal_note && <aside className="coach-personal-note"><span className="coach-chip">个人学习记录</span><p>{feedback.data.personal_note}</p><Sources items={feedback.citations ?? []} /></aside>}
          <details className="coach-assessment-sources"><summary>评分依据与记录</summary><p className="coach-feedback-meta">{feedback.model} · {new Date(feedback.generated_at).toLocaleString()}</p><Sources items={feedback.data.assessment.criteria.flatMap(item => item.citations).filter((item, index, all) => all.findIndex(other => other.title === item.title) === index).map(item => ({ ...item, source_id: item.title, source_type: "public" }))} /></details>
        </section></> : <div className="panel coach-empty">{selected?.status === "unavailable" ? <><RefreshCw size={32} /><h3>稿件已保存</h3><span className="coach-chip offline">模型暂不可用</span><div className="coach-empty-actions"><button disabled={busy} onClick={() => retry.mutate()}>重试反馈</button><button onClick={() => setDemo(true)}>打开离线示例</button></div></> : selected ? <><h3>稿件待分析</h3><button onClick={() => retry.mutate()} disabled={busy}>获取反馈</button></> : <><FilePlus2 size={36} /><h3>等待批改</h3></>}</div>}
      </aside></div>{selected && <><WritingWords key={`words:${selected.id}`} token={token} sourceId={selected.id} /></>}
    </div>
  </div>;
}
