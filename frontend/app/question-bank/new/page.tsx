"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, Plus, Save } from "lucide-react";
import Link from "next/link";
import { FormEvent, useState } from "react";

import { PageHeader, SessionGate } from "../../app-shell";
import { useDemoSession } from "../../providers";
import { api, PracticeQuestionInput, Skill } from "@/lib/api";
import { skillLabels, skills } from "@/lib/ui";

const taskChoices: Record<Skill, { value: string; label: string }[]> = {
  listening: [{ value: "form_completion", label: "表格 / 笔记填空" }, { value: "multiple_choice", label: "选择题" }, { value: "matching", label: "匹配题" }],
  reading: [{ value: "true_false_not_given", label: "True / False / Not Given" }, { value: "multiple_choice", label: "选择题" }, { value: "sentence_completion", label: "句子填空" }, { value: "matching_headings", label: "段落标题匹配" }],
  writing: [{ value: "writing_task_1", label: "Academic Writing Task 1" }, { value: "writing_task_2", label: "Writing Task 2" }],
  speaking: [{ value: "speaking_part_1", label: "Speaking Part 1" }, { value: "speaking_part_2", label: "Speaking Part 2" }, { value: "speaking_part_3", label: "Speaking Part 3" }],
};

type FormState = { module: Skill; task_type: string; source_name: string; passage: string; prompt: string; options: string; correct_answer: string; explanation: string; tags: string };
const initial: FormState = { module: "reading", task_type: "true_false_not_given", source_name: "我的练习套题", passage: "", prompt: "", options: "True\nFalse\nNot Given", correct_answer: "", explanation: "", tags: "" };

export default function NewQuestionPage() {
  return <SessionGate><NewQuestionContent /></SessionGate>;
}

function NewQuestionContent() {
  const { token } = useDemoSession();
  const client = useQueryClient();
  const [form, setForm] = useState<FormState>(initial);
  const [message, setMessage] = useState("");
  const create = useMutation({
    mutationFn: (payload: PracticeQuestionInput) => api.createQuestion(token!, payload),
    onSuccess: () => {
      setMessage("题目已保存到你的私人题库。");
      setForm((current) => ({ ...current, prompt: "", correct_answer: "", explanation: "" }));
      client.invalidateQueries({ queryKey: ["practice-questions"] });
    },
    onError: (error: Error) => setMessage(`保存失败：${error.message}`),
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
    <PageHeader eyebrow="录入练习题" title="用表单建立自己的题库" description="无需编写 JSON。相同套题可以复用材料和套题名称，逐题连续录入。" action={<Link className="secondary-button" href="/question-bank"><ArrowLeft size={16} />返回题库</Link>} />
    {message && <div className={`notice ${create.isError ? "error" : "success"}`}>{!create.isError && <Check size={18} />}{message}</div>}
    <form className="panel question-form" onSubmit={submit}>
      <section><span className="step-number">1</span><div><h2>题目归类</h2><p>先选择科目和题型，便于题库筛选。</p></div></section>
      <div className="form-grid two-columns"><label className="field">科目<select value={form.module} onChange={(event) => setModule(event.target.value as Skill)}>{skills.map((skill) => <option value={skill} key={skill}>{skillLabels[skill]}</option>)}</select></label><label className="field">题型<select value={form.task_type} onChange={(event) => setForm({ ...form, task_type: event.target.value })}>{taskChoices[form.module].map((choice) => <option value={choice.value} key={choice.value}>{choice.label}</option>)}</select></label></div>
      <label className="field">套题名称<input required minLength={1} maxLength={500} value={form.source_name} onChange={(event) => setForm({ ...form, source_name: event.target.value })} placeholder="例如：剑桥练习册 12 Test 1（仅私人使用）" /><small>相同名称的题目会在题库页面归为一组。</small></label>

      <section><span className="step-number">2</span><div><h2>材料与题目</h2><p>阅读填写文章；听力可填写你有权使用的录音文字稿；写作和口语可留空。</p></div></section>
      <label className="field">共用材料（可选）<textarea className="material-input" value={form.passage} onChange={(event) => setForm({ ...form, passage: event.target.value })} placeholder="粘贴阅读文章或听力文字稿…" /></label>
      <label className="field">题目<span className="required">必填</span><textarea required minLength={5} value={form.prompt} onChange={(event) => setForm({ ...form, prompt: event.target.value })} placeholder="输入题干，并保留 NO MORE THAN TWO WORDS 等作答要求…" /></label>
      <label className="field">选项（可选，每行一个）<textarea className="short-textarea" value={form.options} onChange={(event) => setForm({ ...form, options: event.target.value })} placeholder={'选项 A\n选项 B\n选项 C'} /></label>

      <section><span className="step-number">3</span><div><h2>答案与解析</h2><p>答案可以暂不填写；写作与口语题通常只需填写练习建议。</p></div></section>
      <div className="form-grid two-columns"><label className="field">参考答案<input value={form.correct_answer} onChange={(event) => setForm({ ...form, correct_answer: event.target.value })} placeholder="例如：public-health" /></label><label className="field">标签<input value={form.tags} onChange={(event) => setForm({ ...form, tags: event.target.value })} placeholder="定位, 同义替换（逗号分隔）" /></label></div>
      <label className="field">答案解析<textarea className="short-textarea" value={form.explanation} onChange={(event) => setForm({ ...form, explanation: event.target.value })} placeholder="说明答案所在位置、干扰项或解题思路…" /></label>
      <div className="form-footer"><p>请仅录入你合法持有并有权在本项目中使用的内容。私人题目不会向其他账号展示。</p><button className="primary-button" type="submit" disabled={create.isPending || form.prompt.trim().length < 5 || !form.source_name.trim()}>{create.isPending ? <Save /> : <Plus />}{create.isPending ? "正在保存…" : "保存并继续录入"}</button></div>
    </form>
  </main>;
}
