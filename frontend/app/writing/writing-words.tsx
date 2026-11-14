"use client";

import { useI18n, localizeError } from "@/lib/i18n";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, BookOpenCheck, LoaderCircle, Plus, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";
import { SourceKind, vocabulary } from "@/lib/vocabulary";

export function WritingWords({ token, sourceId, sourceKind = "writing_version" }: { token: string; sourceId: string; sourceKind?: SourceKind }) {
  const { t } = useI18n();
  const client = useQueryClient();
  const jobs = useQuery({ queryKey: ["writing-words", token, sourceId, sourceKind], queryFn: () => vocabulary.jobs(token, sourceId, sourceKind),
    refetchInterval: query => query.state.data?.some(job => ["queued", "running"].includes(job.status)) ? 2000 : false,
  });
  const request = useMutation({ mutationFn: (type: "requested" | "automatic") => vocabulary.extract(token, sourceId, sourceKind, type), onSuccess: () => jobs.refetch() });
  const completed = jobs.data?.filter(job => job.status === "completed") ?? [];
  const words = [...new Map(completed.flatMap(job => job.words).map(word => [word.word, word])).values()];
  const pending = jobs.data?.some(job => ["queued", "running"].includes(job.status));
  const failed = jobs.data?.find(job => ["failed", "unavailable"].includes(job.status));
  const completedIds = completed.map(job => job.id).join(",");
  useEffect(() => {
    if (completedIds) {
      client.invalidateQueries({ queryKey: ["word-deck"] });
      client.invalidateQueries({ queryKey: ["personal-knowledge"] });
    }
  }, [completedIds, client]);
  return <section className="panel writing-word-panel"><header className="coach-section-heading"><h2><BookOpenCheck size={18} />{t("ui.wordsFromThisEssay")}{words.length > 0 && <span className="coach-chip">{words.length}</span>}</h2><div className="writing-word-actions">{pending && <LoaderCircle size={15} className="spin" />}<button className="text-button" disabled={pending || request.isPending} onClick={() => request.mutate(failed?.request_type ?? "requested")}>{failed ? <><RefreshCw size={14} />{t("ui.retryExtraction")}</> : <><Plus size={14} />{t("ui.collectVocabulary")}</>}</button><Link href="/vocabulary?scope=personal">{t("ui.reviewWords")}<ArrowUpRight size={15} /></Link></div></header>
    {!!words.length && <div className="writing-word-grid">{words.map(item => <details key={item.word}><summary><strong>{item.word}</strong><span>{item.reason === "spelling" ? t("ui.spelling") : item.reason === "usage" ? t("ui.usage") : t("ui.collected")}</span></summary><p>{item.meaning}</p><blockquote>{item.original_quote}</blockquote><p>{item.explanation}</p><small>{item.example}</small></details>)}</div>}
    {!words.length && <small className="word-empty-line">{pending ? t("ui.collectingVocabulary") : completed.length ? t("ui.noVocabularyToCollectFromThisEssay") : t("ui.nothingSavedYet")}</small>}
    {(jobs.error || request.error) && <small className="error-text">{localizeError(jobs.error?.message ?? "") || localizeError(request.error?.message ?? "")}</small>}
  </section>;
}
