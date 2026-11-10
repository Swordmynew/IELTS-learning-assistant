"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, FilePenLine, LoaderCircle, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";

import { PageHeader, SessionGate } from "../app-shell";
import { useDemoSession } from "../providers";
import { api, WritingAssessment } from "@/lib/api";
import { CoachWriter } from "./coach-writer";
import { coach } from "@/lib/coach";
import { WritingWords } from "./writing-words";
import "./writer.css";

const criterionLabels: Record<string, string> = { task_achievement: "任务回应", coherence_cohesion: "连贯与衔接", lexical_resource: "词汇资源", grammar_accuracy: "语法范围与准确性" };
const sampleEssay = `Some people believe that university education should be free for everyone. I partly agree with this view because education benefits society, but unlimited free access may place too much pressure on public budgets.

First, affordable higher education can improve social mobility. Talented students from low-income families are more likely to develop professional skills when tuition is not a barrier. Society also benefits from having more qualified teachers, engineers and health workers.

However, making every course completely free may be inefficient. Governments have limited resources and must also fund schools, hospitals and transport. A balanced policy would provide grants for students in need while asking wealthier families to contribute.

In conclusion, public support for university is important, but targeted financial assistance is fairer and more sustainable than free tuition for all.`;

export default function WritingPage() {
  return <SessionGate><WritingWorkspace /></SessionGate>;
}

function WritingWorkspace() {
  const { token } = useDemoSession();
  const [legacy, setLegacy] = useState(false);
  useEffect(() => { if (new URLSearchParams(window.location.search).get("assessment")) setLegacy(true); }, []);
  return <><div className="page coach-writing-switch"><div className="writer-mode-switch"><span>写作模式</span><div className="coach-version-tabs"><button className={!legacy ? "active" : ""} onClick={() => setLegacy(false)}>Task 2 · 多稿练习</button><button className={legacy ? "active" : ""} onClick={() => setLegacy(true)}>单次批改</button></div></div></div>{legacy ? <WritingContent /> : <main className="page writing-page"><CoachWriter token={token!} /></main>}</>;
}

function WritingContent() {
  const { token } = useDemoSession();
  const client = useQueryClient();
  const dashboard = useQuery({ queryKey: ["dashboard", token], queryFn: () => api.dashboard(token!) });
  const [taskType, setTaskType] = useState("writing_task_1");
  const [prompt, setPrompt] = useState("University education should be free for everyone. To what extent do you agree or disagree?");
  const [essay, setEssay] = useState(sampleEssay);
  const [result, setResult] = useState<WritingAssessment | null>(null);
  const [assessmentId, setAssessmentId] = useState("");
  useEffect(() => { setAssessmentId(new URLSearchParams(window.location.search).get("assessment") ?? ""); }, []);
  const historical = useQuery({ queryKey: ["historical-assessment", token, assessmentId], queryFn: () => coach.legacyAssessment(token!, assessmentId), enabled: !!assessmentId });
  useEffect(() => {
    if (historical.data) { setTaskType(historical.data.submission.task_type); setPrompt(historical.data.submission.prompt); setEssay(historical.data.submission.essay); setResult(historical.data.assessment); }
  }, [historical.data]);
  const assess = useMutation({
    mutationFn: () => api.assessWriting(token!, { task_type: taskType, prompt, essay }),
    onSuccess: (value) => { setResult(value); client.invalidateQueries({ queryKey: ["dashboard"] }); },
  });
  const assessment = result ?? dashboard.data?.latest_assessment;
  const words = essay.trim() ? essay.trim().split(/\s+/).length : 0;

  return <main className="page writing-page">
    <PageHeader title="单次批改" />
    <div className="writing-layout">
      <section className="panel writing-editor">
        <div className="editor-heading"><FilePenLine /><div><h2>提交作文</h2></div></div>
        <label className="field">题型<select value={taskType} onChange={(event) => setTaskType(event.target.value)}><option value="writing_task_1">Academic Writing Task 1</option><option value="writing_task_2">Writing Task 2</option></select></label>
        <label className="field">题目<textarea className="short-textarea" value={prompt} onChange={(event) => setPrompt(event.target.value)} /></label>
        <label className="field">作文<textarea className="essay-input" value={essay} onChange={(event) => setEssay(event.target.value)} /></label>
        <div className="editor-footer"><span>{words} words</span><button className="primary-button" onClick={() => assess.mutate()} disabled={assess.isPending || prompt.length < 20 || essay.length < 20}>{assess.isPending ? <LoaderCircle className="spin" /> : <Sparkles />}{assess.isPending ? "正在分析…" : "获取写作反馈"}</button></div>
        {assess.error && <p className="error-text">评分失败：{assess.error.message}</p>}
      </section>
      <section className="panel assessment-panel">
        {assessment ? <><div className="assessment-head"><div><p className="eyebrow">写作估分</p><strong>{assessment.estimated_overall_band}</strong><span>模型：{assessment.model_used}</span></div></div>
          <div className="criteria-grid">{assessment.criteria.map((item) => <article key={item.criterion}><div><span>{criterionLabels[item.criterion]}</span><strong>{item.band}</strong></div><p>{item.explanation}</p>{item.evidence[0] && <blockquote>“{item.evidence[0].quote}”</blockquote>}{item.citations[0] && <a href={item.citations[0].url} target="_blank">查看评分依据 <ExternalLink size={13} /></a>}</article>)}</div>
          <div className="feedback-section"><h3>优先修改</h3><ol>{assessment.top_priorities.map((item) => <li key={item}>{item}</li>)}</ol></div>
          <details className="feedback-section"><summary>局部改写示例</summary><p>{assessment.rewrite_example}</p></details>
          <div className="next-exercise"><strong>下一步练习</strong><p>{assessment.next_exercise}</p></div>
        </> : <div className="empty-state"><Sparkles /><h2>等待批改</h2></div>}
      </section>
    </div>{assessment && <WritingWords token={token!} sourceId={assessment.id} sourceKind="assessment" />}
  </main>;
}
