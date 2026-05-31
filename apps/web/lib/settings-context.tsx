"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { translations, type Lang, type Translations } from "./i18n";

type Theme = "dark" | "light";

interface Settings {
  lang: Lang;
  theme: Theme;
  toggleLang: () => void;
  toggleTheme: () => void;
}

const SettingsContext = createContext<Settings>({
  lang: "en",
  theme: "dark",
  toggleLang: () => {},
  toggleTheme: () => {},
});

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLang] = useState<Lang>("en");
  const [theme, setTheme] = useState<Theme>("dark");

  // Restore from localStorage on mount
  useEffect(() => {
    const savedLang = localStorage.getItem("tp-lang") as Lang | null;
    const savedTheme = localStorage.getItem("tp-theme") as Theme | null;
    if (savedLang === "en" || savedLang === "zh") setLang(savedLang);
    if (savedTheme === "dark" || savedTheme === "light") setTheme(savedTheme);
  }, []);

  // Apply theme class to <html>
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("light", theme === "light");
    localStorage.setItem("tp-theme", theme);
  }, [theme]);

  // Sync lang attribute on <html>
  useEffect(() => {
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
    localStorage.setItem("tp-lang", lang);
  }, [lang]);

  return (
    <SettingsContext.Provider
      value={{
        lang,
        theme,
        toggleLang: () => setLang((l) => (l === "en" ? "zh" : "en")),
        toggleTheme: () => {
          const root = document.documentElement;
          root.classList.add("theme-transition");
          setTheme((t) => (t === "dark" ? "light" : "dark"));
          window.setTimeout(
            () => root.classList.remove("theme-transition"),
            400,
          );
        },
      }}
    >
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): Settings {
  return useContext(SettingsContext);
}

export function useT(): Translations {
  const { lang } = useSettings();
  return translations[lang];
}
