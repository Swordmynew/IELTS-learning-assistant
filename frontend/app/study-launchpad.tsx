"use client";

import { useState, type CSSProperties } from "react";
import Link from "next/link";
import { ArrowRight, AudioLines, BookOpen, Clock3, FilePenLine, Headphones, Mic, RotateCcw, Target } from "lucide-react";
import type { Profile, StudyTask } from "@/lib/api";
import { useI18n, localizeSystemText } from "@/lib/i18n";
import { skillLabels, skillRoutes } from "@/lib/ui";
import { launchpadSkills, nextStudySession } from "@/lib/study-launchpad";
import type { Skill } from "@/lib/api";
import "./study-launchpad.css";

const copyKeys = ["heading", "time", "minuteOption", "map", "current", "target", "focus", "auto", "plan", "suggested", "optional", "start", "review", "writing", "reading", "listening", "speaking", "vocabulary", "planLink", "profileLink", "emptyAction", "bandLabel"] as const;
const icons = { listening: Headphones, reading: BookOpen, writing: FilePenLine, speaking: Mic, vocabulary: AudioLines };

export function StudyLaunchpad({ profile, tasks, today }: { profile: Profile | null; tasks: StudyTask[]; today: string }) {
  const { t, formatDate } = useI18n();
  const text = Object.fromEntries(copyKeys.map(key => [key, t(`launchpad.${key}`)])) as Record<typeof copyKeys[number], string>;
  const [minutes, setMinutes] = useState(25);
  const [selected, setSelected] = useState<Skill | null>(null);
  const session = nextStudySession(profile, tasks, today, minutes, selected);
  const Icon = icons[session.skill];
  const fill = (template: string, values: Record<string, string | number>) => template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ""));
  const optional = tasks.length > 0 && tasks.every(task => task.completed);
  const title = session.task ? localizeSystemText(session.task.title) : (session.skill === "writing" && minutes === 10 ? text.review : text[session.skill]);

  return <section className="study-launchpad" aria-labelledby="launchpad-heading">
    <div className="launchpad-main">
      <h2 id="launchpad-heading">{text.heading}</h2>
      <fieldset className="launchpad-time">
        <legend>{text.time}</legend>
        <div>{[10, 25, 45].map(value => <button type="button" key={value} aria-pressed={minutes === value} onClick={() => setMinutes(value)}>{fill(text.minuteOption, { n: value })}</button>)}</div>
      </fieldset>
      <div className="launchpad-recommendation" aria-live="polite" aria-atomic="true">
        <div className="launchpad-task-meta"><span><Icon size={16} />{skillLabels[session.skill]}</span><span><Clock3 size={14} />{fill(text.minuteOption, { n: session.minutes })}</span></div>
        <small className="launchpad-source">{session.task ? text.plan : optional ? text.optional : text.suggested}</small>
        <h3>{title}</h3>
        <div className="launchpad-go"><Link href={skillRoutes[session.skill]}>{fill(text.start, { skill: skillLabels[session.skill] })}<ArrowRight size={20} /></Link>{session.task && <span>{formatDate(session.task.scheduled_date, { timeZone: "UTC", month: "short", day: "numeric" })}</span>}</div>
      </div>
      <div className="launchpad-foot"><Link href="/plan">{text.planLink}<ArrowRight size={14} /></Link></div>
    </div>
    <aside className="launchpad-map" aria-labelledby="band-map-heading">
      <div className="launchpad-map-heading"><h3 id="band-map-heading">{text.map}</h3>{profile && <button type="button" aria-pressed={selected === null} onClick={() => setSelected(null)}><RotateCcw size={12} />{text.auto}</button>}</div>
      {profile ? <>
        <div className="launchpad-legend"><span><i />{text.current}</span><span><i />{text.target}</span></div>
        <div className="launchpad-bands">{launchpadSkills.map(skill => {
          const current = profile.current_scores[skill], target = profile.target_scores[skill], SkillIcon = icons[skill];
          const label = fill(text.bandLabel, { skill: skillLabels[skill], current, target });
          return <button type="button" key={skill} className="launchpad-band" aria-label={fill(text.focus, { skill: skillLabels[skill] })} aria-description={label} aria-pressed={session.skill === skill} onClick={() => setSelected(skill)}>
            <span className="launchpad-band-top"><span><SkillIcon size={16} />{skillLabels[skill]}</span><span><b>{current.toFixed(1)}</b><ArrowRight size={12} /><strong>{target.toFixed(1)}</strong></span></span>
            <span className="launchpad-band-track" role="img" aria-label={label} style={{ "--current": `${Math.max(0, Math.min(100, current / 9 * 100))}%`, "--target": `${Math.max(0, Math.min(100, target / 9 * 100))}%` } as CSSProperties}><span /><i /></span>
          </button>;
        })}</div>
        <Link className="launchpad-profile-link" href="/profile">{text.profileLink}<ArrowRight size={14} /></Link>
      </> : <div className="launchpad-no-profile"><Target size={38} strokeWidth={1.2} /><Link href="/profile">{text.emptyAction}<ArrowRight size={16} /></Link></div>}
    </aside>
  </section>;
}
