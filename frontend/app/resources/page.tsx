"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, FileText, FileUp, FolderOpen, ShieldCheck } from "lucide-react";
import { useState } from "react";

import { PageHeader, SessionGate } from "../app-shell";
import { useDemoSession } from "../providers";
import { api } from "@/lib/api";

export default function ResourcesPage() {
  return <SessionGate><ResourcesContent /></SessionGate>;
}

function ResourcesContent() {
  const { token } = useDemoSession();
  const client = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const documents = useQuery({
    queryKey: ["knowledge-documents", token], queryFn: () => api.listDocuments(token!),
    refetchInterval: (query) => query.state.data?.some((document) => document.status === "queued") ? 4000 : false,
  });
  const upload = useMutation({
    mutationFn: () => api.uploadDocument(token!, file!),
    onSuccess: () => { setFile(null); client.invalidateQueries({ queryKey: ["knowledge-documents"] }); },
  });

  return <main className="page">
    <PageHeader eyebrow="学习资料" title="建立你的私人参考资料库" description="上传评分标准、课堂笔记或合法持有的资料，系统会建立检索索引，在反馈中提供出处。" />
    <div className="resource-layout">
      <section className="panel upload-zone">
        <FileUp size={42} /><h2>上传学习资料</h2><p>支持 PDF、DOCX、TXT 和 Markdown，系统会解析文字并建立本地向量索引。</p>
        <label className="file-picker"><input type="file" accept=".pdf,.docx,.txt,.md" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /><span>{file ? file.name : "选择文件"}</span></label>
        <button className="primary-button full-button" onClick={() => upload.mutate()} disabled={!file || upload.isPending}>{upload.isPending ? "正在上传…" : "上传并建立索引"}</button>
        {upload.error && <p className="error-text">上传失败：{upload.error.message}</p>}
        <div className="soft-note"><ShieldCheck /><p><strong>资料与题目是两类内容</strong><br />此页面用于建立可引用的参考资料。需要录入可直接练习的题目，请前往“练习题库 → 录入新题”。</p></div>
      </section>
      <section className="panel document-panel">
        <div className="panel-heading"><div><p className="eyebrow">已接入资料</p><h2>{documents.data?.length ?? 0} 份文档</h2></div><FolderOpen /></div>
        <div className="document-list">{documents.isLoading ? <p>正在读取…</p> : documents.data?.map((document) => <article key={document.id}>
          <div className="document-icon"><FileText /></div><div><strong>{document.title}</strong><span>{document.filename}</span><small>{document.is_private ? "私人资料" : "项目公共资料"} · {document.license_type}</small>{document.error && <em>{document.error}</em>}</div><span className={`document-status ${document.status}`}>{document.status === "completed" ? <><CheckCircle2 />可检索</> : document.status === "failed" ? "处理失败" : "处理中"}</span>
        </article>)}</div>
      </section>
    </div>
  </main>;
}
