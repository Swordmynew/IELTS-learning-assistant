"use client";

import { useI18n, localizeError, localizeSystemText } from "@/lib/i18n";
import { planConflict, planRationale } from "@/lib/system-content";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, CalendarDays, Check, CircleAlert, Clock3, LoaderCircle, RefreshCw, Undo2 } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { PageHeader, SessionGate } from "../app-shell";
import { useDemoSession } from "../providers";
import { api, generatePlanStream, type Dashboard } from "@/lib/api";
import { skillLabels, skillRoutes, taskAction } from "@/lib/ui";

export default function PlanPage() {
  return <SessionGate><PlanContent /></SessionGate>;
}

function PlanContent() {
  const { t, formatDate } = useI18n();
  const { token } = useDemoSession();
  const client = useQueryClient();
  const dashboard = useQuery({ queryKey: ["dashboard", token], queryFn: () => api.dashboard(token!) });
  const draft = dashboard.data?.draft_plan ?? null;
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string; error?: string } | null>(null);

  const [progress, setProgress] = useState("");
  const generate = useMutation({
    onMutate: () => { setProgress("ui.loadingYourLearningProfile"); setMessage(null); },
    mutationFn: () => generatePlanStream(token!, event => { if (event.message) setProgress(event.node && ["intake", "diagnose", "retrieve", "plan", "validate"].includes(event.node) ? `plan.progress.${event.node}` : event.message); }),
    onSuccess: (plan) => {
      setProgress("");
      client.setQueryData<Dashboard>(["dashboard", token], current => current ? { ...current, draft_plan: plan } : current);
      setMessage({ type: "success", text: "ui.draftPlanCreated" });
      client.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (error: Error) => { setProgress(""); setMessage({ type: "error", text: "ui.couldNotCreateThePlanValue", error: error.message }); },
  });
  const approve = useMutation({
    mutationFn: () => api.approvePlan(token!, draft!.id),
    onSuccess: (plan) => {
      client.setQueryData<Dashboard>(["dashboard", token], current => current ? {
        ...current, active_plan: plan, draft_plan: null,
        completed_tasks: plan.tasks.filter(task => task.completed).length, total_tasks: plan.tasks.length,
      } : current);
      setMessage({ type: "success", text: "ui.planActivated" });
      client.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (error: Error) => setMessage({ type: "error", text: "ui.couldNotApproveThePlanValue", error: error.message }),
  });
  const updateCompletion = useMutation({
    mutationFn: ({ taskId, completed }: { taskId: string; completed: boolean }) =>
      completed ? api.completeTask(token!, taskId) : api.restoreTask(token!, taskId),
    onSuccess: (task) => {
      setMessage({
        type: "success",
        text: task.completed ? "ui.taskCompleted" : "ui.taskRestored",
      });
      client.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (error: Error) => setMessage({ type: "error", text: "ui.couldNotUpdateTheTaskValue", error: error.message }),
  });

  const plan = draft ?? dashboard.data?.active_plan ?? null;
  const dates = useMemo(() => {
    if (!plan) return [];
    const start = new Date(`${plan.starts_on}T00:00:00Z`);
    const count = Math.min(7, Math.max(0, Math.round((Date.parse(`${plan.ends_on}T00:00:00Z`) - start.getTime()) / 86400000) + 1));
    return Array.from({ length: count }, (_, index) => {
      const day = new Date(start);
      day.setUTCDate(start.getUTCDate() + index);
      return day.toISOString().slice(0, 10);
    });
  }, [plan]);
  const completed = plan?.tasks.filter((task) => task.completed).length ?? 0;
  const rationale = plan?.rationale.includes("CP-SAT") || plan?.rationale.includes("deterministic fallback")
    ? t("ui.tasksFitYourDailyAvailabilityWithExtraAttentionToSubjectsFurthestFromYourTargetScores")
    : plan ? planRationale(plan) : undefined;

  return <main className="page">
    <PageHeader title={t("ui.weeklyPlan")} action={<button className="primary-button" onClick={() => generate.mutate()} disabled={generate.isPending}>{generate.isPending ? <LoaderCircle className="spin" size={17} /> : <RefreshCw size={17} />}{plan ? t("ui.regeneratePlan") : t("ui.createWeeklyPlan")}</button>} />
    {generate.isPending && <p className="profile-update-note" role="status">{t(localizeError(progress))}</p>}
    {message && <div className={`notice ${message.type}`} role="status">{message.type === "error" ? <CircleAlert size={18} /> : <Check size={18} />}{t(message.text, { value1: t(localizeError(message.error ?? "")) })}</div>}
    {!dashboard.data?.profile ? <div className="panel empty-state"><CalendarDays /><h2>{t("ui.setUpYourLearningProfileFirst")}</h2><Link className="primary-button" href="/profile">{t("ui.setUpLearningProfile")}</Link></div> : !plan ? <div className="panel empty-state"><CalendarDays /><h2>{t("ui.noStudyPlanYet")}</h2></div> : <>
      <section className={`plan-summary ${draft ? "draft" : "active"}`}>
        <div><span className="status-pill">{draft ? t("ui.awaitingApproval") : t("ui.active")}</span><h2>{formatDate(plan.starts_on, { timeZone: "UTC" })} — {formatDate(plan.ends_on, { timeZone: "UTC" })}</h2><details className="plan-rationale"><summary>{t("ui.whyThisSchedule")}</summary><p>{rationale}</p></details></div>
        <div className="plan-stats"><div><strong>{plan.tasks.length}</strong><span>{t("ui.tasks")}</span></div><div><strong>{plan.tasks.reduce((sum, task) => sum + task.duration_minutes, 0)}</strong><span>{t("ui.minutes")}</span></div><div><strong>{completed}</strong><span>{t("ui.completed")}</span></div></div>
        {draft && <button className="approve-button" onClick={() => approve.mutate()} disabled={approve.isPending || generate.isPending || !!draft.conflicts.length}>{approve.isPending ? <LoaderCircle className="spin" size={17} /> : <Check size={18} />}{approve.isPending ? t("ui.activating") : t("ui.activatePlan")}</button>}
      </section>
      {plan.conflicts.length > 0 && <div className="notice warning"><CircleAlert size={18} /><div><strong>{t("ui.schedulingLimits")}</strong>{plan.conflicts.map((conflict) => <p key={conflict}>{planConflict(conflict)}</p>)}</div></div>}
      <section className="week-grid" style={{ gridTemplateColumns: `repeat(${dates.length || 1}, minmax(140px, 1fr))` }}>{dates.map((date) => {
        const tasks = plan.tasks.filter((task) => task.scheduled_date === date);
        const minutes = tasks.reduce((sum, task) => sum + task.duration_minutes, 0);
        const day = new Date(`${date}T00:00:00Z`).getUTCDay() || 7;
        const capacity = dashboard.data?.profile?.minutes_by_weekday[String(day)] ?? 0;
        return <article className="day-column" key={date}>
          <header><div><strong>{formatDate(date, { timeZone: "UTC", month: "long", day: "numeric", weekday: "short" })}</strong><span>{t("plan.capacityMinutes", { used: minutes, capacity })}</span></div><div className="capacity-track"><span style={{ width: `${capacity ? Math.min(100, minutes / capacity * 100) : 0}%` }} /></div></header>
          <div className="day-tasks">{tasks.length ? tasks.map((task) => <div className={`plan-task ${task.completed ? "done" : ""}`} key={task.id}>
            <div className="task-top"><span className={`skill-tag ${task.skill}`}>{skillLabels[task.skill]}</span><span><Clock3 size={13} /> {t("common.minutesCount", { count: task.duration_minutes })}</span></div>
            <h3>{localizeSystemText(task.title)}</h3><details className="task-objective"><summary>{t("ui.practiceGoal")}</summary><p>{localizeSystemText(task.objective)}</p></details>
            <div className="task-actions"><Link href={skillRoutes[task.skill]}>{taskAction(task)} <ArrowRight size={14} /></Link>{!draft && <button className={task.completed ? "restore-task" : ""} onClick={() => updateCompletion.mutate({ taskId: task.id, completed: !task.completed })} disabled={updateCompletion.isPending && updateCompletion.variables?.taskId === task.id}>{task.completed && <Undo2 size={13} />}{updateCompletion.isPending && updateCompletion.variables?.taskId === task.id ? t("ui.updating") : task.completed ? t("ui.restoreTask") : t("ui.markComplete")}</button>}</div>
          </div>) : <div className="rest-day">{t("ui.restCatchUp")}</div>}</div>
        </article>;
      })}</section>
    </>}
  </main>;
}
