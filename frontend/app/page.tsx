"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowRight, BookOpenCheck, CalendarDays, CheckCircle2, FilePenLine, Target } from "lucide-react";
import Link from "next/link";

import { PageHeader, SessionGate } from "./app-shell";
import { useDemoSession } from "./providers";
import { api } from "@/lib/api";
import { formatDate, skillLabels, skillRoutes } from "@/lib/ui";

export default function DashboardPage() {
  return <SessionGate><DashboardContent /></SessionGate>;
}

function DashboardContent() {
  const { token } = useDemoSession();
  const dashboard = useQuery({ queryKey: ["dashboard", token], queryFn: () => api.dashboard(token!) });
  const practiceProgress = useQuery({ queryKey: ["question-progress", token], queryFn: () => api.questionBankProgress(token!) });
  const data = dashboard.data;
  const profile = data?.profile;
  const plan = data?.active_plan;
  const progress = data?.total_tasks ? Math.round(data.completed_tasks / data.total_tasks * 100) : 0;
  const today = dashboard.data?.learning_today ?? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const upcoming = plan?.tasks.filter((task) => !task.completed && task.scheduled_date >= today).slice(0, 3) ?? [];
  const focus = profile ? Object.entries(profile.current_scores).sort(([left, a], [right, b]) =>
    profile.target_scores[right as keyof typeof profile.target_scores] - b - (profile.target_scores[left as keyof typeof profile.target_scores] - a))[0]?.[0] : undefined;

  if (dashboard.isLoading) return <main className="page loading-state">正在读取学习进度…</main>;
  if (dashboard.error) return <main className="page loading-state error-text">读取失败：{dashboard.error.message}</main>;

  return <main className="page">
    <PageHeader title="学习概览" />
    <section className="metric-grid">
      <article className="metric-card"><Target /><div><small>目标均分</small><strong>{profile ? (Object.values(profile.target_scores).reduce((a, b) => a + b, 0) / 4).toFixed(1) : "—"}</strong><span>考试日 {profile?.exam_date ?? "未设置"}</span></div></article>
      <article className="metric-card"><CheckCircle2 /><div><small>计划完成率</small><strong>{progress}%</strong><span>{data?.completed_tasks ?? 0} / {data?.total_tasks ?? 0} 项已完成</span></div></article>
      <article className="metric-card"><BookOpenCheck /><div><small>当前重点</small><strong>{focus ? skillLabels[focus as keyof typeof skillLabels] : "—"}</strong></div></article>
      <article className="metric-card"><FilePenLine /><div><small>最近写作估分</small><strong>{data?.latest_assessment?.estimated_overall_band ?? "—"}</strong></div></article>
    </section>
    <details className="learning-path panel"><summary>备考路径</summary><nav><Link href="/profile"><b>01</b><span>设定目标</span></Link><i>→</i><Link href="/plan"><b>02</b><span>生成计划</span></Link><i>→</i><Link href="/question-bank"><b>03</b><span>完成练习</span></Link><i>→</i><Link href="/question-bank?review=wrong"><b>04</b><span>错题复习<small>{practiceProgress.data?.incorrect_questions ?? 0} 道题等待巩固</small></span></Link></nav></details>
    <section className="dashboard-grid">
      <article className="panel plan-preview">
        <div className="panel-heading"><div><p className="eyebrow">接下来的安排</p><h2>{plan ? `${plan.starts_on} 至 ${plan.ends_on}` : "还没有启用的计划"}</h2></div><Link className="text-link" href="/plan">查看计划 <ArrowRight size={16} /></Link></div>
        {upcoming.length ? <div className="upcoming-list">{upcoming.map((task) => <div className="upcoming-task" key={task.id}>
          <div className={`skill-icon ${task.skill}`}>{skillLabels[task.skill].slice(0, 1)}</div>
          <div><small>{formatDate(task.scheduled_date)} · {task.duration_minutes} 分钟</small><strong>{task.title}</strong><span>{task.objective}</span></div>
          <Link href={skillRoutes[task.skill]}>开始 <ArrowRight size={15} /></Link>
        </div>)}</div> : <div className="empty-state"><CalendarDays /><h3>暂无待办任务</h3><Link className="primary-button" href="/plan">本周计划</Link></div>}
      </article>
      <aside className="panel quick-actions">
        <h2>开始学习</h2>
        <Link href="/profile"><span>01</span><div><strong>学习档案</strong></div><ArrowRight /></Link>
        <Link href="/vocabulary"><span>02</span><div><strong>背单词</strong></div><ArrowRight /></Link>
        <Link href="/question-bank"><span>03</span><div><strong>练习题库</strong><small>{practiceProgress.data?.attempted_questions ?? 0} 题已练习 · {practiceProgress.data?.incorrect_questions ?? 0} 题待复习</small></div><ArrowRight /></Link>
        <Link href="/writing"><span>04</span><div><strong>写作练习</strong></div><ArrowRight /></Link>
      </aside>
    </section>
  </main>;
}
