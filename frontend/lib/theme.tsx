"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { isThemePreference, themeStorageKey, type ThemePreference } from "./appearance-preferences";

type ThemeContextValue = { theme: ThemePreference; setTheme: (theme: ThemePreference) => void };
const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, updateTheme] = useState<ThemePreference>("system");
  const applyTheme = useCallback((next: ThemePreference) => {
    updateTheme(next);
    document.documentElement.dataset.themePreference = next;
    document.documentElement.dataset.theme = next === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
      : next;
  }, []);
  const setTheme = useCallback((next: ThemePreference) => {
    if (!isThemePreference(next)) return;
    applyTheme(next);
    try { localStorage.setItem(themeStorageKey, next); } catch { /* This tab still switches. */ }
  }, [applyTheme]);
  useEffect(() => {
    let saved: unknown;
    try { saved = localStorage.getItem(themeStorageKey); } catch { /* Follow the system. */ }
    applyTheme(isThemePreference(saved) ? saved : "system");
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onSystemChange = () => {
      if (document.documentElement.dataset.themePreference === "system") applyTheme("system");
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === themeStorageKey || event.key === null) {
        applyTheme(isThemePreference(event.newValue) ? event.newValue : "system");
      }
    };
    media.addEventListener("change", onSystemChange);
    window.addEventListener("storage", onStorage);
    return () => {
      media.removeEventListener("change", onSystemChange);
      window.removeEventListener("storage", onStorage);
    };
  }, [applyTheme]);
  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used inside ThemeProvider");
  return value;
}
