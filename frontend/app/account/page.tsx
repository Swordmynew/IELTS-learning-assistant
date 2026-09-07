"use client";

import { useQuery } from "@tanstack/react-query";
import { CalendarDays, CheckCircle2, FilePenLine, LibraryBig, Settings, UserRound } from "lucide-react";
import Link from "next/link";

import { PageHeader, SessionGate } from "../app-shell";
import { useAuth } from "../providers";
import { api } from "@/lib/api";

export default function AccountPage() {
  return <SessionGate><AccountContent /></SessionGate>;
}

function AccountContent() {
  const { token, user } = useAuth();
  const dashboard = useQuery({ queryKey: ["dashboard", token], queryFn: () => api.dashboard(token!) });
  const practice = useQuery({ queryKey: ["question-progress", token], queryFn: () => api.questionBankProgress(token!) });
  const completed = dashboard.data?.completed_tasks ?? 0;
  const total = dashboard.data?.total_tasks ?? 0;

  return <main className="page narrow-page">
    <PageHeader eyebrow="用户中心" title={`你好，${user?.display_name || "学习者"}`} description="集中查看账号信息、学习档案和最近的学习数据。" action={<Link className="secondary-button" href="/settings"><Settings size={17} />账号与偏好设置</Link>} />
    <section className="account-hero panel">
      <span className="large-avatar">{(user?.display_name || user?.email || "U").slice(0, 1).toUpperCase()}</span>
      <div><span className="account-type">{user?.demo ? "演示账号" : "正式学习账号"}</span><h2>{user?.display_name || "未设置昵称"}</h2><p>{user?.email}</p></div>
      <dl><div><dt>加入时间</dt><dd>{user?.created_at ? new Date(user.created_at).toLocaleDateString("zh-CN") : "—"}</dd></div><div><dt>数据空间</dt><dd>{user?.demo ? "共享演示数据" : "个人独立保存"}</dd></div></dl>
    </section>
    <section className="account-metrics">
      <article className="panel"><CalendarDays /><span>本周任务</span><strong>{total}</strong><small>已完成 {completed} 项</small></article>
      <article className="panel"><CheckCircle2 /><span>计划完成率</span><strong>{total ? Math.round(completed / total * 100) : 0}%</strong><small>{dashboard.data?.active_plan ? "当前计划已载入" : "尚未生成计划"}</small></article>
      <article className="panel"><LibraryBig /><span>已练习题目</span><strong>{practice.data?.attempted_questions ?? 0}</strong><small>正确率 {practice.data?.attempted_questions ? Math.round((practice.data?.accuracy ?? 0) * 100) : 0}%</small></article>
      <article className="panel"><FilePenLine /><span>最近写作估分</span><strong>{dashboard.data?.latest_assessment?.estimated_overall_band ?? "—"}</strong><small>AI 估分，仅供学习参考</small></article>
    </section>
    <section className="account-grid">
      <article className="panel account-section"><div className="section-title"><UserRound /><div><h2>学习档案</h2><p>考试目标、当前四科水平与每周可用时间</p></div></div>{dashboard.data?.profile ? <><p className="account-status success">档案已建立，可以生成自适应计划。</p><Link className="text-link" href="/profile">查看或修改学习档案 →</Link></> : <><p className="account-status">还没有学习档案，计划器暂时无法判断优先级。</p><Link className="primary-button" href="/profile">现在填写档案</Link></>}</article>
      <article className="panel account-section"><div className="section-title"><CalendarDays /><div><h2>本周计划</h2><p>计划、完成记录与下一步任务</p></div></div>{dashboard.data?.active_plan ? <><p className="account-status success">已有 {dashboard.data.active_plan.status === "approved" ? "生效" : "待确认"}计划，共 {total} 项任务。</p><Link className="text-link" href="/plan">进入本周计划 →</Link></> : <><p className="account-status">完成档案后即可生成第一份七天计划。</p><Link className="secondary-button" href="/plan">查看计划页面</Link></>}</article>
    </section>
  </main>;
}
