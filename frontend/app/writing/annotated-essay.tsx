"use client";

import { useI18n } from "@/lib/i18n";

import { useLayoutEffect, useMemo, useRef, useState } from "react";

export type Annotation = {
  id: string; criterion: string; quote: string; label: string;
  explanation: string; issueId?: string; start?: number; end?: number;
};

function locate(text: string, item: Annotation) {
  if (!item.quote.trim()) return null;
  if (item.start != null && item.end != null && text.slice(item.start, item.end) === item.quote) return { start: item.start, end: item.end };
  const exact = text.indexOf(item.quote);
  if (exact >= 0) return { start: exact, end: exact + item.quote.length };
  // Preserve the displayed text while matching line wraps and smart punctuation.
  const normalize = (c: string) => /\s/.test(c) ? " " : /[‘’]/.test(c) ? "'" : /[“”]/.test(c) ? '"' : c;
  const positions: number[] = [];
  let normalized = "";
  for (let i = 0; i < text.length; i++) {
    const c = normalize(text[i]);
    if (c === " " && normalized.endsWith(" ")) continue;
    normalized += c; positions.push(i);
  }
  const quote = [...item.quote].map(normalize).join("").replace(/\s+/g, " ").trim();
  const index = normalized.indexOf(quote);
  if (index >= 0) return { start: positions[index], end: positions[index + quote.length - 1] + 1 };
  // A truncated quotation can still identify its passage. Never anchor a short
  // generic opening or a prefix that appears in multiple places in the essay.
  let low = 0, high = quote.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (normalized.includes(quote.slice(0, middle))) low = middle;
    else high = middle - 1;
  }
  const prefix = quote.slice(0, low).replace(/\s+\S*$/, "").trim();
  if (prefix.length < 24 || prefix.split(/\s+/).length < 5) return null;
  const prefixIndex = normalized.indexOf(prefix);
  if (normalized.indexOf(prefix, prefixIndex + 1) >= 0) return null;
  return { start: positions[prefixIndex], end: positions[prefixIndex + prefix.length - 1] + 1 };
}

export function AnnotatedEssay({ text, annotations, activeId, onSelect }: {
  text: string; annotations: Annotation[]; activeId?: string; onSelect: (id: string) => void;
}) {
  const { t } = useI18n();
  const root = useRef<HTMLDivElement>(null);
  const [positions, setPositions] = useState<{ id: string; top: number }[]>([]);
  const located = useMemo(() => annotations.flatMap(item => {
    const range = locate(text, item);
    return range ? [{ ...item, ...range }] : [];
  }), [text, annotations]);
  const segments = useMemo(() => {
    const boundaries = [...new Set([0, text.length, ...located.flatMap(item => [item.start, item.end])])].sort((a, b) => a - b);
    return boundaries.slice(0, -1).map((start, i) => ({ start, end: boundaries[i + 1], items: located.filter(item => item.start <= start && item.end > start) }));
  }, [text, located]);

  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    let alive = true;
    const measure = () => {
      if (!alive) return;
      const box = element.getBoundingClientRect();
      const next: { id: string; top: number }[] = [];
      for (const item of located) {
        const anchor = Array.from(element.querySelectorAll<HTMLElement>("mark[data-annotations]")).find(mark => mark.dataset.annotations?.split(" ").includes(item.id));
        const rect = anchor?.getClientRects()[0];
        if (!rect) continue;
        const top = rect.top - box.top;
        next.push({ id: item.id, top });
      }
      setPositions(next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    document.fonts.ready.then(measure);
    return () => { alive = false; observer.disconnect(); };
  }, [located]);
  const groups: { top: number; ids: string[] }[] = [];
  for (const item of [...positions].sort((a, b) => a.top - b.top)) {
    const nearby = groups.find(group => Math.abs(group.top - item.top) < 28);
    if (nearby) nearby.ids.push(item.id);
    else groups.push({ top: item.top, ids: [item.id] });
  }

  return <div ref={root} className="annotated-essay">
    <div className="essay-prose">{segments.map(({ start, end, items }) => {
      if (!items.length) return <span key={start}>{text.slice(start, end)}</span>;
      const active = items.find(item => item.id === activeId);
      const criteria = [...new Set(items.map(item => item.criterion))];
      const stripes = !active && criteria.length > 1 ? `linear-gradient(to bottom, ${criteria.map((criterion, index) => `var(--${criterion}-soft) ${index / criteria.length * 100}% ${(index + 1) / criteria.length * 100}%`).join(", ")})` : undefined;
      return <mark key={start} data-annotations={items.map(item => item.id).join(" ")} data-criterion={(active ?? items[0]).criterion} data-criteria={criteria.join(" ")} className={active ? "active" : ""} style={{ backgroundImage: stripes }}>{text.slice(start, end)}</mark>;
    })}</div>
    <div className="essay-annotation-rail" aria-label={t("ui.essayAnnotations")}>{groups.map(group => {
      const index = annotations.findIndex(note => note.id === group.ids[0]);
      const note = annotations[index];
      const active = !!activeId && group.ids.includes(activeId);
      const criterion = (active ? annotations.find(item => item.id === activeId) : note)?.criterion;
      return <button key={note.id} type="button" data-criterion={criterion} className={`essay-note-marker ${active ? "active" : ""}`} style={{ top: group.top, right: 0 }} aria-label={t("ui.annotationValueValue", { value1: index + 1, value2: note.label })} title={group.ids.length > 1 ? t("ui.valueAnnotations", { value1: group.ids.length }) : note.label} aria-pressed={active} aria-controls="writing-annotation-detail" onClick={() => onSelect(note.id)}>{index + 1}{group.ids.length > 1 && <small>+{group.ids.length - 1}</small>}</button>;
    })}</div>
  </div>;
}
