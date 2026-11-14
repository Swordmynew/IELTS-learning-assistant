"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { messages } from "./messages";
import { shellMessages } from "./shell-messages";
import { browserLocale, isLocale, localeStorageKey, type Locale } from "./appearance-preferences";

export type { Locale } from "./appearance-preferences";
export { localeStorageKey } from "./appearance-preferences";
type Params = Record<string, string | number>;
let activeLocale: Locale = "en";

function translateFor(locale: Locale, key: string, params?: Params) {
  const template = messages[locale][key] ?? shellMessages[locale][key]
    ?? messages.en[key] ?? shellMessages.en[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => String(params?.[name] ?? match));
}

export function translate(key: string, params?: Params) {
  return translateFor(activeLocale, key, params);
}

export function getLocale(): Locale { return activeLocale; }

// Translate only known application errors; never rewrite learner or model content.
export function localizeError(message: string): string {
  const known = Object.entries(shellMessages["zh-CN"]).find(([key, text]) => key.startsWith("error.")
    && (text === message || shellMessages.en[key] === message));
  if (known) return translate(known[0]);
  for (const suffixKey of ["error.draftSaved", "error.sourcesOnly"]) {
    const suffix = shellMessages["zh-CN"][suffixKey];
    if (message.endsWith(suffix)) {
      const prefix = message.slice(0, -suffix.length);
      const translated = localizeError(prefix);
      if (translated !== prefix) return `${translated} ${translate(suffixKey)}`;
    }
  }
  const aliases: Record<string, string> = {
    "Failed to fetch": "error.network", "NetworkError when attempting to fetch resource.": "error.network",
    "Auth provider is not ready": "error.authReady",
  };
  return aliases[message] ? translate(aliases[message]) : message;
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
