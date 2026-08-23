"use client";

import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { Language, DEFAULT_LANGUAGE, t, getLocaleCode, TranslationKey } from "@/lib/i18n";

const STORAGE_KEY = "ebilikagama-lang";

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: TranslationKey) => string;
  locale: string;
}

const LanguageContext = createContext<LanguageContextType>({
  language: DEFAULT_LANGUAGE,
  setLanguage: () => {},
  t: (key: TranslationKey) => key,
  locale: "en-US",
});

export function useLanguage() {
  return useContext(LanguageContext);
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>(DEFAULT_LANGUAGE);
  const [mounted, setMounted] = useState(false);

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved && ["en", "bm", "zh"].includes(saved)) {
        setLanguageState(saved as Language);
      }
    } catch {
      // ignore
    }
    setMounted(true);
  }, []);

  // Update html lang attribute when language changes
  useEffect(() => {
    if (mounted) {
      document.documentElement.lang = language === "bm" ? "ms" : language;
    }
  }, [language, mounted]);

  const setLanguage = useCallback((lang: Language) => {
    setLanguageState(lang);
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // ignore
    }
  }, []);

  const translate = useCallback(
    (key: TranslationKey) => t(key, language),
    [language]
  );

  return (
    <LanguageContext.Provider
      value={{
        language,
        setLanguage,
        t: translate,
        locale: getLocaleCode(language),
      }}
    >
      {children}
    </LanguageContext.Provider>
  );
}
