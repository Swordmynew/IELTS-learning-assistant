"use client";

import { useI18n, localizeError } from "@/lib/i18n";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Check, Clock3, Save, Target } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { PageHeader, SessionGate } from "../app-shell";
import { useDemoSession } from "../providers";
import { api, Profile, Skill } from "@/lib/api";
import { skillLabels, skills, weekdayLabels } from "@/lib/ui";

type ProfileDraft = Omit<Profile, "minutes_by_weekday"> & { minutes_by_weekday: Record<string, string> };
const scoreOptions = Array.from({ length: 19 }, (_, index) => index * 0.5);

function toDraft(profile: Profile): ProfileDraft {
  return { ...profile, minutes_by_weekday: Object.fromEntries(Object.entries(profile.minutes_by_weekday).map(([day, value]) => [day, String(value)])) };
}

export default function ProfilePage() {
  return <SessionGate><ProfileContent /></SessionGate>;
}

function ProfileContent() {
  const { t } = useI18n();
  const { token } = useDemoSession();
  const client = useQueryClient();
  const dashboard = useQuery({ queryKey: ["dashboard", token], queryFn: () => api.dashboard(token!) });
  const [draft, setDraft] = useState<ProfileDraft | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string; error?: string } | null>(null);

  useEffect(() => {
    if (dashboard.data?.profile && !draft) setDraft(toDraft(dashboard.data.profile));
  }, [dashboard.data?.profile, draft]);

  const save = useMutation({
    mutationFn: () => {
      if (!draft) throw new Error("error.profileNotLoaded");
      const payload: Profile = {
        ...draft,
        minutes_by_weekday: Object.fromEntries(Object.entries(draft.minutes_by_weekday).map(([day, value]) => [day, value === "" ? 0 : Number(value)])),
      };
      return api.saveDiagnostic(token!, payload);
    },
    onSuccess: (profile) => {
      setDraft(toDraft(profile));
      setMessage({ type: "success", text: "ui.saved" });
      client.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (error: Error) => setMessage({ type: "error", text: "ui.couldNotSaveValue", error: error.message }),
  });

  if (dashboard.isLoading || !draft) return <main className="page loading-state">{t("ui.loadingYourLearningProfile")}</main>;

  const updateScore = (kind: "current_scores" | "target_scores", skill: Skill, value: number) =>
    setDraft((current) => current && ({ ...current, [kind]: { ...current[kind], [skill]: value } }));
  const totalMinutes = Object.values(draft.minutes_by_weekday).reduce((sum, value) => sum + (Number(value) || 0), 0);

  return <main className="page">
    <PageHeader title={t("ui.learningProfile")} action={<Link className="secondary-button" href="/plan">{t("ui.viewWeeklyPlan")}<ArrowRight size={16} /></Link>} />
    {message && <div className={`notice ${message.type}`} role="status">{message.type === "success" && <Check size={18} />}{t(message.text, { value1: t(localizeError(message.error ?? "")) })}</div>}
    <div className="profile-layout">
      <section className="panel profile-form">
        <div className="form-section-heading"><Target /><div><h2>{t("ui.examGoals")}</h2><small>{t("ui.latestResultsOrSelfAssessment")}</small></div></div>
        <label className="field compact-field">{t("ui.plannedExamDate")}<input type="date" value={draft.exam_date} onChange={(event) => setDraft({ ...draft, exam_date: event.target.value })} /></label>
        <div className="score-table">
          <div className="score-row heading"><span>{t("ui.subject")}</span><span>{t("ui.currentBand")}</span><span>{t("ui.targetBand")}</span><span>{t("ui.gap")}</span></div>
          {skills.map((skill) => <div className="score-row" key={skill}>
            <strong>{skillLabels[skill]}</strong>
            <select aria-label={t("ui.currentValueBand", { value1: skillLabels[skill] })} value={draft.current_scores[skill].toFixed(1)} onChange={(event) => updateScore("current_scores", skill, Number.parseFloat(event.target.value))}>{scoreOptions.map((score) => <option value={score.toFixed(1)} key={score}>{score.toFixed(1)}</option>)}</select>
            <select aria-label={t("ui.targetValueBand", { value1: skillLabels[skill] })} value={draft.target_scores[skill].toFixed(1)} onChange={(event) => updateScore("target_scores", skill, Number.parseFloat(event.target.value))}>{scoreOptions.map((score) => <option value={score.toFixed(1)} key={score}>{score.toFixed(1)}</option>)}</select>
            <b>+{Math.max(0, draft.target_scores[skill] - draft.current_scores[skill]).toFixed(1)}</b>
          </div>)}
        </div>
      </section>
      <section className="panel profile-form">
        <div className="form-section-heading"><Clock3 /><div><h2>{t("ui.dailyStudyTime")}</h2></div></div>
        <div className="minutes-grid">{weekdayLabels.map((label, index) => {
          const day = String(index + 1);
          return <label key={day}>{label}<div><input type="number" min="0" max="360" inputMode="numeric" placeholder="0" value={draft.minutes_by_weekday[day] ?? ""} onChange={(event) => setDraft({ ...draft, minutes_by_weekday: { ...draft.minutes_by_weekday, [day]: event.target.value } })} /><span>{t("ui.minutes")}</span></div></label>;
        })}</div>
        <div className="weekly-total"><span>{t("ui.weeklyAvailability")}</span><strong>{t("profile.weeklyTime", { hours: Math.floor(totalMinutes / 60), minutes: totalMinutes % 60 })}</strong></div>
        <fieldset className="preference-field"><legend>{t("ui.focusAreasSelectAllThatApply")}</legend><div>{skills.map((skill) => {
          const checked = draft.preferred_skills.includes(skill);
          return <label className={checked ? "selected" : ""} key={skill}><input type="checkbox" checked={checked} onChange={() => setDraft({ ...draft, preferred_skills: checked ? draft.preferred_skills.filter((item) => item !== skill) : [...draft.preferred_skills, skill] })} />{skillLabels[skill]}</label>;
        })}</div></fieldset>
        <button className="primary-button full-button" onClick={() => save.mutate()} disabled={save.isPending}><Save size={17} />{save.isPending ? t("ui.saving") : t("ui.saveLearningProfile")}</button>
      </section>
    </div>
  </main>;
}
