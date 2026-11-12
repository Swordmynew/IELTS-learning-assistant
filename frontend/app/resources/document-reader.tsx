"use client";

import { useQuery } from "@tanstack/react-query";
import { ExternalLink, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { SaveNoteButton } from "./knowledge-editor";

export function DocumentReader({ token, id, initialPage, onClose }: { token: string; id: string; initialPage?: number; onClose: () => void }) {
  const [page, setPage] = useState(initialPage?.toString() ?? "");
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState("");
  const [opening, setOpening] = useState(false);
  const fileUrl = useRef<string | undefined>(undefined);
  const content = useQuery({ queryKey: ["document-source", token, id, page, offset], queryFn: () => api.documentChunks(token, id, page ? Number(page) : undefined, offset) });
  useEffect(() => () => { if (fileUrl.current) URL.revokeObjectURL(fileUrl.current); }, []);
  const openOriginal = async () => {
    const popup = window.open("about:blank", "_blank");
    setOpening(true); setError("");
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? "/api/v1"}/knowledge/documents/${encodeURIComponent(id)}/file`, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error("无法读取原文件");
      if (fileUrl.current) URL.revokeObjectURL(fileUrl.current);
      fileUrl.current = URL.createObjectURL(await response.blob());
      if (!popup) throw new Error("请允许打开资料预览窗口后重试");
      popup.location.href = fileUrl.current + (page ? `#page=${page}` : "");
    } catch (failure) { popup?.close(); setError((failure as Error).message); }
    finally { setOpening(false); }
  };
  return <section className="panel document-reader" aria-label="资料原文">
    <header className="coach-section-heading"><h2>{content.data?.title ?? "资料原文"}</h2><button className="coach-icon-button" onClick={onClose} aria-label="关闭资料原文"><X size={18} /></button></header>
    <div className="document-reader-controls">{!!content.data?.page_numbers?.length && <label>页码<select aria-label="资料页码" value={page} onChange={event => { setPage(event.target.value); setOffset(0); }}><option value="">全部文字</option>{content.data.page_numbers.map(number => <option value={number} key={number}>第 {number} 页</option>)}</select></label>}{content.data?.original_available && <button className="secondary-button" onClick={openOriginal} disabled={opening}><ExternalLink size={14} />{opening ? "读取中…" : "查看原文件"}</button>}</div>
    {(content.error || error) && <p role="alert" className="error-text">{content.error?.message || error}</p>}
    {content.isLoading ? <p>正在读取…</p> : content.data?.items?.length ? content.data.items.map(chunk => <article className="document-source-chunk" key={chunk.id}><header><small>{chunk.page ? `第 ${chunk.page} 页` : `片段 ${chunk.chunk_index + 1}`}</small><SaveNoteButton token={token} source={{ source_type: "document", source_id: id, chunk_id: chunk.id }} title={content.data!.title} text={chunk.content} /></header><p>{chunk.content}</p></article>) : !content.error && <p>此页没有可检索文字</p>}
    {content.data && content.data.total > 50 && <nav className="document-reader-pagination"><button disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 50))}>上一组</button><span>{offset + 1}–{Math.min(offset + 50, content.data.total)} / {content.data.total}</span><button disabled={offset + 50 >= content.data.total} onClick={() => setOffset(offset + 50)}>下一组</button></nav>}
  </section>;
}
