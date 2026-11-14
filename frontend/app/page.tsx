"use client";

import { useI18n, localizeError, localizeSystemText } from "@/lib/i18n";

import { useQuery } from "@tanstack/react-query";
import { ArrowRight, RotateCcw, CheckCircle2, FilePenLine, Target } from "lucide-react";
import Link from "next/link";

import { PageHeader, SessionGate } from "./app-shell";
import { useDemoSession } from "./providers";
import { api } from "@/lib/api";
import { skillLabels, skillRoutes } from "@/lib/ui";
import { StudyLaunchpad } from "./study-launchpad";

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

  if (dashboard.isLoading) return <main className="page loading-state">{t("ui.loadingYourProgress")}</main>;
  if (dashboard.error) return <main className="page loading-state error-text">{t("common.errorLoading", { error: localizeError(dashboard.error.message) })}</main>;

  return <main className="page dashboard-page">
    <PageHeader title={t("ui.overview")} />
    <StudyLaunchpad profile={profile ?? null} tasks={plan?.tasks ?? []} today={today} />
    <section className="metric-grid">
      <article className="metric-card"><Target /><div><small>{t("ui.targetAverageBand")}</small><strong>{profile ? (Object.values(profile.target_scores).reduce((a, b) => a + b, 0) / 4).toFixed(1) : "—"}</strong><span>{t("dashboard.examDate", { date: profile?.exam_date ? formatDate(profile.exam_date, { timeZone: "UTC" }) : t("ui.notSet") })}</span></div></article>
      <article className="metric-card"><CheckCircle2 /><div><small>{t("ui.planCompletion")}</small><strong>{progress}%</strong><span>{t("dashboard.tasksCompleted", { done: data?.completed_tasks ?? 0, total: data?.total_tasks ?? 0 })}</span></div></article>
      <Link className="metric-card" href="/question-bank?review=wrong"><RotateCcw /><div><small>{t("ui.reviewMistakes")}</small><strong>{practiceProgress.data?.incorrect_questions ?? "—"}</strong></div><ArrowRight size={16} /></Link>
      <article className="metric-card"><FilePenLine /><div><small>{t("ui.latestWritingEstimate")}</small><strong>{data?.latest_assessment?.estimated_overall_band ?? "—"}</strong></div></article>
    </section>
    {upcoming.length > 0 && <section>
      <article className="panel plan-preview">
        <div className="panel-heading"><h2>{t("ui.comingUp")}</h2><Link className="text-link" href="/plan">{t("ui.viewPlan")}<ArrowRight size={16} /></Link></div>
        <div className="upcoming-list">{upcoming.map((task) => <div className="upcoming-task" key={task.id}>
          <div className={`skill-icon ${task.skill}`}>{skillLabels[task.skill].slice(0, 1)}</div>
          <div><small>{t("dashboard.scheduledTask", { date: formatDate(task.scheduled_date, { timeZone: "UTC", month: "short", day: "numeric" }), minutes: task.duration_minutes })}</small><strong>{localizeSystemText(task.title)}</strong></div>
          <Link href={skillRoutes[task.skill]}>{t("ui.start")}<ArrowRight size={15} /></Link>
        </div>)}</div>
      </article>
    </section>}
  </main>;
}
