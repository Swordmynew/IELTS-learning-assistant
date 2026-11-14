"use client";

import { useI18n } from "@/lib/i18n";

import { MessageCircle, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Tutor } from "./coach-components";
import { useAuth } from "./providers";

type Scope = { versionId?: string; sourceType?: string; documentIds?: string[]; topicTags?: string[] };
const TutorContext = createContext<(scope: Scope) => void>(() => undefined);

export function TutorScope({ versionId, sourceType = "all", documentIds = [], topicTags = [] }: Scope) {

  const setScope = useContext(TutorContext);
  const documents = JSON.stringify(documentIds);
  const topics = JSON.stringify(topicTags);
  useEffect(() => {
    setScope({ versionId, sourceType, documentIds: JSON.parse(documents), topicTags: JSON.parse(topics) });
    return () => setScope({});
  }, [setScope, versionId, sourceType, documents, topics]);
  return null;
}

export function TutorProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [scope, setScope] = useState<Scope>({});
  const [open, setOpen] = useState(false);
  const [visited, setVisited] = useState(false);
  const launcher = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const { token, user } = useAuth();
  const writing = pathname === "/writing";
  const title = writing ? t("ui.askAboutThisEssay") : t("ui.learningAssistant");
  const available = !!token && !!user && pathname !== "/login" && pathname !== "/register";
  // A route can briefly retain the previous page's scope while its effects clean up.
  const activeScope: Scope = writing ? { versionId: scope.versionId } : pathname === "/resources" ? { sourceType: scope.sourceType, documentIds: scope.documentIds, topicTags: scope.topicTags } : {};
  const close = () => { setOpen(false); launcher.current?.focus(); };

  useEffect(() => {
    if (open) panel.current?.querySelector<HTMLInputElement>(".coach-chat-input input")?.focus();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !document.querySelector("dialog[open]")) {
        setOpen(false);
        launcher.current?.focus();
      }
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [open]);
  useEffect(() => {
    if (!available) { setOpen(false); setVisited(false); }
  }, [available]);

  return <TutorContext.Provider value={setScope}>
    {children}
    {available && <div className="floating-tutor">
      {visited && <div ref={panel} id="learning-assistant" className="floating-tutor-panel" role="dialog" aria-label={title} hidden={!open}>
        <Tutor key={`${token}:${writing}:${activeScope.versionId ?? ""}:${activeScope.sourceType ?? "all"}:${JSON.stringify(activeScope.documentIds ?? [])}:${JSON.stringify(activeScope.topicTags ?? [])}`} token={token!} {...activeScope} writingPage={writing} onClose={close} />
      </div>}
      <button ref={launcher} className="tutor-launcher" aria-label={open ? t("ui.minimizeLearningAssistant") : t("ui.openValue", { value1: title })} aria-expanded={open} aria-controls={visited ? "learning-assistant" : undefined} onClick={() => { setVisited(true); setOpen(value => !value); }}>
        {open ? <X size={22} /> : <MessageCircle size={22} />}<span>{title}</span>
      </button>
    </div>}
  </TutorContext.Provider>;
}
