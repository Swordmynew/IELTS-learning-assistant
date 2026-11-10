"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, FileText, FileUp, FolderOpen } from "lucide-react";
import { useEffect, useState } from "react";
import Link from "next/link";

import { PageHeader, SessionGate } from "../app-shell";
import { useDemoSession } from "../providers";
import { api } from "@/lib/api";
import { PersonalKnowledge } from "./personal-knowledge";
import { TutorScope } from "../floating-tutor";

export default function ResourcesPage() {
  return <SessionGate><ResourcesContent /></SessionGate>;
}

function ResourcesContent() {
  const { token } = useDemoSession();
  const client = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [tab, setTab] = useState("personal");
  const [documentIds, setDocumentIds] = useState<string[]>([]);
  useEffect(() => {
    const selected = new URLSearchParams(window.location.search).get("document");
    if (selected) { setTab("documents"); setDocumentIds([selected]); }
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
    <PageHeader title="个人知识库" />
    <div className="coach-version-tabs"><button className={tab === "personal" ? "active" : ""} onClick={() => setTab("personal")}>个人积累</button><button className={tab === "documents" ? "active" : ""} onClick={() => setTab("documents")}>资料与笔记</button></div>
    {tab === "personal" ? <PersonalKnowledge token={token!} /> : <>
    <div className="resource-layout">
      <details className="panel upload-disclosure"><summary><FileUp size={19} />上传笔记</summary><div className="upload-zone">
        <p>TXT · Markdown · PDF · DOCX</p>
        <label className="file-picker"><input type="file" accept=".pdf,.docx,.txt,.md" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /><span>{file ? file.name : "选择文件"}</span></label>
        <button className="primary-button full-button" onClick={() => upload.mutate()} disabled={!file || upload.isPending}>{upload.isPending ? "正在上传…" : "上传"}</button>
        {upload.error && <p className="error-text">上传失败：{upload.error.message}</p>}
        <Link href="/question-bank/new" className="coach-bank-link">录入练习题 →</Link>
      </div></details>
      <section className="panel document-panel">
        <div className="panel-heading"><div><p className="eyebrow">资料</p><h2>{documents.data?.length ?? 0} 份文档</h2></div><FolderOpen /></div>
        <div className="document-list">{documents.isLoading ? <p>正在读取…</p> : documents.data?.map((document) => <article key={document.id}>
          <input type="checkbox" aria-label={`选择资料 ${document.title}`} disabled={document.status !== "completed"} checked={documentIds.includes(document.id)} onChange={event => setDocumentIds(ids => event.target.checked ? [...ids, document.id] : ids.filter(id => id !== document.id))} /><div className="document-icon"><FileText /></div><div><strong>{document.title}</strong><span>{document.filename}</span><small>{document.is_private ? "私人资料" : "项目公共资料"}</small>{document.error && <em>{document.error}</em>}</div><span className={`document-status ${document.status}`}>{document.status === "completed" ? <><CheckCircle2 />可检索</> : document.status === "failed" ? "处理失败" : "处理中"}</span>
        </article>)}</div>
      </section>
    </div>
    <TutorScope documentIds={documentIds} />
    </>}
  </main>;
}
