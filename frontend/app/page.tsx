"use client";

import { useI18n, localizeError } from "@/lib/i18n";

import { useQuery } from "@tanstack/react-query";
import { ArrowRight, BookOpenCheck, CalendarDays, CheckCircle2, FilePenLine, Target } from "lucide-react";
import Link from "next/link";

import { PageHeader, SessionGate } from "./app-shell";
import { useDemoSession } from "./providers";
import { api } from "@/lib/api";
import { skillLabels, skillRoutes } from "@/lib/ui";

export default function DashboardPage() {
  return <SessionGate><DashboardContent /></SessionGate>;
}

function DashboardContent() {
  const { t, formatDate } = useI18n();
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

  if (dashboard.isLoading) return <main className="page loading-state">{t("ui.loadingYourProgress")}</main>;
  if (dashboard.error) return <main className="page loading-state error-text">{t("common.errorLoading", { error: localizeError(dashboard.error.message) })}</main>;

  return <main className="page">
    <PageHeader title={t("ui.overview")} />
    <section className="metric-grid">
      <article className="metric-card"><Target /><div><small>{t("ui.targetAverageBand")}</small><strong>{profile ? (Object.values(profile.target_scores).reduce((a, b) => a + b, 0) / 4).toFixed(1) : "—"}</strong><span>{t("dashboard.examDate", { date: profile?.exam_date ? formatDate(profile.exam_date, { timeZone: "UTC" }) : t("ui.notSet") })}</span></div></article>
      <article className="metric-card"><CheckCircle2 /><div><small>{t("ui.planCompletion")}</small><strong>{progress}%</strong><span>{t("dashboard.tasksCompleted", { done: data?.completed_tasks ?? 0, total: data?.total_tasks ?? 0 })}</span></div></article>
      <article className="metric-card"><BookOpenCheck /><div><small>{t("ui.currentFocus")}</small><strong>{focus ? skillLabels[focus as keyof typeof skillLabels] : "—"}</strong></div></article>
      <article className="metric-card"><FilePenLine /><div><small>{t("ui.latestWritingEstimate")}</small><strong>{data?.latest_assessment?.estimated_overall_band ?? "—"}</strong></div></article>
    </section>
    <details className="learning-path panel"><summary>{t("ui.yourLearningPath")}</summary><nav><Link href="/profile"><b>01</b><span>{t("ui.setGoals")}</span></Link><i>→</i><Link href="/plan"><b>02</b><span>{t("ui.createAPlan")}</span></Link><i>→</i><Link href="/question-bank"><b>03</b><span>{t("ui.practice")}</span></Link><i>→</i><Link href="/question-bank?review=wrong"><b>04</b><span>{t("ui.reviewMistakes")}<small>{t("dashboard.questionsToReview", { count: practiceProgress.data?.incorrect_questions ?? 0 })}</small></span></Link></nav></details>
    <section className="dashboard-grid">
      <article className="panel plan-preview">
        <div className="panel-heading"><div><p className="eyebrow">{t("ui.comingUp")}</p><h2>{plan ? t("ui.valueToValue", { value1: formatDate(plan.starts_on, { timeZone: "UTC" }), value2: formatDate(plan.ends_on, { timeZone: "UTC" }) }) : t("ui.noActivePlanYet")}</h2></div><Link className="text-link" href="/plan">{t("ui.viewPlan")}<ArrowRight size={16} /></Link></div>
        {upcoming.length ? <div className="upcoming-list">{upcoming.map((task) => <div className="upcoming-task" key={task.id}>
          <div className={`skill-icon ${task.skill}`}>{skillLabels[task.skill].slice(0, 1)}</div>
          <div><small>{t("dashboard.scheduledTask", { date: formatDate(task.scheduled_date, { timeZone: "UTC", month: "long", day: "numeric", weekday: "short" }), minutes: task.duration_minutes })}</small><strong>{task.title}</strong><span>{task.objective}</span></div>
          <Link href={skillRoutes[task.skill]}>{t("ui.start")}<ArrowRight size={15} /></Link>
        </div>)}</div> : <div className="empty-state"><CalendarDays /><h3>{t("ui.noUpcomingTasks")}</h3><Link className="primary-button" href="/plan">{t("ui.weeklyPlan")}</Link></div>}
      </article>
      <aside className="panel quick-actions">
        <h2>{t("ui.startLearning")}</h2>
        <Link href="/profile"><span>01</span><div><strong>{t("ui.learningProfile")}</strong></div><ArrowRight /></Link>
        <Link href="/vocabulary"><span>02</span><div><strong>{t("ui.vocabulary")}</strong></div><ArrowRight /></Link>
        <Link href="/question-bank"><span>03</span><div><strong>{t("ui.questionBank")}</strong><small>{t("dashboard.practiceProgress", { done: practiceProgress.data?.attempted_questions ?? 0, review: practiceProgress.data?.incorrect_questions ?? 0 })}</small></div><ArrowRight /></Link>
        <Link href="/writing"><span>04</span><div><strong>{t("ui.writingPractice")}</strong></div><ArrowRight /></Link>
      </aside>
    </section>
  </main>;
}
