"use client";

import { useI18n, localizeError } from "@/lib/i18n";

import { useQuery } from "@tanstack/react-query";
import { ExternalLink, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { SaveNoteButton } from "./knowledge-editor";

export function DocumentReader({ token, id, initialPage, onClose }: { token: string; id: string; initialPage?: number; onClose: () => void }) {
  const { t } = useI18n();
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
      if (!response.ok) throw new Error("error.documentOriginal");
      if (fileUrl.current) URL.revokeObjectURL(fileUrl.current);
      fileUrl.current = URL.createObjectURL(await response.blob());
      if (!popup) throw new Error("error.documentPopup");
      popup.location.href = fileUrl.current + (page ? `#page=${page}` : "");
    } catch (failure) { popup?.close(); setError((failure as Error).message); }
    finally { setOpening(false); }
  };
  return <section className="panel document-reader" aria-label={t("ui.documentText")}>
    <header className="coach-section-heading"><h2>{content.data?.title ?? t("ui.documentText")}</h2><button className="coach-icon-button" onClick={onClose} aria-label={t("ui.closeDocumentText")}><X size={18} /></button></header>
    <div className="document-reader-controls">{!!content.data?.page_numbers?.length && <label>{t("ui.pageNumber")}<select aria-label={t("ui.documentPageNumber")} value={page} onChange={event => { setPage(event.target.value); setOffset(0); }}><option value="">{t("ui.allText")}</option>{content.data.page_numbers.map(number => <option value={number} key={number}>{t("document.pageLabel", { page: number })}</option>)}</select></label>}{content.data?.original_available && <button className="secondary-button" onClick={openOriginal} disabled={opening}><ExternalLink size={14} />{opening ? t("common.loadingContent") : t("ui.viewOriginalFile")}</button>}</div>
    {(content.error || error) && <p role="alert" className="error-text">{t(localizeError(content.error?.message || error))}</p>}
    {content.isLoading ? <p>{t("common.readingContent")}</p> : content.data?.items?.length ? content.data.items.map(chunk => <article className="document-source-chunk" key={chunk.id}><header><small>{chunk.page ? t("ui.pageValue", { value1: chunk.page }) : t("ui.sectionValue", { value1: chunk.chunk_index + 1 })}</small><SaveNoteButton token={token} source={{ source_type: "document", source_id: id, chunk_id: chunk.id }} title={content.data!.title} text={chunk.content} /></header><p>{chunk.content}</p></article>) : !content.error && <p>{t("ui.noSearchableTextOnThisPage")}</p>}
    {content.data && content.data.total > 50 && <nav className="document-reader-pagination"><button disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 50))}>{t("ui.previousGroup")}</button><span>{offset + 1}–{Math.min(offset + 50, content.data.total)} / {content.data.total}</span><button disabled={offset + 50 >= content.data.total} onClick={() => setOffset(offset + 50)}>{t("ui.nextGroup")}</button></nav>}
  </section>;
}
