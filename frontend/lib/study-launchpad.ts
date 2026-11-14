import type { Profile, Skill, StudyTask } from "./api";

export const launchpadSkills: Skill[] = ["listening", "reading", "writing", "speaking"];

export function nextStudySession(profile: Profile | null, tasks: StudyTask[], today: string, minutes: number, selected: Skill | null) {
  const gap = (skill: StudyTask["skill"]) => profile && skill !== "vocabulary"
    ? profile.target_scores[skill] - profile.current_scores[skill] : 0;
  const focus = selected ?? [...launchpadSkills].sort((a, b) => gap(b) - gap(a))[0];
  // Only surface due tasks that fit. Never move a future task or alter the plan.
  const task = tasks.filter(item => !item.completed && item.scheduled_date <= today
    && item.duration_minutes > 0 && item.duration_minutes <= minutes
    && (!selected || item.skill === selected))
    .sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date)
      || gap(b.skill) - gap(a.skill) || b.priority - a.priority
      || b.duration_minutes - a.duration_minutes || a.id.localeCompare(b.id))[0];
  return { task, skill: task?.skill ?? (profile || selected ? focus : "vocabulary"), minutes: task?.duration_minutes ?? minutes };
}
