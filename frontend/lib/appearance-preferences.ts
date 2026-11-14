export type Locale = "zh-CN" | "en";
export type ThemePreference = "light" | "dark" | "system";
export const localeStorageKey = "ielts-ui-language";
export const themeStorageKey = "ielts-ui-theme";

export const isLocale = (value: unknown): value is Locale => value === "zh-CN" || value === "en";
export const isThemePreference = (value: unknown): value is ThemePreference =>
  value === "light" || value === "dark" || value === "system";

export function browserLocale(languages: readonly string[]): Locale {
  for (const language of languages) {
    if (/^zh(?:-|$)/i.test(language)) return "zh-CN";
    if (/^en(?:-|$)/i.test(language)) return "en";
  }
  return "en";
}

// Run before the first paint so a dark system or saved preference never flashes white.
export const themeInitializationScript = `(() => {
  let preference = "system";
  try {
    const saved = localStorage.getItem(${JSON.stringify(themeStorageKey)});
    if (saved === "light" || saved === "dark" || saved === "system") preference = saved;
  } catch {}
  const dark = preference === "dark" || (preference === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.documentElement.dataset.themePreference = preference;
})();`;
