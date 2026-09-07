"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpenCheck, Check, HelpCircle, LoaderCircle, RotateCcw } from "lucide-react";
import { useState } from "react";

import { PageHeader, SessionGate } from "../app-shell";
import { useDemoSession } from "../providers";
import { api, VocabularyTest } from "@/lib/api";

export default function VocabularyPage() {
  return <SessionGate><VocabularyContent /></SessionGate>;
}

function VocabularyContent() {
  const { token, user } = useDemoSession();
  const client = useQueryClient();
  const dashboard = useQuery({ queryKey: ["dashboard", token], queryFn: () => api.dashboard(token!) });
  const [current, setCurrent] = useState<VocabularyTest | null>(null);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const test = current ?? dashboard.data?.latest_vocabulary_test ?? null;
  const start = useMutation({ mutationFn: () => api.startVocabularyTest(token!), onSuccess: setCurrent });
  const answer = useMutation({
    mutationFn: ({ testId, itemId, option }: { testId: string; itemId: string; option: number }) => api.answerVocabularyItem(token!, testId, { item_id: itemId, selected_option: option }),
    onSuccess: (value) => { setSelectedOption(null); setCurrent(value); if (value.status === "completed") client.invalidateQueries({ queryKey: ["dashboard"] }); },
  });

  return <main className="page">
    <PageHeader eyebrow="词汇测评" title="测出你真正理解的词汇" description="通过词义选择而不是主观判断认识与否，并根据作答动态调整下一题难度。" />
    <div className="vocab-layout">
      <section className="panel vocab-intro">
        <BookOpenCheck size={36} /><h2>测试怎么做？</h2>
        <p>每题会显示一个英文单词和四个候选释义。选择最准确的释义；如果四项都不正确，选择“以上都不是”。</p>
        <ol><li>根据词义作答，不要只凭“看起来眼熟”。</li><li>不查词典；确实不匹配时再选择“以上都不是”。</li><li>测试中不立即显示正误，避免影响后续题目。</li></ol>
        <div className="soft-note"><HelpCircle /><p><strong>结果代表什么？</strong><br />它是学习参考，不等同于 IELTS 分数，也不能替代标准化词汇量测试。</p></div>
      </section>
      <section className="panel vocab-stage">
        {!test || (test.status === "completed" && !test.result) ? <div className="empty-state"><span className="time-orb">约<br /><strong>3</strong><br />分钟</span><h2>准备好了吗？</h2><p>测试通常会在结果足够稳定时提前结束，最多 {test?.max_items ?? 20} 题。</p><button className="primary-button" onClick={() => start.mutate()} disabled={start.isPending}>{start.isPending ? <LoaderCircle className="spin" /> : <BookOpenCheck />}开始测评</button></div>
        : test.status === "in_progress" && test.current_item ? <div className="test-stage">
          <div className="test-progress"><span>第 {test.current_item.sequence} 题</span><span>最多 {test.max_items} 题</span></div>
          <div className="progress-track"><span style={{ width: `${test.answered / test.max_items * 100}%` }} /></div>
          <p className="test-instruction">请选择最符合这个单词的中文释义</p><strong className="test-word">{test.current_item.surface}</strong>
          <div className="vocab-option-grid">{[...test.current_item.options, "以上都不是"].map((option, index) => <button className={selectedOption === index ? "selected" : ""} key={`${test.current_item!.id}-${index}`} onClick={() => setSelectedOption(index)} disabled={answer.isPending}><b>{String.fromCharCode(65 + index)}</b><span>{option}</span>{selectedOption === index && <Check size={17} />}</button>)}</div>
          <button className="primary-button vocab-confirm" onClick={() => selectedOption !== null && answer.mutate({ testId: test.id, itemId: test.current_item!.id, option: selectedOption })} disabled={selectedOption === null || answer.isPending}>{answer.isPending ? <><LoaderCircle className="spin" size={17} />正在记录…</> : "确认答案并继续"}</button>
          {answer.isError && <p className="error-text">提交失败：{answer.error.message}</p>}
        </div> : test.result ? <div className="vocab-result">
          <p className="eyebrow">测评结果</p><h2>接受性词汇能力参考</h2><span className="cefr-result">CEFR {test.result.cefr_reference}</span><strong className="range-result">{test.result.estimated_word_families}</strong><span className="level-result">参考层级：{test.result.level}</span>
          <div className="friendly-result-grid"><div><strong>{Math.round(test.result.meaning_accuracy * 100)}%</strong><span>词义选择正确率</span></div><div><strong>{Math.round(test.result.none_of_above_accuracy * 100)}%</strong><span>排除干扰项正确率</span></div><div><strong>±{test.result.standard_error.toFixed(2)}</strong><span>估计波动范围</span></div></div>
          <p className="vocab-study-focus"><strong>建议重点：</strong>{test.result.study_focus}。重新生成本周计划后，系统会据此调整词汇任务频次。</p>
          <p className="result-disclaimer">{test.result.disclaimer}</p>
          <details className="technical-details" open={user?.preferences.show_learning_details || undefined}><summary>了解测评方法</summary><p>{test.result.calibration_status === "legacy_lexical_decision_result" ? "这是旧版二选一测评数据的兼容展示，请重新测评以获得新版结果。" : "测评借鉴 Vocabulary Size Test 的词义选择形式，并使用五选一猜测参数的 IRT/EAP 更新题目难度。"} 内部能力参数为 {test.result.theta.toFixed(2)}；CEFR 仅为参考标签，题目参数仍需真实考生样本校准。</p></details>
          <button className="secondary-button" onClick={() => start.mutate()} disabled={start.isPending}><RotateCcw size={16} />重新测评</button>
        </div> : null}
      </section>
    </div>
  </main>;
}
