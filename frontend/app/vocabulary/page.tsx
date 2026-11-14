"use client";

import { useI18n, localizeError } from "@/lib/i18n";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, BookOpen, Check, ChevronRight, Eye, LoaderCircle, Pause, Pencil, Play, RotateCcw, Search, Volume2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { WordCard, vocabulary, VocabularyRequestError } from "@/lib/vocabulary";
import { SessionGate } from "../app-shell";
import { useDemoSession } from "../providers";

function WordDetails({ card }: { card: WordCard }) {
  const { t } = useI18n();
  const { user } = useDemoSession();
  return <div className="word-details"><p className="word-meaning">{card.meaning}</p>{card.example && <blockquote>{card.example}</blockquote>}{card.note && <p>{card.note}</p>}{!card.sources.length && card.legacy_source && <a href={card.legacy_source}>{t("ui.viewOriginalPractice")}</a>}{!!card.sources.length && <details open={user?.preferences.show_learning_details || undefined}><summary>{t("vocabulary.practiceCount", { count: card.sources.length })}<ChevronRight size={14} /></summary>{card.sources.map((source, i) => <article key={`${source.job_id}:${i}`}><blockquote>{source.original_quote}</blockquote><p>{source.explanation}</p><a href={source.source_link}>{source.source_link.startsWith("/writing") ? t("ui.backToEssay") : t("ui.viewOriginalPractice2")} ↗</a></article>)}</details>}</div>;
}

function EditCard({ token, card, close }: { token: string; card: WordCard; close: () => void }) {
  const { t } = useI18n();
  const client = useQueryClient();
  const [meaning, setMeaning] = useState(card.meaning), [note, setNote] = useState(card.note);
  const save = useMutation({ mutationFn: () => vocabulary.edit(token, { word: card.word, meaning, note }), onSuccess: () => { client.invalidateQueries({ queryKey: ["word-deck"] }); close(); } });
  return <form className="word-edit" onSubmit={e => { e.preventDefault(); save.mutate(); }}><label>{t("ui.meaning")}<textarea value={meaning} onChange={e => setMeaning(e.target.value)} maxLength={1200} required /></label><label>{t("ui.myNotes")}<textarea value={note} onChange={e => setNote(e.target.value)} maxLength={2000} /></label><div><button type="button" onClick={close}>{t("ui.cancel")}</button><button className="primary-button" disabled={save.isPending}>{t("ui.save2")}</button></div>{save.error && <small className="error-text">{localizeError(save.error.message)}</small>}</form>;
}

export default function VocabularyPage() {
   return <SessionGate><VocabularyContent /></SessionGate>; }

function VocabularyContent() {
  const { t, formatDate, locale } = useI18n();
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
      <header className="word-page-heading"><h1>{t("ui.vocabulary")}</h1></header>
      <section className="word-stats" aria-label={t("ui.vocabularyStatistics")}>{[
        { scope: "due", icon: RotateCcw, value: counts?.due, label: t("ui.toReview2") },
        { scope: "personal", icon: Pencil, value: counts?.personal, label: t("ui.myWords") },
        { scope: "learned", icon: Check, value: counts?.learned, label: t("ui.studied") },
        { scope: "all", icon: BookOpen, value: counts?.starter.toLocaleString(locale), label: t("ui.offlineWordList") },
      ].map(item => <button key={item.scope} className={scope === item.scope ? "active" : ""} aria-pressed={scope === item.scope} onClick={() => changeScope(item.scope)}><item.icon /><strong>{item.value ?? "—"}</strong><span>{item.label}</span></button>)}</section>
      <button className="primary-button word-start-button" onClick={() => start.mutate()} disabled={start.isPending}>{start.isPending ? <LoaderCircle size={21} className="spin" /> : <Play size={21} />}{t("ui.startLearning")}</button>
    </section>
    {(start.error || cards.error) && <p className="error-text word-launch-error">{localizeError(start.error?.message ?? "") || localizeError(cards.error?.message ?? "")}</p>}
    {queue && <section ref={studyPanel} tabIndex={-1} className="panel word-study" aria-label={t("ui.vocabularyReview")}><header><span>{Math.min(index + 1, queue.length)} / {queue.length}</span><div className="progress-track"><span style={{ width: `${queue.length ? index / queue.length * 100 : 100}%` }} /></div><button className="coach-icon-button" aria-label={t("ui.closeReview")} onClick={() => setQueue(null)} disabled={review.isPending}><X size={18} /></button></header>
      {current ? <><div className="word-study-front"><span className="coach-chip">{current.personal ? t("ui.myWords") : t("ui.ieltsCommonWords")}</span><h2>{current.word}<button onClick={() => speak(current.word)} aria-label={t("ui.pronounceWord")}><Volume2 size={22} /></button></h2>{current.phonetic && <span className="word-phonetic">/{current.phonetic}/</span>}</div>
        {revealed ? <><WordDetails card={current} /><div className="word-rating">{[{ value: "again", label: t("ui.forgot"), next: t("ui.10Minutes") }, { value: "hard", label: t("ui.unsure"), next: t("vocabulary.reviewIntervalDays", { value1: Math.max(1, Math.round(current.interval_days * 1.2)) }) }, { value: "good", label: t("ui.remembered"), next: t("vocabulary.reviewIntervalDays", { value1: current.interval_days ? Math.min(90, Math.max(3, Math.round(current.interval_days * 2.3))) : 1 }) }].map(item => <button key={item.value} className={item.value} disabled={review.isPending || review.isError} onClick={() => review.mutate({ word: current.word, rating: item.value, revision: current.revision, event_id: crypto.randomUUID() })}><strong>{item.label}</strong><small>{item.next}</small></button>)}</div></> : <button className="word-reveal" onClick={() => { setRevealed(true); review.reset(); }}><Eye size={19} />{t("ui.showMeaning")}</button>}
        {review.error && <p className="error-text">{localizeError(review.error.message)}<button onClick={() => { if (review.error instanceof VocabularyRequestError && review.error.status === 409) { review.reset(); start.mutate(); } else if (review.variables) review.mutate(review.variables); }}>{review.error instanceof VocabularyRequestError && review.error.status === 409 ? t("ui.reload") : t("ui.retrySaving")}</button></p>}
      </> : <div className="word-study-complete"><Check size={42} /><h2>{queue.length ? t("ui.setComplete") : t("ui.todaySReviewsAreComplete")}</h2>{queue.length > 0 && <p>{t("vocabulary.studiedCount", { count: queue.length })}</p>}<button onClick={() => { setQueue(null); setLibraryOpen(true); }}>{t("ui.viewWordList")}<ArrowRight size={16} /></button></div>}
    </section>}
    {legacy && <details className="panel word-legacy" open><summary>{t("ui.previousTestReview")}<button onClick={() => setLegacy("")}>{t("ui.close")}</button></summary>{oldReview.data?.map((item, i) => <p key={i}><strong>{item.word}</strong> · {item.meaning} <span className="coach-chip">{item.correct ? t("ui.correct2") : t("ui.needsPractice")}</span></p>)}{oldReview.error && <small>{localizeError(oldReview.error.message)}</small>}</details>}
    <details className="panel word-library" open={libraryOpen} onToggle={event => setLibraryOpen(event.currentTarget.open)}><summary className="word-library-heading"><BookOpen size={20} /><span>{t("ui.wordList")}</span><small>{t("common.wordsCount", { count: cards.data?.total ?? 0 })}</small><ChevronRight size={17} /></summary><header><nav className="coach-version-tabs" aria-label={t("ui.filterWordList")}>{[{ value: "all", label: t("ui.all") }, { value: "personal", label: t("ui.myWords") }, { value: "due", label: t("ui.toReview2") }, { value: "learned", label: t("ui.studied") }, { value: "suspended", label: t("ui.suspended") }].map(item => <button key={item.value} className={scope === item.value ? "active" : ""} onClick={() => changeScope(item.value)}>{item.label}</button>)}</nav><label className="word-search"><Search size={17} /><input aria-label={t("ui.searchWords")} placeholder={t("ui.searchWordsOrMeanings")} value={search} onChange={e => setSearch(e.target.value)} /></label></header>
      {cards.isLoading && <LoaderCircle className="spin" />}{suspend.error && <p className="error-text">{localizeError(suspend.error.message)}</p>}
      <div className="word-list">{cards.data?.items.map(card => <article key={card.word}><details><summary><div><strong>{card.word}</strong>{card.phonetic && <small>/{card.phonetic}/</small>}</div><span className={`coach-chip ${card.personal ? "personal" : ""}`}>{card.personal ? t("ui.myWords") : t("ui.wordList2")}</span><span className="word-list-progress">{card.review_count ? t("ui.reviewedValueTimes", { value1: card.review_count }) : t("ui.newWord")}</span><ChevronRight size={16} /></summary><WordDetails card={card} /><footer><span>{card.review_count ? t("ui.reviewedValueTimesValue", { value1: card.review_count, value2: card.due_at ? formatDate(card.due_at) : "" }) : t("ui.newWord")}</span><div><button className="text-button" disabled={card.suspended || !!current} onClick={() => { setQueue([card]); setIndex(0); setRevealed(false); setLibraryOpen(false); review.reset(); }}>{t("ui.review")}</button><button className="coach-icon-button" aria-label={t("ui.editValue", { value1: card.word })} onClick={() => setEditing(editing === card.word ? "" : card.word)}><Pencil size={16} /></button><button className="coach-icon-button" aria-label={t(card.suspended ? "vocabulary.restoreWord" : "vocabulary.suspendWord", { word: card.word })} disabled={suspend.isPending} onClick={() => suspend.mutate(card)}>{card.suspended ? <RotateCcw size={16} /> : <Pause size={16} />}</button></div></footer>{editing === card.word && <EditCard token={token!} card={card} close={() => setEditing("")} />}</details></article>)}</div>
      {cards.data && !cards.data.items.length && <div className="empty-state"><BookOpen size={30} /><h3>{scope === "personal" ? t("ui.wordsFromYourPracticeWillAppearHere") : t("ui.noWordsHereYet")}</h3></div>}
      <footer className="word-pagination"><small>{t("common.wordsCount", { count: cards.data?.total ?? 0 })}</small><div><button aria-label={t("ui.previousWordListPage")} disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 40))}><ArrowLeft size={16} /></button><span>{Math.floor(offset / 40) + 1}</span><button aria-label={t("ui.nextWordListPage")} disabled={!cards.data || offset + 40 >= cards.data.total} onClick={() => setOffset(offset + 40)}><ArrowRight size={16} /></button></div></footer>
    </details>{counts && <footer className="word-attribution">{t("vocabulary.attribution", { count: counts.starter.toLocaleString(locale) })}<a href="https://github.com/skywind3000/ECDICT" target="_blank" rel="noreferrer">{t("ui.source3")}</a></footer>}
  </main>;
}
