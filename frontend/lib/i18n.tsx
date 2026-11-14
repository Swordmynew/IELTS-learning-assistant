"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { messages } from "./messages";
import { shellMessages } from "./shell-messages";
import { systemMessages, systemMessageKeys } from "./system-messages";
import { browserLocale, isLocale, localeStorageKey, type Locale } from "./appearance-preferences";

export type { Locale } from "./appearance-preferences";
export { localeStorageKey } from "./appearance-preferences";
type Params = Record<string, string | number>;
let activeLocale: Locale = "en";

function translateFor(locale: Locale, key: string, params?: Params) {
  const template = messages[locale][key] ?? shellMessages[locale][key] ?? systemMessages[locale][key]
    ?? messages.en[key] ?? shellMessages.en[key] ?? systemMessages.en[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => String(params?.[name] ?? match));
}

export function translate(key: string, params?: Params) {
  return translateFor(activeLocale, key, params);
}

export function getLocale(): Locale { return activeLocale; }

export function localizeSystemText(text: string): string {
  const key = systemMessageKeys.get(text);
  return key ? translate(key) : text;
}

// Translate only known application errors; never rewrite learner or model content.
export function localizeError(message: string): string {
  if (message.startsWith("error.") && (messages.en[message] || shellMessages.en[message] || systemMessages.en[message])) return translate(message);
  const systemKey = systemMessageKeys.get(message);
  if (systemKey?.startsWith("error.")) return translate(systemKey);
  const zh = { ...messages["zh-CN"], ...shellMessages["zh-CN"] };
  const en = { ...messages.en, ...shellMessages.en };
  const known = Object.entries(zh).find(([key, text]) => key.startsWith("error.")
    && (text === message || en[key] === message));
  if (known) return translate(known[0]);
  const page = /^(?:PDF 第 (\d+) 页需要 OCR；当前支持文本型 PDF|PDF 第 (\d+) 页需要 OCR，当前仅支持文本型 PDF。|PDF page (\d+) requires OCR\. Only text-based PDFs are currently supported\.)$/.exec(message);
  if (page) return translate("error.api.pdfPageOcr", { page: page[1] ?? page[2] ?? page[3] });
  if (message.startsWith("Invalid question bank row:")) return translate("error.api.questionBankRow");
  if (/^(?:Value error, |RuntimeError: )/.test(message)) return localizeError(message.replace(/^(?:Value error, |RuntimeError: )/, ""));
  for (const suffixKey of ["error.draftSaved", "error.sourcesOnly"]) {
    for (const suffix of [shellMessages["zh-CN"][suffixKey], shellMessages.en[suffixKey]]) {
      if (message.endsWith(suffix)) {
        const prefix = message.slice(0, -suffix.length).trimEnd();
        const translated = localizeError(prefix);
        if (translated !== prefix) return `${translated} ${translate(suffixKey)}`;
      }
    }
  }
  const aliases: Record<string, string> = {
    "Failed to fetch": "error.network", "NetworkError when attempting to fetch resource.": "error.network",
    "Load failed": "error.network", "fetch failed": "error.network",
    "Auth provider is not ready": "error.authReady",
  };
  return aliases[message] ? translate(aliases[message]) : message;
}

/** Format API failures without exposing raw validation JSON or submitted secrets. */
export function apiErrorMessage(payload: unknown, status: number): string {
  const detail = payload && typeof payload === "object" && "detail" in payload ? payload.detail : payload;
  if (typeof detail === "string") {
    const localized = localizeError(detail);
    const known = systemMessageKeys.get(detail);
    if (localized !== detail || known?.startsWith("error.")
      || Object.entries({ ...messages.en, ...shellMessages.en }).some(([key, value]) => key.startsWith("error.") && value === detail)) return localized;
  }
  if (Array.isArray(detail)) {
    const errors = detail.filter((value): value is { msg?: string; type?: string } => !!value && typeof value === "object");
    for (const error of errors) {
      const raw = (error.msg ?? "").replace(/^Value error, /, "");
      if (systemMessageKeys.get(raw)?.startsWith("error.")) return localizeError(raw);
    }
    if (errors.some(error => error.type === "missing")) return translate("error.api.required");
    if (errors.some(error => /email address/i.test(error.msg ?? ""))) return translate("error.api.invalidEmail");
    return translate("error.api.invalidRequest");
  }
  if (detail && typeof detail === "object" && "message" in detail && typeof detail.message === "string") {
    if (systemMessageKeys.get(detail.message)?.startsWith("error.")) return localizeError(detail.message);
  }
  const key = ({ 401: "signIn", 403: "forbidden", 404: "notFound", 409: "conflict", 413: "fileSize", 422: "invalidRequest", 429: "rateLimit" } as Record<number, string>)[status];
  return translate(key ? `error.api.${key}` : status >= 500 ? "error.api.service" : "error.request");
}

type I18n = {
  locale: Locale; setLocale: (locale: Locale) => void;
  t: (key: string, params?: Params) => string;
  formatDate: (value: string | number | Date, options?: Intl.DateTimeFormatOptions) => string;
};
const I18nContext = createContext<I18n | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, updateLocale] = useState<Locale>("en");
  const explicitLocale = useRef(false);
  const applyLocale = useCallback((next: Locale) => {
    activeLocale = next;
    updateLocale(next);
    document.documentElement.lang = next;
    document.querySelector('meta[name="description"]')?.setAttribute("content", translateFor(next, "shell.description"));
  }, []);
  const setLocale = useCallback((next: Locale) => {
    if (!isLocale(next)) return;
    explicitLocale.current = true;
    applyLocale(next);
    try { localStorage.setItem(localeStorageKey, next); } catch { /* In-memory switching still works. */ }
  }, [applyLocale]);
  useEffect(() => {
    const detected = () => browserLocale(navigator.languages?.length ? navigator.languages : [navigator.language]);
    let saved: unknown;
    try { saved = localStorage.getItem(localeStorageKey); } catch { /* Use the browser language. */ }
    explicitLocale.current = isLocale(saved);
    applyLocale(isLocale(saved) ? saved : detected());
    const onStorage = (event: StorageEvent) => {
      if (event.key === localeStorageKey || event.key === null) {
        saved = event.newValue;
        explicitLocale.current = isLocale(saved);
        applyLocale(isLocale(saved) ? saved : detected());
      }
    };
    const onLanguageChange = () => { if (!explicitLocale.current) applyLocale(detected()); };
    window.addEventListener("storage", onStorage);
    window.addEventListener("languagechange", onLanguageChange);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("languagechange", onLanguageChange);
    };
  }, [applyLocale]);
  useEffect(() => {
    const elements = new Set<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>();
    const clear = (event: Event) => {
      const element = event.target;
      if ((element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) && elements.has(element)) {
        element.setCustomValidity(""); elements.delete(element);
      }
    };
    const invalid = (event: Event) => {
      const element = event.target;
      if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)) return;
      // Leave intentional application-level custom validation alone.
      if (element.validity.customError && !elements.has(element)) return;
      element.setCustomValidity("");
      const validity = element.validity;
      const key = validity.valueMissing ? "error.api.required" : validity.typeMismatch && element instanceof HTMLInputElement && element.type === "email"
        ? "error.api.invalidEmail" : "error.api.invalidRequest";
      element.setCustomValidity(translate(key)); elements.add(element);
    };
    document.addEventListener("invalid", invalid, true);
    document.addEventListener("input", clear, true);
    document.addEventListener("change", clear, true);
    return () => {
      document.removeEventListener("invalid", invalid, true);
      document.removeEventListener("input", clear, true);
      document.removeEventListener("change", clear, true);
      elements.forEach(element => element.setCustomValidity(""));
    };
  }, [locale]);
  const value = useMemo<I18n>(() => ({
    locale, setLocale,
    t: (key, params) => translateFor(locale, key, params),
    formatDate: (value, options) => new Intl.DateTimeFormat(locale, options).format(value instanceof Date ? value : new Date(value)),
  }), [locale, setLocale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used inside I18nProvider");
  return value;
}
