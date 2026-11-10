"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, BookOpen, Check, ChevronRight, Eye, LoaderCircle, Pause, Pencil, Play, RotateCcw, Search, Volume2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { WordCard, vocabulary, VocabularyRequestError } from "@/lib/vocabulary";
import { SessionGate } from "../app-shell";
import { useDemoSession } from "../providers";

function WordDetails({ card }: { card: WordCard }) {
  const { user } = useDemoSession();
  return <div className="word-details"><p className="word-meaning">{card.meaning}</p>{card.example && <blockquote>{card.example}</blockquote>}{card.note && <p>{card.note}</p>}{!card.sources.length && card.legacy_source && <a href={card.legacy_source}>查看原练习 ↗</a>}{!!card.sources.length && <details open={user?.preferences.show_learning_details || undefined}><summary>我的练习 · {card.sources.length}<ChevronRight size={14} /></summary>{card.sources.map((source, i) => <article key={`${source.job_id}:${i}`}><blockquote>{source.original_quote}</blockquote><p>{source.explanation}</p><a href={source.source_link}>{source.source_link.startsWith("/writing") ? "返回作文" : "查看原练习"} ↗</a></article>)}</details>}</div>;
}

function EditCard({ token, card, close }: { token: string; card: WordCard; close: () => void }) {
  const client = useQueryClient();
  const [meaning, setMeaning] = useState(card.meaning), [note, setNote] = useState(card.note);
  const save = useMutation({ mutationFn: () => vocabulary.edit(token, { word: card.word, meaning, note }), onSuccess: () => { client.invalidateQueries({ queryKey: ["word-deck"] }); close(); } });
  return <form className="word-edit" onSubmit={e => { e.preventDefault(); save.mutate(); }}><label>释义<textarea value={meaning} onChange={e => setMeaning(e.target.value)} maxLength={1200} required /></label><label>我的备注<textarea value={note} onChange={e => setNote(e.target.value)} maxLength={2000} /></label><div><button type="button" onClick={close}>取消</button><button className="primary-button" disabled={save.isPending}>保存</button></div>{save.error && <small className="error-text">{save.error.message}</small>}</form>;
}

export default function VocabularyPage() { return <SessionGate><VocabularyContent /></SessionGate>; }

function VocabularyContent() {
  const { token } = useDemoSession();
  const client = useQueryClient();
  const [scope, setScope] = useState("all"), [search, setSearch] = useState(""), [query, setQuery] = useState(""), [offset, setOffset] = useState(0);
  const [queue, setQueue] = useState<WordCard[] | null>(null), [index, setIndex] = useState(0), [revealed, setRevealed] = useState(false);
  const [editing, setEditing] = useState("");
  const [legacy, setLegacy] = useState("");
  const [libraryOpen, setLibraryOpen] = useState(false);
  const studyPanel = useRef<HTMLElement>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (["all", "personal", "due", "learned", "suspended"].includes(params.get("scope") ?? "")) setScope(params.get("scope")!);
    if (params.get("word")) { setSearch(params.get("word")!); setQuery(params.get("word")!); setLibraryOpen(true); }
    if (params.get("test")) setLegacy(params.get("test")!);
  }, []);
  useEffect(() => { const timer = setTimeout(() => { setQuery(search); setOffset(0); }, 250); return () => clearTimeout(timer); }, [search]);
  const cards = useQuery({ queryKey: ["word-deck", token, scope, query, offset], queryFn: () => vocabulary.deck(token!, scope, query, offset), enabled: !!token });
  const oldReview = useQuery({ queryKey: ["legacy-word-review", token, legacy], queryFn: async () => { const { coach } = await import("@/lib/coach"); return coach.vocabularyReview(token!, legacy); }, enabled: !!legacy && !!token });
  const start = useMutation({ mutationFn: () => vocabulary.study(token!, ["personal", "due"].includes(scope) ? scope : "all"), onSuccess: result => { setQueue(result.items); setIndex(0); setRevealed(false); setLibraryOpen(false); } });
  const review = useMutation({ mutationFn: (body: { word: string; rating: string; revision: number; event_id: string }) => vocabulary.review(token!, body), onSuccess: () => { setIndex(i => i + 1); setRevealed(false); client.invalidateQueries({ queryKey: ["word-deck"] }); client.invalidateQueries({ queryKey: ["personal-knowledge"] }); } });
  const suspend = useMutation({ mutationFn: (card: WordCard) => vocabulary.edit(token!, { word: card.word, suspended: !card.suspended }), onSuccess: () => client.invalidateQueries({ queryKey: ["word-deck"] }) });
  useEffect(() => {
    if (queue) { studyPanel.current?.focus({ preventScroll: true }); studyPanel.current?.scrollIntoView({ block: "start" }); }
  }, [queue]);
  const current = queue?.[index];
  const counts = cards.data?.counts;
  const changeScope = (value: string) => { setScope(value); setOffset(0); };
  const speak = (word: string) => { if (typeof speechSynthesis === "undefined") return; speechSynthesis.cancel(); const utterance = new SpeechSynthesisUtterance(word); utterance.lang = "en-GB"; speechSynthesis.speak(utterance); };
  return <main className="page word-page">
    <section className="word-launch" hidden={!!queue}>
      <header className="word-page-heading"><h1>背单词</h1></header>
      <section className="word-stats" aria-label="词汇学习统计">{[
        { scope: "due", icon: RotateCcw, value: counts?.due, label: "待复习" },
        { scope: "personal", icon: Pencil, value: counts?.personal, label: "我的积累" },
        { scope: "learned", icon: Check, value: counts?.learned, label: "已学习" },
        { scope: "all", icon: BookOpen, value: counts?.starter.toLocaleString(), label: "离线词表" },
      ].map(item => <button key={item.scope} className={scope === item.scope ? "active" : ""} aria-pressed={scope === item.scope} onClick={() => changeScope(item.scope)}><item.icon /><strong>{item.value ?? "—"}</strong><span>{item.label}</span></button>)}</section>
      <button className="primary-button word-start-button" onClick={() => start.mutate()} disabled={start.isPending}>{start.isPending ? <LoaderCircle size={21} className="spin" /> : <Play size={21} />}开始学习</button>
    </section>
    {(start.error || cards.error) && <p className="error-text word-launch-error">{start.error?.message || cards.error?.message}</p>}
    {queue && <section ref={studyPanel} tabIndex={-1} className="panel word-study" aria-label="单词复习"><header><span>{Math.min(index + 1, queue.length)} / {queue.length}</span><div className="progress-track"><span style={{ width: `${queue.length ? index / queue.length * 100 : 100}%` }} /></div><button className="coach-icon-button" aria-label="关闭复习" onClick={() => setQueue(null)} disabled={review.isPending}><X size={18} /></button></header>
      {current ? <><div className="word-study-front"><span className="coach-chip">{current.personal ? "我的积累" : "IELTS · 常用词"}</span><h2>{current.word}<button onClick={() => speak(current.word)} aria-label="朗读单词"><Volume2 size={22} /></button></h2>{current.phonetic && <span className="word-phonetic">/{current.phonetic}/</span>}</div>
        {revealed ? <><WordDetails card={current} /><div className="word-rating">{[{ value: "again", label: "忘了", next: "10 分钟" }, { value: "hard", label: "模糊", next: `${Math.max(1, Math.round(current.interval_days * 1.2))} 天` }, { value: "good", label: "记住了", next: `${current.interval_days ? Math.min(90, Math.max(3, Math.round(current.interval_days * 2.3))) : 1} 天` }].map(item => <button key={item.value} className={item.value} disabled={review.isPending || review.isError} onClick={() => review.mutate({ word: current.word, rating: item.value, revision: current.revision, event_id: crypto.randomUUID() })}><strong>{item.label}</strong><small>{item.next}</small></button>)}</div></> : <button className="word-reveal" onClick={() => { setRevealed(true); review.reset(); }}><Eye size={19} />查看释义</button>}
        {review.error && <p className="error-text">{review.error.message}<button onClick={() => { if (review.error instanceof VocabularyRequestError && review.error.status === 409) { review.reset(); start.mutate(); } else if (review.variables) review.mutate(review.variables); }}>{review.error instanceof VocabularyRequestError && review.error.status === 409 ? "重新载入" : "重试保存"}</button></p>}
      </> : <div className="word-study-complete"><Check size={42} /><h2>{queue.length ? "这一组记完了" : "今天的复习已完成"}</h2>{queue.length > 0 && <p>已学习 {queue.length} 个词</p>}<button onClick={() => { setQueue(null); setLibraryOpen(true); }}>查看词表<ArrowRight size={16} /></button></div>}
    </section>}
    {legacy && <details className="panel word-legacy" open><summary>历史测评回顾<button onClick={() => setLegacy("")}>关闭</button></summary>{oldReview.data?.map((item, i) => <p key={i}><strong>{item.word}</strong> · {item.meaning} <span className="coach-chip">{item.correct ? "答对" : "待巩固"}</span></p>)}{oldReview.error && <small>{oldReview.error.message}</small>}</details>}
    <details className="panel word-library" open={libraryOpen} onToggle={event => setLibraryOpen(event.currentTarget.open)}><summary className="word-library-heading"><BookOpen size={20} /><span>单词列表</span><small>{cards.data?.total ?? 0} 个词</small><ChevronRight size={17} /></summary><header><nav className="coach-version-tabs" aria-label="词表筛选">{[{ value: "all", label: "全部" }, { value: "personal", label: "我的积累" }, { value: "due", label: "待复习" }, { value: "learned", label: "已学习" }, { value: "suspended", label: "已搁置" }].map(item => <button key={item.value} className={scope === item.value ? "active" : ""} onClick={() => changeScope(item.value)}>{item.label}</button>)}</nav><label className="word-search"><Search size={17} /><input aria-label="搜索单词" placeholder="搜索单词或释义" value={search} onChange={e => setSearch(e.target.value)} /></label></header>
      {cards.isLoading && <LoaderCircle className="spin" />}{suspend.error && <p className="error-text">{suspend.error.message}</p>}
      <div className="word-list">{cards.data?.items.map(card => <article key={card.word}><details><summary><div><strong>{card.word}</strong>{card.phonetic && <small>/{card.phonetic}/</small>}</div><span className={`coach-chip ${card.personal ? "personal" : ""}`}>{card.personal ? "我的积累" : "词表"}</span><span className="word-list-progress">{card.review_count ? `已复习 ${card.review_count} 次` : "新词"}</span><ChevronRight size={16} /></summary><WordDetails card={card} /><footer><span>{card.review_count ? `已复习 ${card.review_count} 次 · ${card.due_at ? new Date(card.due_at).toLocaleDateString() : ""}` : "新词"}</span><div><button className="text-button" disabled={card.suspended || !!current} onClick={() => { setQueue([card]); setIndex(0); setRevealed(false); setLibraryOpen(false); review.reset(); }}>复习</button><button className="coach-icon-button" aria-label={`编辑 ${card.word}`} onClick={() => setEditing(editing === card.word ? "" : card.word)}><Pencil size={16} /></button><button className="coach-icon-button" aria-label={`${card.suspended ? "恢复" : "搁置"} ${card.word}`} disabled={suspend.isPending} onClick={() => suspend.mutate(card)}>{card.suspended ? <RotateCcw size={16} /> : <Pause size={16} />}</button></div></footer>{editing === card.word && <EditCard token={token!} card={card} close={() => setEditing("")} />}</details></article>)}</div>
      {cards.data && !cards.data.items.length && <div className="empty-state"><BookOpen size={30} /><h3>{scope === "personal" ? "练习中的词汇会积累在这里" : "这里暂时没有单词"}</h3></div>}
      <footer className="word-pagination"><small>{cards.data?.total ?? 0} 个词</small><div><button aria-label="上一页词表" disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 40))}><ArrowLeft size={16} /></button><span>{Math.floor(offset / 40) + 1}</span><button aria-label="下一页词表" disabled={!cards.data || offset + 40 >= cards.data.total} onClick={() => setOffset(offset + 40)}><ArrowRight size={16} /></button></div></footer>
    </details>{counts && <footer className="word-attribution">初始词表：ECDICT · {counts.starter.toLocaleString()} 词 · <a href="https://github.com/skywind3000/ECDICT" target="_blank" rel="noreferrer">来源</a></footer>}
  </main>;
}
