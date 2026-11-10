"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, BookOpenCheck, LoaderCircle, Plus, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";
import { SourceKind, vocabulary } from "@/lib/vocabulary";

export function WritingWords({ token, sourceId, sourceKind = "writing_version" }: { token: string; sourceId: string; sourceKind?: SourceKind }) {
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
  return <section className="panel writing-word-panel"><header className="coach-section-heading"><h2><BookOpenCheck size={18} />本篇词汇 {words.length > 0 && <span className="coach-chip">{words.length}</span>}</h2><div className="writing-word-actions">{pending && <LoaderCircle size={15} className="spin" />}<button className="text-button" disabled={pending || request.isPending} onClick={() => request.mutate(failed?.request_type ?? "requested")}>{failed ? <><RefreshCw size={14} />重试积累</> : <><Plus size={14} />积累词汇</>}</button><Link href="/vocabulary?scope=personal">去复习<ArrowUpRight size={15} /></Link></div></header>
    {!!words.length && <div className="writing-word-grid">{words.map(item => <details key={item.word}><summary><strong>{item.word}</strong><span>{item.reason === "spelling" ? "拼写" : item.reason === "usage" ? "用法" : "积累"}</span></summary><p>{item.meaning}</p><blockquote>{item.original_quote}</blockquote><p>{item.explanation}</p><small>{item.example}</small></details>)}</div>}
    {!words.length && <small className="word-empty-line">{pending ? "正在整理词汇…" : completed.length ? "本篇暂无待积累词汇" : "暂无积累"}</small>}
    {(jobs.error || request.error) && <small className="error-text">{jobs.error?.message || request.error?.message}</small>}
  </section>;
}
