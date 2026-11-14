"use client";

import { useI18n, localizeError } from "@/lib/i18n";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, Plus, Save } from "lucide-react";
import Link from "next/link";
import { FormEvent, useState } from "react";

import { PageHeader, SessionGate } from "../../app-shell";
import { useDemoSession } from "../../providers";
import { api, PracticeQuestionInput, Skill } from "@/lib/api";
import { skillLabels, skills } from "@/lib/ui";

const taskChoices: Record<Skill, { value: string; label: string }[]> = {
  listening: [{ value: "form_completion", label: "ui.formNoteCompletion" }, { value: "multiple_choice", label: "ui.multipleChoice" }, { value: "matching", label: "ui.matching" }],
  reading: [{ value: "true_false_not_given", label: "ui.trueFalseNotGiven" }, { value: "multiple_choice", label: "ui.multipleChoice" }, { value: "sentence_completion", label: "ui.sentenceCompletion" }, { value: "matching_headings", label: "ui.matchingHeadings" }],
  writing: [{ value: "writing_task_1", label: "ui.academicWritingTask1" }, { value: "writing_task_2", label: "writing.task2" }],
  speaking: [{ value: "speaking_part_1", label: "question.speakingPart1" }, { value: "speaking_part_2", label: "ui.speakingPart2" }, { value: "speaking_part_3", label: "ui.speakingPart3" }],
};

type FormState = { module: Skill; task_type: string; source_name: string; passage: string; prompt: string; options: string; correct_answer: string; explanation: string; tags: string };
const initial: FormState = { module: "reading", task_type: "true_false_not_given", source_name: "ui.myPracticeSet", passage: "", prompt: "", options: "True\nFalse\nNot Given", correct_answer: "", explanation: "", tags: "" };

export default function NewQuestionPage() {
  return <SessionGate><NewQuestionContent /></SessionGate>;
}

function NewQuestionContent() {
  const { t } = useI18n();
  const { token } = useDemoSession();
  const client = useQueryClient();
  const [form, setForm] = useState<FormState>(() => ({ ...initial, source_name: t(initial.source_name) }));
  const [message, setMessage] = useState("");
  const create = useMutation({
    mutationFn: (payload: PracticeQuestionInput) => api.createQuestion(token!, payload),
    onSuccess: () => {
      setMessage("ui.saved");
      setForm((current) => ({ ...current, prompt: "", correct_answer: "", explanation: "" }));
      client.invalidateQueries({ queryKey: ["practice-questions"] });
    },
    onError: (error: Error) => setMessage("ui.couldNotSaveValue"),
  });
  const submit = (event: FormEvent) => {
    event.preventDefault(); setMessage("");
    create.mutate({
      module: form.module,
      task_type: form.task_type,
      question_type: form.options.trim() ? "single_choice" : "short_answer",
      source_name: form.source_name.trim(),
      passage: form.passage.trim() || undefined,
      prompt: form.prompt.trim(),
      options: form.options.split("\n").map((item) => item.trim()).filter(Boolean),
      correct_answer: form.correct_answer.trim() || undefined,
      explanation: form.explanation.trim() || undefined,
      tags: form.tags.split(/[,，]/).map((item) => item.trim()).filter(Boolean),
    });
  };
  const setModule = (module: Skill) => setForm({ ...form, module, task_type: taskChoices[module][0].value, options: module === "reading" ? "True\nFalse\nNot Given" : "" });

  return <main className="page narrow-page">
    <PageHeader title={t("ui.addPracticeQuestion")} action={<Link className="secondary-button" href="/question-bank"><ArrowLeft size={16} />{t("ui.backToQuestionBank")}</Link>} />
    {message && <div className={`notice ${create.isError ? "error" : "success"}`}>{!create.isError && <Check size={18} />}{t(message, { value1: localizeError(create.error?.message ?? "") })}</div>}
    <form className="panel question-form" onSubmit={submit}>
      <section><span className="step-number">1</span><div><h2>{t("ui.questionCategory")}</h2></div></section>
      <div className="form-grid two-columns"><label className="field">{t("ui.subject")}<select value={form.module} onChange={(event) => setModule(event.target.value as Skill)}>{skills.map((skill) => <option value={skill} key={skill}>{skillLabels[skill]}</option>)}</select></label><label className="field">{t("ui.questionType")}<select value={form.task_type} onChange={(event) => setForm({ ...form, task_type: event.target.value })}>{taskChoices[form.module].map((choice) => <option value={choice.value} key={choice.value}>{t(choice.label)}</option>)}</select></label></div>
      <label className="field">{t("ui.setName")}<input required minLength={1} maxLength={500} value={form.source_name} onChange={(event) => setForm({ ...form, source_name: event.target.value })} placeholder={t("ui.eGMyReadingPracticeTest1")} /><small>{t("ui.questionsWithTheSameNameFormASet")}</small></label>

      <section><span className="step-number">2</span><div><h2>{t("ui.passageAndQuestion")}</h2></div></section>
      <label className="field">{t("ui.readingPassageListeningTranscriptOptional")}<textarea className="material-input" value={form.passage} onChange={(event) => setForm({ ...form, passage: event.target.value })} placeholder={t("ui.pasteAReadingPassageOrListeningTranscript")} /></label>
      <label className="field">{t("ui.question")}<span className="required">{t("ui.required")}</span><textarea required minLength={5} value={form.prompt} onChange={(event) => setForm({ ...form, prompt: event.target.value })} placeholder={t("ui.questionAndAnswerRequirementsIncludingWordLimits")} /></label>
      <label className="field">{t("ui.optionsOptionalOnePerLine")}<textarea className="short-textarea" value={form.options} onChange={(event) => setForm({ ...form, options: event.target.value })} placeholder={t("ui.optionAOptionBOptionC")} /></label>

      <section><span className="step-number">3</span><div><h2>{t("ui.answerAndExplanation")}</h2></div></section>
      <div className="form-grid two-columns"><label className="field">{t("ui.suggestedAnswerOptional")}<input value={form.correct_answer} onChange={(event) => setForm({ ...form, correct_answer: event.target.value })} placeholder={t("ui.eGPublicHealth")} /></label><label className="field">{t("ui.tags")}<input value={form.tags} onChange={(event) => setForm({ ...form, tags: event.target.value })} placeholder={t("ui.eGLocatingInformationParaphrasingCommaSeparated")} /></label></div>
      <label className="field">{t("ui.answerExplanationOptional")}<textarea className="short-textarea" value={form.explanation} onChange={(event) => setForm({ ...form, explanation: event.target.value })} placeholder={t("ui.explainWhereToFindTheAnswerDistractorsOrTheApproach")} /></label>
      <div className="form-footer"><button className="primary-button" type="submit" disabled={create.isPending || form.prompt.trim().length < 5 || !form.source_name.trim()}>{create.isPending ? <Save /> : <Plus />}{create.isPending ? t("ui.saving") : t("ui.saveAndAddAnother")}</button></div>
    </form>
  </main>;
}
