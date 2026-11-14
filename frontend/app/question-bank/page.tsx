"use client";

import { useI18n, localizeError } from "@/lib/i18n";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, FilePlus2, LibraryBig, Pause, Play, RotateCcw, Search, XCircle } from "lucide-react";
import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";

import { PageHeader, SessionGate } from "../app-shell";
import { useDemoSession } from "../providers";
import { api, PracticeQuestionPreview, QuestionAttemptResult, Skill } from "@/lib/api";
import { skillLabels, skills } from "@/lib/ui";
import { SaveNoteButton } from "../resources/knowledge-editor";

const taskLabels: Record<string, string> = {
  matching: "ui.matching", matching_headings: "ui.matchingHeadings", speaking_part_1: "question.speakingPart1", true_false_not_given: "ui.trueFalseNotGiven", multiple_choice: "ui.singleChoice", sentence_completion: "ui.sentenceCompletion",
  form_completion: "ui.formCompletion", writing_task_1: "ui.writingTask1", writing_task_2: "ui.writingTask2",
  speaking_part_2: "ui.speakingPart2", speaking_part_3: "ui.speakingPart3",
};

export default function QuestionBankPage() {
  return <SessionGate><QuestionBankContent /></SessionGate>;
}

function QuestionBankContent() {
  const { t } = useI18n();
  const { token, user } = useDemoSession();
  const client = useQueryClient();
  const [module, setModule] = useState<Skill | undefined>();
  const [taskType, setTaskType] = useState("");
  const [incorrectOnly, setIncorrectOnly] = useState(false);
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [questionId, setQuestionId] = useState<string>();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [results, setResults] = useState<Record<string, QuestionAttemptResult>>({});
  const [transcripts, setTranscripts] = useState<Record<string, boolean>>({});
  const [playing, setPlaying] = useState<string | null>(null);
  const [playbackRate, setPlaybackRate] = useState("0.92");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requested = params.get("module") as Skill | null;
    if (requested && skills.includes(requested)) setModule(requested);
    if (params.get("review") === "wrong") setIncorrectOnly(true);
    if (params.get("question")) setQuestionId(params.get("question")!);
    return () => window.speechSynthesis?.cancel();
  }, []);

  useEffect(() => {
    if (user?.preferences.listening_rate) setPlaybackRate(String(user.preferences.listening_rate));
  }, [user?.preferences.listening_rate]);

  const questions = useQuery({ queryKey: ["practice-questions", token, module, search, incorrectOnly, taskType, questionId], queryFn: () => api.listQuestions(token!, module, search, incorrectOnly, taskType || undefined, questionId) });
  const progress = useQuery({ queryKey: ["question-progress", token], queryFn: () => api.questionBankProgress(token!) });
  const submitAttempt = useMutation({
    mutationFn: ({ questionId, answer }: { questionId: string; answer: string }) => api.submitQuestionAttempt(token!, questionId, answer),
    onSuccess: (result) => {
      setResults((current) => ({ ...current, [result.question_id]: result }));
      client.invalidateQueries({ queryKey: ["question-progress"] });
      client.invalidateQueries({ queryKey: ["practice-questions"] });
    },
  });
  const groups = useMemo(() => {
    const values = new Map<string, PracticeQuestionPreview[]>();
    for (const question of questions.data?.items ?? []) values.set(question.source_name, [...(values.get(question.source_name) ?? []), question]);
    for (const items of values.values()) {
      items.sort((left, right) => left.prompt.localeCompare(right.prompt, undefined, { numeric: true }));
    }
    return [...values.entries()];
  }, [questions.data]);

  const speak = (name: string, passage?: string) => {
    if (!passage || !("speechSynthesis" in window)) return;
    if (playing === name) { window.speechSynthesis.cancel(); setPlaying(null); return; }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(passage.replace(/^.*?:/gm, ""));
    utterance.lang = "en-GB"; utterance.rate = Number(playbackRate);
    utterance.onend = () => setPlaying(null); utterance.onerror = () => setPlaying(null);
    setPlaying(name); window.speechSynthesis.speak(utterance);
  };
  const submitSearch = (event: FormEvent) => { event.preventDefault(); setSearch(searchDraft.trim()); };

  return <main className="page">
    <PageHeader title={t("ui.questionBank")} action={<Link className="primary-button" href="/question-bank/new"><FilePlus2 size={17} />{t("ui.addQuestion")}</Link>} />
    {questionId && <div className="coach-version-tabs"><button onClick={() => setQuestionId(undefined)}>{t("ui.allQuestions")}</button><span className="coach-chip">{t("ui.fromYourKnowledgeLibrary")}</span></div>}
    <section className="practice-overview">
      <article><small>{t("ui.practiced2")}</small><strong>{progress.data?.attempted_questions ?? 0}</strong><span>{t("common.questionsOutOf", { count: progress.data?.total_questions ?? 0 })}</span></article>
      <article title={t("ui.basedOnTheLatestAttemptForEachQuestion")}><small>{t("ui.accuracy")}</small><strong>{progress.data?.attempted_questions ? Math.round(progress.data.accuracy * 100) : 0}%</strong></article>
      <article title={t("ui.removedAutomaticallyAfterACorrectAnswer")}><small>{t("ui.toReview2")}</small><strong>{progress.data?.incorrect_questions ?? 0}</strong></article>
    </section>
    <section className="bank-toolbar panel">
      <div><div className="mode-tabs"><button className={!incorrectOnly ? "active" : ""} onClick={() => setIncorrectOnly(false)}>{t("ui.allPractice")}</button><button className={incorrectOnly ? "active" : ""} onClick={() => setIncorrectOnly(true)}>{t("ui.reviewMistakes")}</button></div><div className="filter-tabs"><button className={!module ? "active" : ""} onClick={() => { setModule(undefined); setTaskType(""); }}>{t("ui.allSubjects")}</button>{skills.map((skill) => <button key={skill} className={module === skill ? "active" : ""} onClick={() => { setModule(skill); setTaskType(""); }}>{skillLabels[skill]}</button>)}</div></div>
      <select className="type-filter" aria-label={t("ui.filterByQuestionType")} value={taskType} onChange={(event) => setTaskType(event.target.value)}><option value="">{t("ui.allQuestionTypes")}</option>{Object.entries(taskLabels).map(([value, label]) => <option value={value} key={value}>{t(label)}</option>)}</select>
      <form onSubmit={submitSearch}><Search size={17} /><input value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder={t("ui.searchQuestionsOrKeywords")} /><button>{t("ui.search")}</button></form>
    </section>
    <div className="bank-summary"><span>{t("question.totalCount", { count: questions.data?.total ?? 0 })}</span></div>
    {questions.isLoading ? <div className="panel loading-state">{t("ui.loadingQuestions")}</div> : questions.error ? <div className="panel loading-state error-text">{t("common.errorLoading", { error: localizeError(questions.error.message) })}</div> : groups.length ? <div className="question-groups">{groups.map(([name, items]) => {
      const first = items[0]; const isListening = first.module === "listening"; const passage = first.passage;
      return <details className="question-set panel" key={name} open={questionId ? items.some(item => item.id === questionId) : undefined}>
        <summary className="set-header"><div><span className={`skill-tag ${first.module}`}>{skillLabels[first.module]}</span><h2>{name}</h2><p>{t("question.setSummary", { source: first.is_public ? t("ui.originalPracticeMaterial") : t("ui.myPrivateQuestions"), count: items.length })}</p></div></summary>{isListening && passage && <div className="audio-controls"><label>{t("ui.speed")}<select value={playbackRate} onChange={(event) => setPlaybackRate(event.target.value)}><option value="0.75">0.75×</option><option value="0.92">{t("ui.normal")}</option><option value="1.1">1.25×</option></select></label><button className="audio-button" onClick={() => speak(name, passage)}>{playing === name ? <Pause /> : <Play />}{playing === name ? t("ui.stopPlayback") : t("ui.playListeningPassage")}</button></div>}
        {isListening && passage && <div className="transcript-control"><button onClick={() => setTranscripts({ ...transcripts, [name]: !transcripts[name] })}>{transcripts[name] ? t("ui.hideTranscript") : t("ui.showTranscript")}</button>{transcripts[name] && <div className="transcript">{passage.split("\n").map((line, index) => <p key={index}>{line}</p>)}</div>}</div>}
        <div className={first.module === "reading" ? "practice-workspace" : ""}>{passage && !isListening && <article className="reading-passage"><h3>{t("ui.readingPassage")}</h3>{passage.split("\n\n").map((paragraph, index) => <p key={index}>{paragraph}</p>)}</article>}
        <div className="set-questions">{items.map((question) => {
          const result = results[question.id];
          return <article className={`question-item ${result ? result.is_correct ? "correct" : "incorrect" : ""}`} key={question.id}>
          <div className="question-kind"><span>{t(taskLabels[question.task_type] ?? question.task_type.replaceAll("_", " "))}</span>{question.tags.slice(0, 3).map((tag) => <small key={tag}>{tag}</small>)}{question.last_attempt_correct === true && <small className="history-correct">{t("ui.lastAnswerCorrect")}</small>}{question.last_attempt_correct === false && <small className="history-wrong">{t("ui.toReview2")}</small>}</div>
          <h3>{question.prompt}</h3><SaveNoteButton token={token!} source={{ source_type: "question", source_id: question.id }} title={question.prompt} text={[question.prompt, question.passage].filter(Boolean).join("\n")} />
          {question.options.length > 0 ? <div className={`answer-options ${user?.preferences.compact_question_options ? "compact" : ""}`}>{question.options.map((option, index) => <label className={answers[question.id] === option ? "selected" : ""} key={option}><input type="radio" name={`question-${question.id}`} value={option} checked={answers[question.id] === option} onChange={(event) => setAnswers({ ...answers, [question.id]: event.target.value })} /><b>{String.fromCharCode(65 + index)}</b><span>{option}</span></label>)}</div> : question.has_answer ? <input className="short-answer-input" aria-label={t("ui.enterYourAnswer")} value={answers[question.id] ?? ""} onChange={(event) => setAnswers({ ...answers, [question.id]: event.target.value })} placeholder={t("ui.enterYourAnswer")} /> : null}
          {question.has_answer ? <button className="submit-answer" disabled={!answers[question.id]?.trim() || (submitAttempt.isPending && submitAttempt.variables?.questionId === question.id)} onClick={() => submitAttempt.mutate({ questionId: question.id, answer: answers[question.id] })}>{submitAttempt.isPending && submitAttempt.variables?.questionId === question.id ? t("ui.checking") : result ? t("ui.submitAgain") : t("ui.submitAnswer")}</button> : <div className="manual-feedback-note">{question.module === "writing" ? <Link className="text-link" href="/writing">{t("ui.writingFeedback")}</Link> : <span className="coach-chip">{t("ui.recordAndSelfReview")}</span>}</div>}
          {result && <div className={`answer-result ${result.is_correct ? "correct" : "incorrect"}`}>{result.is_correct ? <CheckCircle2 /> : <XCircle />}<div><strong>{result.is_correct ? t("ui.correct") : t("ui.notQuiteRightYet")}</strong><p><b>{t("ui.yourAnswer")}</b>{result.submitted_answer}</p><p><b>{t("ui.suggestedAnswer")}</b>{result.correct_answer}</p>{result.explanation && <p><b>{t("ui.explanation")}</b>{result.explanation}</p>}{result.profile_updated && <p className="profile-update-note">{t("ui.profileUpdated")}</p>}{!result.is_correct && <button onClick={() => { setAnswers({ ...answers, [question.id]: "" }); setResults((current) => { const next = { ...current }; delete next[question.id]; return next; }); }}><RotateCcw />{t("ui.tryAgain")}</button>}</div></div>}
          {submitAttempt.isError && submitAttempt.variables?.questionId === question.id && <p className="error-text">{t("common.errorSubmitting", { error: localizeError(submitAttempt.error.message) })}</p>}
        </article>})}</div></div>
      </details>;
    })}</div> : <div className="panel empty-state"><LibraryBig /><h2>{t("ui.noMatchingQuestions")}</h2><Link className="primary-button" href="/question-bank/new">{t("ui.addQuestion")}</Link></div>}
  </main>;
}
