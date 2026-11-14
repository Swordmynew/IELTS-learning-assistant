"use client";

import { useI18n, translate, localizeError } from "@/lib/i18n";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Check, FilePlus2, LoaderCircle, MessageSquareText, Pencil, RefreshCw, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { coach, Issue, WritingVersion } from "@/lib/coach";
import { DemoDialog, Sources, typeLabels } from "../coach-components";
import { TutorScope } from "../floating-tutor";
import { AnnotatedEssay, type Annotation } from "./annotated-essay";
import { WritingWords } from "./writing-words";
import { SaveNoteButton } from "../resources/knowledge-editor";

const labels: Record<string, string> = { task_achievement: "ui.taskResponse", coherence_cohesion: "ui.coherenceAndCohesion", lexical_resource: "ui.lexicalResource", grammar_accuracy: "ui.grammarAndAccuracy", improved: "ui.improved", partial: "ui.partlyImproved", remaining: "ui.stillNeedsWork" };

function failureLabel(reason?: string) {
  if (reason?.startsWith("invalid_")) return translate("ui.responseValidationFailed");
  if (reason === "provider_timeout") return translate("ui.modelRequestTimedOut");
  if (reason === "offline") return translate("ui.offlineMode");
  if (reason === "provider_auth" || reason === "missing_credentials") return translate("ui.checkModelConfiguration");
  if (reason === "provider_unavailable") return translate("ui.modelConnectionFailed");
  return translate("ui.feedbackUnavailable");
}

function IssueCard({ token, version, issue }: { token: string; version: WritingVersion; issue: Issue }) {
  const { t } = useI18n();
  const [hint, setHint] = useState<{ text: string; mode: string }>();
  const request = useMutation({ mutationFn: (level: number) => coach.hint(token, version.id, issue.id, level), onSuccess: value => setHint({ text: value.data.text, mode: value.mode }) });
  return <article className="coach-issue"><header><strong>{t(labels[issue.criterion] ?? issue.criterion)}</strong></header><blockquote>{issue.quote}</blockquote><p>{issue.explanation}</p><div className="coach-goal"><ArrowRight size={15} /><span>{issue.goal}</span></div><div className="coach-hint-tabs">{[t("ui.think"), t("ui.guidance"), t("ui.example")].map((text, index) => <button key={text} disabled={request.isPending} onClick={() => request.mutate(index + 1)}>{text}</button>)}</div>{request.isPending && <LoaderCircle className="spin" size={16} />}{hint && <p className="coach-hint"><span className="coach-chip">{t(typeLabels[hint.mode] ?? "")}</span>{hint.text}</p>}{request.error && <p className="error-text">{localizeError(request.error.message)}</p>}</article>;
}

export function CoachWriter({ token }: { token: string }) {
  const { t, formatDate } = useI18n();
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
        id: `criterion-${item.criterion}-${index}`, criterion: item.criterion, label: t(labels[item.criterion] ?? ""), quote: e.quote,
        explanation: item.explanation, start: e.start, end: e.end,
      })) : [{ id: `criterion-${item.criterion}`, criterion: item.criterion, label: t(labels[item.criterion] ?? ""), quote: "", explanation: item.explanation }]),
      ...feedback.data.issues.map(issue => ({ id: `issue-${issue.id}`, criterion: issue.criterion, label: t("writing.criterionRevisionSuggestion", { value1: t(labels[issue.criterion]) }), quote: issue.quote, explanation: issue.explanation, issueId: issue.id })),
    ];
  }, [feedback, t]);
  const note = annotations.find(item => item.id === activeNote);
  useEffect(() => { setActiveNote(undefined); }, [selected?.id]);
  const selectNote = (id: string) => {
    setActiveNote(id);
    if (window.matchMedia("(max-width: 1000px)").matches) requestAnimationFrame(() => detailPanel.current?.scrollIntoView({ block: "start", behavior: "smooth" }));
  };
  const wordCount = (composing || !selected ? essay : selected.essay).trim().split(/\s+/).filter(Boolean).length;
  return <div className="coach-writing">
    <TutorScope versionId={selected?.id} />
    <header className="writer-header"><div><p className="eyebrow">{t("writing.eyebrow")}</p><h1>{t("ui.writingWorkspace")}</h1></div><div className="writer-header-actions"><button className="text-button" onClick={() => setDemo(true)}>{t("ui.offlineDemo")}</button><button className="secondary-button" disabled={busy} onClick={() => chooseSession("")}><FilePlus2 size={17} />{t("ui.newPractice")}</button></div></header>
    <div className="writer-navigation"><label>{t("ui.practice2")}<select aria-label={t("ui.selectWritingPractice")} value={sessionId} disabled={busy} onChange={event => chooseSession(event.target.value)}><option value="">{t("ui.newPracticeNotSubmitted")}</option>{sessions.data?.map((item, index) => <option key={item.id} value={item.id}>{index + 1}. {item.prompt}</option>)}</select></label>{!!versions.length && <nav className="writer-versions" aria-label={t("ui.draftVersions")}><span>{t("ui.draft")}</span>{versions.map((version, index) => <button key={version.id} disabled={busy} aria-pressed={selected?.id === version.id} className={selected?.id === version.id ? "active" : ""} onClick={() => { if (composing) drafts.current[sessionId] = { essay, prompt, composing, versionId: selected?.id ?? "" }; setVersionId(version.id); setEssay(""); setComposing(false); }}>{t("writing.version", { version: index + 1 })}{version.feedback && <Check size={12} />}</button>)}</nav>}</div>
    <div className="coach-writing-main">{demo && <DemoDialog token={token} onClose={() => setDemo(false)} />}
      <section className="panel coach-prompt"><small>{t("ui.question")}</small>{sessionId ? <h2>{current.data?.prompt ?? t("common.readingContent")}</h2> : <textarea value={prompt} onChange={event => setPrompt(event.target.value)} maxLength={4000} placeholder={t("ui.enterATask2Question")} aria-label={t("ui.task2Question")} />}</section>
      <div className="writer-workspace"><section className="panel writer-document">
        <header className="writer-document-heading"><span>{composing ? t("ui.revision") : selected ? t("ui.draftVValue", { value1: versions.findIndex(v => v.id === selected.id) + 1 }) : t("ui.firstDraft")}</span><div className="memory-document-tools"><small>{t("common.wordCount", { count: wordCount })}</small>{selected && !composing && <SaveNoteButton key={selected.id} token={token} source={{ source_type: "writing_version", source_id: selected.id }} title={current.data?.prompt ?? t("ui.essayExcerpt")} text={selected.essay} />}</div></header>
        {selected && !composing && <AnnotatedEssay key={selected.id} text={selected.essay} annotations={annotations} activeId={activeNote} onSelect={selectNote} />}
        {selected && composing && <details className="writer-original"><summary>{t("ui.compareWithOriginal")}</summary><p>{selected.essay}</p></details>}
        {(!selected || composing) && <textarea value={essay} onChange={event => setEssay(event.target.value)} className="writer-essay-input" aria-label={t("ui.essayEditor")} maxLength={20000} placeholder={selected ? t("ui.reviseYourEssay") : t("ui.startWriting")} autoFocus={composing} />}
        <footer className="writer-document-actions">{selected && !composing ? <button className="primary-button" disabled={busy} onClick={() => { setEssay(drafts.current[sessionId]?.versionId === selected.id ? drafts.current[sessionId].essay : selected.essay); setComposing(true); }}><Pencil size={16} />{t("ui.continueRevising")}</button> : <>{selected && <button className="text-button" disabled={busy} onClick={() => { drafts.current[sessionId] = { essay, prompt, composing: true, versionId: selected.id }; setComposing(false); }}>{t("ui.backToAnnotations")}</button>}<button className="primary-button" disabled={busy || essay.trim().length < 20 || (!sessionId && prompt.trim().length < 20)} onClick={() => submit.mutate()}>{busy ? <LoaderCircle className="spin" size={17} /> : <ArrowRight size={17} />}{busy ? t("ui.analyzing") : selected ? t("ui.submitRevision") : t("ui.submitFirstDraft")}</button></>}</footer>
        {(error || current.error || sessions.error) && <p className="error-text">{localizeError(error || current.error?.message || sessions.error?.message || "")}</p>}
      </section><aside className="writer-review">
        {feedback ? <><section className="panel writer-score"><header><h2>{t("ui.essayOverview")}</h2><span className={`coach-chip ${feedback.mode}`}>{t(typeLabels[feedback.mode] ?? "")}</span></header><div className="writer-overall"><strong>{feedback.data.assessment.estimated_overall_band}</strong><span>{t("ui.estimatedBand")}</span></div><div className="writer-criterion-scores">{feedback.data.assessment.criteria.map(item => <button key={item.criterion} data-criterion={item.criterion} aria-label={t("writing.viewCriterionAnnotations", { value1: t(labels[item.criterion]) })} className={note?.criterion === item.criterion ? "active" : ""} onClick={() => selectNote(annotations.find(annotation => annotation.criterion === item.criterion)!.id)}><span>{t(labels[item.criterion] ?? "")}</span><b>{item.band}</b></button>)}</div></section>
        <section ref={detailPanel} className="panel writer-note-detail" id="writing-annotation-detail" data-criterion={note?.criterion} aria-label={t("ui.annotationDetails")} aria-live="polite"><header><h2><MessageSquareText size={17} />{note ? note.label : t("ui.essayAnnotations")}</h2>{note && <button className="coach-icon-button" aria-label={t("ui.closeAnnotation")} onClick={() => setActiveNote(undefined)}><X size={16} /></button>}</header>{note ? <>{note.issueId ? <IssueCard key={`${selected.id}:${note.id}`} token={token} version={selected} issue={feedback.data.issues.find(issue => issue.id === note.issueId)!} /> : <div className="writer-note-copy">{note.quote && <blockquote>{note.quote}</blockquote>}<p>{note.explanation}</p></div>}<nav className="writer-note-navigation" aria-label={t("ui.browseAnnotations")}>{annotations.map((item, index) => <button key={item.id} data-criterion={item.criterion} className={note.id === item.id ? "active" : ""} aria-label={t("ui.viewAnnotationValue", { value1: index + 1 })} onClick={() => selectNote(item.id)}>{index + 1}</button>)}</nav></> : <div className="writer-note-empty"><MessageSquareText size={26} /><p>{t("ui.selectAnEssayAnnotation")}</p></div>}</section>
        <section className="panel writer-review-details">
          {!!feedback.data.improvements.length && <details className="coach-improvements"><summary>{t("ui.revisionComparison")}<span className="coach-chip">{feedback.data.improvements.length}</span></summary>{feedback.data.improvements.map(item => <article key={item.issue_id}><span className={`coach-chip ${item.status}`}>{t(labels[item.status] ?? "")}</span><div className="coach-quote-comparison"><del>{item.old_quote}</del><ins>{item.new_quote}</ins></div><p>{item.explanation}</p></article>)}</details>}

          {feedback.data.personal_note && <aside className="coach-personal-note"><span className="coach-chip">{t("ui.personalLearningRecord")}</span><p>{feedback.data.personal_note}</p><Sources items={feedback.citations ?? []} /></aside>}
          <details className="coach-assessment-sources"><summary>{t("ui.assessmentSourcesAndHistory")}</summary><p className="coach-feedback-meta">{feedback.model} · {formatDate(feedback.generated_at, { dateStyle: "medium", timeStyle: "short" })}</p><Sources items={feedback.data.assessment.criteria.flatMap(item => item.citations).filter((item, index, all) => all.findIndex(other => other.title === item.title) === index).map(item => ({ ...item, source_id: item.title, source_type: "public" }))} /></details>
        </section></> : <div className="panel coach-empty">{selected?.status === "unavailable" ? <><RefreshCw size={32} /><h3>{t("ui.draftSaved")}</h3><span className="coach-chip offline">{failureLabel(selected.failure_reason)}</span>{selected.failure_message && <p role="status">{localizeError(selected.failure_message)}</p>}<div className="coach-empty-actions"><button disabled={busy} onClick={() => retry.mutate()}>{t("ui.retryFeedback")}</button><button onClick={() => setDemo(true)}>{t("ui.openOfflineDemo")}</button></div></> : selected ? <><h3>{t("ui.draftAwaitingAnalysis")}</h3><button onClick={() => retry.mutate()} disabled={busy}>{t("ui.getFeedback")}</button></> : <><FilePlus2 size={36} /><h3>{t("ui.awaitingFeedback")}</h3></>}</div>}
      </aside></div>{selected && <><WritingWords key={`words:${selected.id}`} token={token} sourceId={selected.id} /></>}
    </div>
  </div>;
}
