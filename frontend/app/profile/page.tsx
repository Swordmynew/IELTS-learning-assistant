"use client";

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
  const { token } = useDemoSession();
  const client = useQueryClient();
  const dashboard = useQuery({ queryKey: ["dashboard", token], queryFn: () => api.dashboard(token!) });
  const [draft, setDraft] = useState<ProfileDraft | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (dashboard.data?.profile && !draft) setDraft(toDraft(dashboard.data.profile));
  }, [dashboard.data?.profile, draft]);

  const save = useMutation({
    mutationFn: () => {
      if (!draft) throw new Error("学习档案尚未加载");
      const payload: Profile = {
        ...draft,
        minutes_by_weekday: Object.fromEntries(Object.entries(draft.minutes_by_weekday).map(([day, value]) => [day, value === "" ? 0 : Number(value)])),
      };
      return api.saveDiagnostic(token!, payload);
    },
    onSuccess: (profile) => {
      setDraft(toDraft(profile));
      setMessage({ type: "success", text: "已保存。下一次生成计划时会使用这些分数和学习时间。" });
      client.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (error: Error) => setMessage({ type: "error", text: `保存失败：${error.message}` }),
  });

  if (dashboard.isLoading || !draft) return <main className="page loading-state">正在读取学习档案…</main>;

  const updateScore = (kind: "current_scores" | "target_scores", skill: Skill, value: number) =>
    setDraft((current) => current && ({ ...current, [kind]: { ...current[kind], [skill]: value } }));
  const totalMinutes = Object.values(draft.minutes_by_weekday).reduce((sum, value) => sum + (Number(value) || 0), 0);

  return <main className="page">
    <PageHeader eyebrow="学习档案" title="告诉我们你的起点与目标" description="分数和可用时间会直接影响每周任务的优先级、数量和安排日期。" action={<Link className="secondary-button" href="/plan">查看本周计划 <ArrowRight size={16} /></Link>} />
    {message && <div className={`notice ${message.type}`} role="status">{message.type === "success" && <Check size={18} />}{message.text}</div>}
    <div className="profile-layout">
      <section className="panel profile-form">
        <div className="form-section-heading"><Target /><div><h2>考试目标</h2><p>请选择最近一次可参考的成绩；没有正式成绩时可以填写自测结果。</p></div></div>
        <label className="field compact-field">计划考试日期<input type="date" value={draft.exam_date} onChange={(event) => setDraft({ ...draft, exam_date: event.target.value })} /></label>
        <div className="score-table">
          <div className="score-row heading"><span>科目</span><span>当前分数</span><span>目标分数</span><span>差距</span></div>
          {skills.map((skill) => <div className="score-row" key={skill}>
            <strong>{skillLabels[skill]}</strong>
            <select aria-label={`${skillLabels[skill]}当前分数`} value={draft.current_scores[skill].toFixed(1)} onChange={(event) => updateScore("current_scores", skill, Number.parseFloat(event.target.value))}>{scoreOptions.map((score) => <option value={score.toFixed(1)} key={score}>{score.toFixed(1)}</option>)}</select>
            <select aria-label={`${skillLabels[skill]}目标分数`} value={draft.target_scores[skill].toFixed(1)} onChange={(event) => updateScore("target_scores", skill, Number.parseFloat(event.target.value))}>{scoreOptions.map((score) => <option value={score.toFixed(1)} key={score}>{score.toFixed(1)}</option>)}</select>
            <b>+{Math.max(0, draft.target_scores[skill] - draft.current_scores[skill]).toFixed(1)}</b>
          </div>)}
        </div>
      </section>
      <section className="panel profile-form">
        <div className="form-section-heading"><Clock3 /><div><h2>每天可学习时间</h2><p>可以先清空再输入；留空在保存时按 0 分钟处理。</p></div></div>
        <div className="minutes-grid">{weekdayLabels.map((label, index) => {
          const day = String(index + 1);
          return <label key={day}>{label}<div><input type="number" min="0" max="360" inputMode="numeric" value={draft.minutes_by_weekday[day] ?? ""} onChange={(event) => setDraft({ ...draft, minutes_by_weekday: { ...draft.minutes_by_weekday, [day]: event.target.value } })} /><span>分钟</span></div></label>;
        })}</div>
        <div className="weekly-total"><span>每周可用时间</span><strong>{Math.floor(totalMinutes / 60)} 小时 {totalMinutes % 60} 分钟</strong></div>
        <fieldset className="preference-field"><legend>希望优先加强（可多选）</legend><div>{skills.map((skill) => {
          const checked = draft.preferred_skills.includes(skill);
          return <label className={checked ? "selected" : ""} key={skill}><input type="checkbox" checked={checked} onChange={() => setDraft({ ...draft, preferred_skills: checked ? draft.preferred_skills.filter((item) => item !== skill) : [...draft.preferred_skills, skill] })} />{skillLabels[skill]}</label>;
        })}</div></fieldset>
        <button className="primary-button full-button" onClick={() => save.mutate()} disabled={save.isPending}><Save size={17} />{save.isPending ? "正在保存…" : "保存学习档案"}</button>
      </section>
    </div>
  </main>;
}
