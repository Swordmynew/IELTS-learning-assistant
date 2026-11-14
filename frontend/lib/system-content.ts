import { getLocale, localizeSystemText, translate } from "./i18n";
import type { StudyPlan, WritingAssessment } from "./api";
import type { Demo, DisplayField } from "./coach";

export function recordContent(content: string, fields?: DisplayField[]) {
  return fields?.length ? fields.map(field => translate("system.record.field", {
    label: translate(field.label_key), value: field.value_key ? translate(field.value_key) : field.value,
  })).join("\n") : content;
}

export function taskTypeLabel(type: string) {
  const key = `system.task.${type}`;
  const label = translate(key);
  return label === key ? type : label;
}

export function planRationale(plan: StudyPlan): string {
  const match = /^已按照你每天可用的时间安排任务，本周优先加强(.+)。词汇复习按到期词卡和个人积累安排，当前有 (\d+) 个词待复习。$/.exec(plan.rationale);
  if (!match) return plan.rationale;
  const skills: Record<string, string> = { 听力: "listening", 阅读: "reading", 写作: "writing", 口语: "speaking", 词汇: "vocabulary" };
  const labels = match[1].split("、");
  if (labels.some(label => !skills[label])) return plan.rationale;
  const focus = new Intl.ListFormat(getLocale(), { type: "conjunction" }).format(labels.map(label => translate(`ui.skill.${skills[label]}`)));
  return translate("system.plan.rationale", { focus, due: match[2] });
}

export function planConflict(text: string): string {
  const missing = /^可用时间不足，未能安排必需任务：([a-z_0-9]+)$/.exec(text);
  if (missing) return translate("system.plan.missingTask", { task: taskTypeLabel(missing[1]) });
  const outside = /^(\d{4}-\d{2}-\d{2}) is outside the valid pre-exam plan range$/.exec(text);
  if (outside) return translate("system.plan.outOfRange", { date: outside[1] });
  const capacity = /^(\d{4}-\d{2}-\d{2}) scheduled (\d+) minutes but limit is (\d+)$/.exec(text);
  if (capacity) return translate("system.plan.overCapacity", { date: capacity[1], used: capacity[2], limit: capacity[3] });
  const highLoad = /^(\d{4}-\d{2}-\d{2}) has more than two high-load tasks$/.exec(text);
  if (highLoad) return translate("system.plan.highLoad", { date: highLoad[1] });
  return localizeSystemText(text);
}

export function sourceSummary(text: string) {
  return text.split(" · ").map(localizeSystemText).join(" · ");
}

/** Only the explicitly identified local baseline is localised; live feedback is untouched. */
export function writingAssessmentView(assessment: WritingAssessment): WritingAssessment {
  if (assessment.model_used !== "deterministic-demo-baseline") return assessment;
  const rewrite = /^原句：([\s\S]*)\n建议：先明确本段中心观点，再补充原因与具体例证。$/.exec(assessment.rewrite_example);
  return { ...assessment,
    criteria: assessment.criteria.map(item => ({ ...item, explanation: localizeSystemText(item.explanation) })),
    top_priorities: assessment.top_priorities.map(text => {
      const count = /^将正文扩展到至少 (\d+) 词，并完整回应题目要求$/.exec(text);
      return count ? translate("system.writing.wordCount", { count: count[1] }) : localizeSystemText(text);
    }),
    rewrite_example: rewrite ? translate("system.writing.rewrite", { quote: rewrite[1] }) : assessment.rewrite_example,
    next_exercise: localizeSystemText(assessment.next_exercise),
  };
}

/** Fixed project-authored examples, never a model response or a learner record. */
export function demoView(demo: Demo): Demo {
  return { ...demo,
    knowledge: demo.knowledge.map(item => ({ ...item, title: localizeSystemText(item.title), content: localizeSystemText(item.content) })),
    versions: demo.versions.map(version => ({ ...version,
      issues: version.issues.map(issue => ({ ...issue, title: localizeSystemText(issue.title), text: localizeSystemText(issue.text), source: localizeSystemText(issue.source) })),
      hints: version.hints.map(localizeSystemText),
    })),
    answer: localizeSystemText(demo.answer),
    citations: demo.citations.map(source => ({ ...source, title: localizeSystemText(source.title), excerpt: localizeSystemText(source.excerpt) })),
  };
}
