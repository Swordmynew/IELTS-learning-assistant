import type { PlanSkill, Skill, StudyTask } from "./api";
import { getLocale, translate } from "./i18n";

export const skills: Skill[] = ["listening", "reading", "writing", "speaking"];
export const skillLabels = Object.defineProperties({} as Record<PlanSkill, string>, Object.fromEntries(
  [...skills, "vocabulary"].map(skill => [skill, { enumerable: true, get: () => translate(`ui.skill.${skill}`) }]),
));
export const skillRoutes: Record<PlanSkill, string> = {
  listening: "/question-bank?module=listening",
  reading: "/question-bank?module=reading",
  writing: "/writing",
  speaking: "/question-bank?module=speaking",
  vocabulary: "/vocabulary",
};
export const weekdayLabels: string[] = [];
for (let day = 0; day < 7; day++) Object.defineProperty(weekdayLabels, day, {
  enumerable: true, get: () => translate(`ui.weekday.${day}`),
});

export function formatDate(date: string) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(getLocale(), { timeZone: "UTC", month: "long", day: "numeric", weekday: "short" });
}

export function taskAction(task: StudyTask) {
  if (task.skill === "writing") return translate("ui.taskWriting");
  if (task.skill === "vocabulary") return translate("ui.taskVocabulary");
  return translate("ui.taskQuestions", { skill: skillLabels[task.skill] });
}
