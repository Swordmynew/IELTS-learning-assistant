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
    <PageHeader title="用户中心" action={<Link className="secondary-button" href="/settings"><Settings size={17} />设置</Link>} />
    <section className="account-hero panel">
      <span className="large-avatar">{(user?.display_name || user?.email || "U").slice(0, 1).toUpperCase()}</span>
      <div><span className="account-type">{user?.demo ? "演示账号" : "个人账号"}</span><h2>{user?.display_name || "未设置昵称"}</h2><p>{user?.email}</p></div>
      <dl><div><dt>加入时间</dt><dd>{user?.created_at ? new Date(user.created_at).toLocaleDateString("zh-CN") : "—"}</dd></div><div><dt>数据空间</dt><dd>{user?.demo ? "共享演示数据" : "个人独立保存"}</dd></div></dl>
    </section>
    <section className="account-metrics">
      <article className="panel"><CalendarDays /><span>本周任务</span><strong>{total}</strong><small>已完成 {completed} 项</small></article>
      <article className="panel"><CheckCircle2 /><span>计划完成率</span><strong>{total ? Math.round(completed / total * 100) : 0}%</strong></article>
      <article className="panel"><LibraryBig /><span>已练习题目</span><strong>{practice.data?.attempted_questions ?? 0}</strong><small>正确率 {practice.data?.attempted_questions ? Math.round((practice.data?.accuracy ?? 0) * 100) : 0}%</small></article>
      <article className="panel"><FilePenLine /><span>最近写作估分</span><strong>{dashboard.data?.latest_assessment?.estimated_overall_band ?? "—"}</strong></article>
    </section>
    <section className="account-grid">
      <article className="panel account-section"><div className="section-title"><UserRound /><div><h2>学习档案</h2></div></div>{dashboard.data?.profile ? <><p className="account-status success">已建立</p><Link className="text-link" href="/profile">查看档案 →</Link></> : <><p className="account-status">待填写</p><Link className="primary-button" href="/profile">现在填写档案</Link></>}</article>
      <article className="panel account-section"><div className="section-title"><CalendarDays /><div><h2>本周计划</h2></div></div>{dashboard.data?.active_plan ? <><p className="account-status success">{dashboard.data.active_plan.status === "approved" ? "已启用" : "待确认"} · {total} 项任务</p><Link className="text-link" href="/plan">进入本周计划 →</Link></> : <><p className="account-status">未生成</p><Link className="secondary-button" href="/plan">制定计划</Link></>}</article>
    </section>
  </main>;
}
