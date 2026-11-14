"use client";

import { useI18n } from "@/lib/i18n";

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
  const { t, formatDate } = useI18n();
  const { token, user } = useAuth();
  const dashboard = useQuery({ queryKey: ["dashboard", token], queryFn: () => api.dashboard(token!) });
  const practice = useQuery({ queryKey: ["question-progress", token], queryFn: () => api.questionBankProgress(token!) });
  const completed = dashboard.data?.completed_tasks ?? 0;
  const total = dashboard.data?.total_tasks ?? 0;

  return <main className="page narrow-page">
    <PageHeader title={t("ui.account")} action={<Link className="secondary-button" href="/settings"><Settings size={17} />{t("ui.settings")}</Link>} />
    <section className="account-hero panel">
      <span className="large-avatar">{(user?.display_name || user?.email || "U").slice(0, 1).toUpperCase()}</span>
      <div><span className="account-type">{user?.demo ? t("ui.demoAccount") : t("ui.personalAccount")}</span><h2>{user?.display_name || t("ui.noDisplayName")}</h2><p>{user?.email}</p></div>
      <dl><div><dt>{t("ui.joined")}</dt><dd>{user?.created_at ? formatDate(user.created_at) : "—"}</dd></div><div><dt>{t("ui.dataStorage")}</dt><dd>{user?.demo ? t("ui.sharedDemoData") : t("ui.privateToYourAccount")}</dd></div></dl>
    </section>
    <section className="account-metrics">
      <article className="panel"><CalendarDays /><span>{t("ui.thisWeekSTasks")}</span><strong>{total}</strong><small>{t("account.completedCount", { count: completed })}</small></article>
      <article className="panel"><CheckCircle2 /><span>{t("ui.planCompletion")}</span><strong>{total ? Math.round(completed / total * 100) : 0}%</strong></article>
      <article className="panel"><LibraryBig /><span>{t("ui.questionsPracticed")}</span><strong>{practice.data?.attempted_questions ?? 0}</strong><small>{t("account.accuracyPercent", { percent: practice.data?.attempted_questions ? Math.round((practice.data?.accuracy ?? 0) * 100) : 0 })}</small></article>
      <article className="panel"><FilePenLine /><span>{t("ui.latestWritingEstimate")}</span><strong>{dashboard.data?.latest_assessment?.estimated_overall_band ?? "—"}</strong></article>
    </section>
    <section className="account-grid">
      <article className="panel account-section"><div className="section-title"><UserRound /><div><h2>{t("ui.learningProfile")}</h2></div></div>{dashboard.data?.profile ? <><p className="account-status success">{t("ui.ready")}</p><Link className="text-link" href="/profile">{t("ui.viewProfile")}</Link></> : <><p className="account-status">{t("ui.notCompleted")}</p><Link className="primary-button" href="/profile">{t("ui.setUpYourProfile")}</Link></>}</article>
      <article className="panel account-section"><div className="section-title"><CalendarDays /><div><h2>{t("ui.weeklyPlan")}</h2></div></div>{dashboard.data?.active_plan ? <><p className="account-status success">{t("account.planStatus", { status: dashboard.data.active_plan.status === "approved" ? t("ui.active") : t("ui.awaitingApproval"), count: total })}</p><Link className="text-link" href="/plan">{t("ui.goToWeeklyPlan")}</Link></> : <><p className="account-status">{t("ui.notCreated")}</p><Link className="secondary-button" href="/plan">{t("ui.createAPlan2")}</Link></>}</article>
    </section>
  </main>;
}
