import type { PlanSkill, Skill, StudyTask } from "./api";

export const skills: Skill[] = ["listening", "reading", "writing", "speaking"];
export const skillLabels: Record<PlanSkill, string> = { listening: "听力", reading: "阅读", writing: "写作", speaking: "口语", vocabulary: "词汇" };
export const skillRoutes: Record<PlanSkill, string> = {
  listening: "/question-bank?module=listening",
  reading: "/question-bank?module=reading",
  writing: "/writing",
  speaking: "/question-bank?module=speaking",
  vocabulary: "/vocabulary",
};
export const weekdayLabels = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

export function formatDate(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString("zh-CN", { month: "long", day: "numeric", weekday: "short" });
}

export function taskAction(task: StudyTask) {
  if (task.skill === "writing") return "去写作练习";
  if (task.skill === "vocabulary") return "去词汇测评";
  return `去${skillLabels[task.skill]}题库`;
}
