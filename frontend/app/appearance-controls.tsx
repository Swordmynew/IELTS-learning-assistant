"use client";

import { Check, Languages, Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useI18n, type Locale } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import type { ThemePreference } from "@/lib/appearance-preferences";

function LanguageMenu() {
  const { locale, setLocale, t } = useI18n();
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const wrapper = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const choices = useRef<(HTMLButtonElement | null)[]>([]);
  const options: { value: Locale; label: string }[] = [
    { value: "zh-CN", label: "shell.languageChinese" }, { value: "en", label: "shell.languageEnglish" },
  ];
  useEffect(() => {
    if (!open) return;
    choices.current[locale === "en" ? 1 : 0]?.focus();
    const dismiss = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open, locale]);
  return <div className="language-control" ref={wrapper} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
  }}>
    <button ref={trigger} type="button" className="language-trigger" aria-haspopup="menu" aria-expanded={open}
      aria-controls={open ? menuId : undefined} onClick={() => setOpen(!open)}
      onKeyDown={event => { if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setOpen(true); } }}>
      <Languages size={16} aria-hidden="true" /><span>{t("shell.language")}</span>
    </button>
    {open && <div className="language-menu" id={menuId} role="menu" aria-label={t("shell.chooseLanguage")}
      onKeyDown={event => {
        const index = choices.current.indexOf(document.activeElement as HTMLButtonElement);
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          choices.current[event.key === "Home" ? 0 : event.key === "End" ? 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + 2) % 2]?.focus();
        } else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus(); }
      }}>
      {options.map((option, index) => <button key={option.value} ref={element => { choices.current[index] = element; }} type="button"
        role="menuitemradio" aria-checked={locale === option.value} lang={option.value}
        onClick={() => { setLocale(option.value); setOpen(false); trigger.current?.focus(); }}>
        <span>{t(option.label)}</span>{locale === option.value && <Check size={15} aria-hidden="true" />}
      </button>)}
    </div>}
  </div>;
}

const themeOptions: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "appearance.light", icon: Sun },
  { value: "dark", label: "appearance.dark", icon: Moon },
  { value: "system", label: "appearance.system", icon: Monitor },
];

export function AppearanceControls() {
  const { t } = useI18n();
  const { theme, setTheme } = useTheme();
  return <div className="appearance-controls" role="group" aria-label={t("appearance.preferences")}>
    <LanguageMenu />
    <div className="theme-options" role="group" aria-label={t("appearance.theme")}>
      {themeOptions.map(({ value, label, icon: Icon }) => <button key={value} type="button"
        className="theme-option" title={t(label)} aria-label={t(label)} aria-pressed={theme === value}
        onClick={() => setTheme(value)}><Icon size={16} aria-hidden="true" /></button>)}
    </div>
  </div>;
}
