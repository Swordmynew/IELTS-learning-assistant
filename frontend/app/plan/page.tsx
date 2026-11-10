"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, CalendarDays, Check, CircleAlert, Clock3, LoaderCircle, RefreshCw, Undo2 } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { PageHeader, SessionGate } from "../app-shell";
import { useDemoSession } from "../providers";
import { api, StudyPlan } from "@/lib/api";
import { formatDate, skillLabels, skillRoutes, taskAction } from "@/lib/ui";

export default function PlanPage() {
  return <SessionGate><PlanContent /></SessionGate>;
}

function PlanContent() {
  const { token } = useDemoSession();
  const client = useQueryClient();
  const dashboard = useQuery({ queryKey: ["dashboard", token], queryFn: () => api.dashboard(token!) });
  const [draft, setDraft] = useState<StudyPlan | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const generate = useMutation({
    mutationFn: () => api.generatePlan(token!),
    onSuccess: (plan) => {
      setDraft(plan);
      setMessage({ type: "success", text: "草案已生成" });
    },
    onError: (error: Error) => setMessage({ type: "error", text: `生成失败：${error.message}` }),
  });
  const approve = useMutation({
    mutationFn: () => api.approvePlan(token!, draft!.id),
    onSuccess: () => {
      setDraft(null);
      setMessage({ type: "success", text: "计划已启用" });
      client.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (error: Error) => setMessage({ type: "error", text: `确认失败：${error.message}` }),
  });
  const updateCompletion = useMutation({
    mutationFn: ({ taskId, completed }: { taskId: string; completed: boolean }) =>
      completed ? api.completeTask(token!, taskId) : api.restoreTask(token!, taskId),
    onSuccess: (task) => {
      setMessage({
        type: "success",
        text: task.completed ? "任务已完成" : "任务已恢复",
      });
      client.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (error: Error) => setMessage({ type: "error", text: `更新任务失败：${error.message}` }),
  });

  const plan = draft ?? dashboard.data?.active_plan ?? null;
  const dates = useMemo(() => {
    if (!plan) return [];
    const start = new Date(`${plan.starts_on}T12:00:00`);
    return Array.from({ length: 7 }, (_, index) => {
      const day = new Date(start);
      day.setDate(start.getDate() + index);
      return day.toISOString().slice(0, 10);
    });
  }, [plan]);
  const completed = plan?.tasks.filter((task) => task.completed).length ?? 0;
  const rationale = plan?.rationale.includes("CP-SAT") || plan?.rationale.includes("deterministic fallback")
    ? "已按照你每天可用的时间安排任务，并优先照顾当前分差较大的科目。"
    : plan?.rationale;

  return <main className="page">
    <PageHeader title="本周计划" action={<button className="primary-button" onClick={() => generate.mutate()} disabled={generate.isPending}>{generate.isPending ? <LoaderCircle className="spin" size={17} /> : <RefreshCw size={17} />}{plan ? "重新生成计划" : "生成本周计划"}</button>} />
    {message && <div className={`notice ${message.type}`} role="status">{message.type === "error" ? <CircleAlert size={18} /> : <Check size={18} />}{message.text}</div>}
    {!dashboard.data?.profile ? <div className="panel empty-state"><CalendarDays /><h2>先填写学习档案</h2><Link className="primary-button" href="/profile">填写学习档案</Link></div> : !plan ? <div className="panel empty-state"><CalendarDays /><h2>还没有学习计划</h2></div> : <>
      <section className={`plan-summary ${draft ? "draft" : "active"}`}>
        <div><span className="status-pill">{draft ? "待确认" : "已启用"}</span><h2>{plan.starts_on} — {plan.ends_on}</h2><details className="plan-rationale"><summary>安排依据</summary><p>{rationale}</p></details></div>
        <div className="plan-stats"><div><strong>{plan.tasks.length}</strong><span>项任务</span></div><div><strong>{plan.tasks.reduce((sum, task) => sum + task.duration_minutes, 0)}</strong><span>分钟</span></div><div><strong>{completed}</strong><span>已完成</span></div></div>
        {draft && <button className="approve-button" onClick={() => approve.mutate()} disabled={approve.isPending}>{approve.isPending ? <LoaderCircle className="spin" size={17} /> : <Check size={18} />}{approve.isPending ? "正在启用…" : "启用计划"}</button>}
      </section>
      {plan.conflicts.length > 0 && <div className="notice warning"><CircleAlert size={18} /><div><strong>安排限制</strong>{plan.conflicts.map((conflict) => <p key={conflict}>{conflict}</p>)}</div></div>}
      <section className="week-grid">{dates.map((date) => {
        const tasks = plan.tasks.filter((task) => task.scheduled_date === date);
        const minutes = tasks.reduce((sum, task) => sum + task.duration_minutes, 0);
        const day = new Date(`${date}T12:00:00`).getDay() || 7;
        const capacity = dashboard.data?.profile?.minutes_by_weekday[String(day)] ?? 0;
        return <article className="day-column" key={date}>
          <header><div><strong>{formatDate(date)}</strong><span>{minutes} / {capacity} 分钟</span></div><div className="capacity-track"><span style={{ width: `${capacity ? Math.min(100, minutes / capacity * 100) : 0}%` }} /></div></header>
          <div className="day-tasks">{tasks.length ? tasks.map((task) => <div className={`plan-task ${task.completed ? "done" : ""}`} key={task.id}>
            <div className="task-top"><span className={`skill-tag ${task.skill}`}>{skillLabels[task.skill]}</span><span><Clock3 size={13} /> {task.duration_minutes} 分钟</span></div>
            <h3>{task.title}</h3><details className="task-objective"><summary>练习目标</summary><p>{task.objective}</p></details>
            <div className="task-actions"><Link href={skillRoutes[task.skill]}>{taskAction(task)} <ArrowRight size={14} /></Link>{!draft && <button className={task.completed ? "restore-task" : ""} onClick={() => updateCompletion.mutate({ taskId: task.id, completed: !task.completed })} disabled={updateCompletion.isPending && updateCompletion.variables?.taskId === task.id}>{task.completed && <Undo2 size={13} />}{updateCompletion.isPending && updateCompletion.variables?.taskId === task.id ? "更新中…" : task.completed ? "恢复任务" : "标记完成"}</button>}</div>
          </div>) : <div className="rest-day">休息 / 补做</div>}</div>
        </article>;
      })}</section>
    </>}
  </main>;
}
