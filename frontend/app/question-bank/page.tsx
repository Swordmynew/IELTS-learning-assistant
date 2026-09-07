"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, FilePlus2, Headphones, LibraryBig, Pause, Play, RotateCcw, Search, XCircle } from "lucide-react";
import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";

import { PageHeader, SessionGate } from "../app-shell";
import { useDemoSession } from "../providers";
import { api, PracticeQuestionPreview, QuestionAttemptResult, Skill } from "@/lib/api";
import { skillLabels, skills } from "@/lib/ui";

const taskLabels: Record<string, string> = {
  true_false_not_given: "判断题", multiple_choice: "单项选择", sentence_completion: "句子填空",
  form_completion: "表格填空", writing_task_1: "写作 Task 1", writing_task_2: "写作 Task 2",
  speaking_part_2: "口语 Part 2", speaking_part_3: "口语 Part 3",
};

export default function QuestionBankPage() {
  return <SessionGate><QuestionBankContent /></SessionGate>;
}

function QuestionBankContent() {
  const { token, user } = useDemoSession();
  const client = useQueryClient();
  const [module, setModule] = useState<Skill | undefined>();
  const [taskType, setTaskType] = useState("");
  const [incorrectOnly, setIncorrectOnly] = useState(false);
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
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
    return () => window.speechSynthesis?.cancel();
  }, []);

  useEffect(() => {
    if (user?.preferences.listening_rate) setPlaybackRate(String(user.preferences.listening_rate));
  }, [user?.preferences.listening_rate]);

  const questions = useQuery({ queryKey: ["practice-questions", token, module, search, incorrectOnly, taskType], queryFn: () => api.listQuestions(token!, module, search, incorrectOnly, taskType || undefined) });
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
    <PageHeader eyebrow="练习题库" title="按套题进入练习场景" description="内置内容是项目原创的 IELTS 题型仿真练习；你也可以通过表单录入自己合法持有的题目。" action={<Link className="primary-button" href="/question-bank/new"><FilePlus2 size={17} />录入新题</Link>} />
    <section className="practice-overview">
      <article><small>已练习</small><strong>{progress.data?.attempted_questions ?? 0}</strong><span>/ {progress.data?.total_questions ?? 0} 题</span></article>
      <article><small>当前正确率</small><strong>{progress.data?.attempted_questions ? Math.round(progress.data.accuracy * 100) : 0}%</strong><span>按每题最近一次作答</span></article>
      <article><small>待复习错题</small><strong>{progress.data?.incorrect_questions ?? 0}</strong><span>答对后自动移出</span></article>
      <article><small>学习闭环</small><strong>练 · 析 · 改</strong><span>提交后立即查看解析</span></article>
    </section>
    <section className="bank-toolbar panel">
      <div><div className="mode-tabs"><button className={!incorrectOnly ? "active" : ""} onClick={() => setIncorrectOnly(false)}>全部练习</button><button className={incorrectOnly ? "active" : ""} onClick={() => setIncorrectOnly(true)}>错题复习</button></div><div className="filter-tabs"><button className={!module ? "active" : ""} onClick={() => { setModule(undefined); setTaskType(""); }}>全部科目</button>{skills.map((skill) => <button key={skill} className={module === skill ? "active" : ""} onClick={() => { setModule(skill); setTaskType(""); }}>{skillLabels[skill]}</button>)}</div></div>
      <select className="type-filter" aria-label="按题型筛选" value={taskType} onChange={(event) => setTaskType(event.target.value)}><option value="">全部题型</option>{Object.entries(taskLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>
      <form onSubmit={submitSearch}><Search size={17} /><input value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder="搜索题目或关键词" /><button>搜索</button></form>
    </section>
    <div className="bank-summary"><span>共 {questions.data?.total ?? 0} 道题</span><span>答案默认隐藏 · 私人题目仅自己可见</span></div>
    {questions.isLoading ? <div className="panel loading-state">正在载入题库…</div> : questions.error ? <div className="panel loading-state error-text">载入失败：{questions.error.message}</div> : groups.length ? <div className="question-groups">{groups.map(([name, items]) => {
      const first = items[0]; const isListening = first.module === "listening"; const passage = first.passage;
      return <section className="question-set panel" key={name}>
        <header className="set-header"><div><span className={`skill-tag ${first.module}`}>{skillLabels[first.module]}</span><h2>{name}</h2><p>{first.is_public ? "项目原创仿真练习" : "我的私人题目"} · {items.length} 题</p></div>{isListening && passage && <div className="audio-controls"><label>速度<select value={playbackRate} onChange={(event) => setPlaybackRate(event.target.value)}><option value="0.75">0.75×</option><option value="0.92">正常</option><option value="1.1">1.25×</option></select></label><button className="audio-button" onClick={() => speak(name, passage)}>{playing === name ? <Pause /> : <Play />}{playing === name ? "停止播放" : "播放听力材料"}</button></div>}</header>
        {isListening && <div className="listening-note"><Headphones /><p>建议只播放一次或两次后作答。浏览器语音仅用于功能演示，不是 IELTS 官方或真人考试录音。</p></div>}
        {isListening && passage && <div className="transcript-control"><button onClick={() => setTranscripts({ ...transcripts, [name]: !transcripts[name] })}>{transcripts[name] ? "隐藏听力原文" : "练习后查看听力原文"}</button>{transcripts[name] && <div className="transcript">{passage.split("\n").map((line, index) => <p key={index}>{line}</p>)}</div>}</div>}
        <div className={first.module === "reading" ? "practice-workspace" : ""}>{passage && !isListening && <article className="reading-passage"><h3>阅读材料</h3>{passage.split("\n\n").map((paragraph, index) => <p key={index}>{paragraph}</p>)}</article>}
        <div className="set-questions">{items.map((question) => {
          const result = results[question.id];
          return <article className={`question-item ${result ? result.is_correct ? "correct" : "incorrect" : ""}`} key={question.id}>
          <div className="question-kind"><span>{taskLabels[question.task_type] ?? question.task_type.replaceAll("_", " ")}</span>{question.tags.slice(0, 3).map((tag) => <small key={tag}>{tag}</small>)}{question.last_attempt_correct === true && <small className="history-correct">上次答对</small>}{question.last_attempt_correct === false && <small className="history-wrong">待复习</small>}</div>
          <h3>{question.prompt}</h3>
          {question.options.length > 0 ? <div className={`answer-options ${user?.preferences.compact_question_options ? "compact" : ""}`}>{question.options.map((option, index) => <label className={answers[question.id] === option ? "selected" : ""} key={option}><input type="radio" name={`question-${question.id}`} value={option} checked={answers[question.id] === option} onChange={(event) => setAnswers({ ...answers, [question.id]: event.target.value })} /><b>{String.fromCharCode(65 + index)}</b><span>{option}</span></label>)}</div> : question.has_answer ? <input className="short-answer-input" aria-label="输入答案" value={answers[question.id] ?? ""} onChange={(event) => setAnswers({ ...answers, [question.id]: event.target.value })} placeholder="输入答案" /> : null}
          {question.has_answer ? <button className="submit-answer" disabled={!answers[question.id]?.trim() || (submitAttempt.isPending && submitAttempt.variables?.questionId === question.id)} onClick={() => submitAttempt.mutate({ questionId: question.id, answer: answers[question.id] })}>{submitAttempt.isPending && submitAttempt.variables?.questionId === question.id ? "正在批改…" : result ? "再次提交" : "提交答案"}</button> : <p className="manual-feedback-note">这类开放题不适合自动判分，请前往{question.module === "writing" ? "写作反馈" : "自行录音复盘"}。</p>}
          {result && <div className={`answer-result ${result.is_correct ? "correct" : "incorrect"}`}>{result.is_correct ? <CheckCircle2 /> : <XCircle />}<div><strong>{result.is_correct ? "回答正确" : "这次还没有答对"}</strong><p><b>你的答案：</b>{result.submitted_answer}</p><p><b>参考答案：</b>{result.correct_answer}</p>{result.explanation && <p><b>解析：</b>{result.explanation}</p>}{result.profile_updated && <p className="profile-update-note">这次结果已记入学习档案，重新生成计划时会用于调整科目优先级。</p>}{!result.is_correct && <button onClick={() => { setAnswers({ ...answers, [question.id]: "" }); setResults((current) => { const next = { ...current }; delete next[question.id]; return next; }); }}><RotateCcw />再做一次</button>}</div></div>}
          {submitAttempt.isError && submitAttempt.variables?.questionId === question.id && <p className="error-text">提交失败：{submitAttempt.error.message}</p>}
        </article>})}</div></div>
      </section>;
    })}</div> : <div className="panel empty-state"><LibraryBig /><h2>没有匹配的题目</h2><p>调整筛选条件，或录入你自己的练习题。</p><Link className="primary-button" href="/question-bank/new">录入新题</Link></div>}
  </main>;
}
