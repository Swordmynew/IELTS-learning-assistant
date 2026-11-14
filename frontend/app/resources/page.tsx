"use client";

import { useI18n, localizeError } from "@/lib/i18n";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, FileText, FileUp, FolderOpen } from "lucide-react";
import { useEffect, useState } from "react";
import Link from "next/link";

import { PageHeader, SessionGate } from "../app-shell";
import { useDemoSession } from "../providers";
import { api } from "@/lib/api";
import { DocumentReader } from "./document-reader";
import { PersonalKnowledge } from "./personal-knowledge";
import { TutorScope } from "../floating-tutor";

export default function ResourcesPage() {
  return <SessionGate><ResourcesContent /></SessionGate>;
}

function ResourcesContent() {
  const { t } = useI18n();
  const { token } = useDemoSession();
  const client = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [tab, setTab] = useState("personal");
  const [viewing, setViewing] = useState<{ id: string; page?: number }>();
  const [documentIds, setDocumentIds] = useState<string[]>([]);
  useEffect(() => {
    const selected = new URLSearchParams(window.location.search).get("document");
    if (selected) { setTab("documents"); setDocumentIds([selected]); const page = Number(new URLSearchParams(window.location.search).get("page")); setViewing({ id: selected, page: Number.isInteger(page) && page > 0 ? page : undefined }); }
  }, []);
  const documents = useQuery({
    queryKey: ["knowledge-documents", token], queryFn: () => api.listDocuments(token!),
    refetchInterval: (query) => query.state.data?.some((document) => document.status === "queued") ? 4000 : false,
  });
  const upload = useMutation({
    mutationFn: () => api.uploadDocument(token!, file!),
    onSuccess: () => { setFile(null); client.invalidateQueries({ queryKey: ["knowledge-documents"] }); },
  });

  return <main className="page resources-page">
    <PageHeader title={t("ui.knowledgeLibrary")} />
    <div className="coach-version-tabs"><button className={tab === "personal" ? "active" : ""} onClick={() => setTab("personal")}>{t("ui.myLearning")}</button><button className={tab === "documents" ? "active" : ""} onClick={() => setTab("documents")}>{t("ui.documentsAndNotes")}</button></div>
    {tab === "personal" ? <PersonalKnowledge token={token!} /> : <>
    <div className="resource-layout">
      <details className="panel upload-disclosure"><summary><FileUp size={19} />{t("ui.uploadNotes")}</summary><div className="upload-zone">
        <p>{t("ui.txtMarkdownPdfDocx")}</p>
        <label className="file-picker"><input type="file" accept=".pdf,.docx,.txt,.md" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /><span>{file ? file.name : t("ui.chooseFile")}</span></label>
        <button className="primary-button full-button" onClick={() => upload.mutate()} disabled={!file || upload.isPending}>{upload.isPending ? t("ui.uploading") : t("ui.upload")}</button>
        {upload.error && <p className="error-text">{t("common.errorUploading", { error: localizeError(upload.error.message) })}</p>}
        <Link href="/question-bank/new" className="coach-bank-link">{t("ui.addPracticeQuestions")}</Link>
      </div></details>
      <section className="panel document-panel">
        <div className="panel-heading"><div><p className="eyebrow">{t("ui.documents")}</p><h2>{t("document.documentCount", { count: documents.data?.length ?? 0 })}</h2></div><FolderOpen /></div>
        <div className="document-list">{documents.isLoading ? <p>{t("common.readingContent")}</p> : documents.data?.map((document) => <article key={document.id}>
          <input type="checkbox" aria-label={t("ui.selectDocumentValue", { value1: document.title })} disabled={document.status !== "completed"} checked={documentIds.includes(document.id)} onChange={event => setDocumentIds(ids => event.target.checked ? [...ids, document.id] : ids.filter(id => id !== document.id))} /><div className="document-icon"><FileText /></div><div><strong>{document.title}</strong><span>{document.filename}</span><small>{document.is_private ? t("ui.privateDocument") : t("ui.projectReferenceMaterial")}</small>{document.error && <em>{localizeError(document.error)}</em>}{document.status === "completed" && <button className="document-read-button" onClick={() => setViewing({ id: document.id })}>{t("ui.showTranscript")}</button>}</div><span className={`document-status ${document.status}`}>{document.status === "completed" ? <><CheckCircle2 />{t("ui.searchable")}</> : document.status === "failed" ? t("ui.processingFailed") : t("ui.processing")}</span>
        </article>)}</div>
      </section>
    </div>
    {viewing && <DocumentReader key={`${viewing.id}:${viewing.page ?? ""}`} token={token!} id={viewing.id} initialPage={viewing.page} onClose={() => setViewing(undefined)} />}
    <TutorScope documentIds={documentIds} />
    </>}
  </main>;
}
