"use client";

import { useState, useRef, useEffect } from "react";
import { useLanguage } from "./LanguageProvider";
import { LANGUAGES, Language } from "@/lib/i18n";

export default function LanguageSelector({ mobile = false }: { mobile?: boolean }) {
  const { language, setLanguage } = useLanguage();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const current = LANGUAGES.find((l) => l.code === language) || LANGUAGES[0];

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const handleSelect = (code: Language) => {
    setLanguage(code);
    setOpen(false);
  };

  if (mobile) {
    return (
      <div className="relative" ref={ref}>
        <button
          onClick={() => setOpen(!open)}
          className="flex items-center gap-1.5 text-gray-300 hover:text-white transition-all text-sm font-medium px-3 py-2 rounded-lg w-full"
        >
          <span>{current.flag}</span>
          <span>{current.label}</span>
          <svg
            className={`w-3.5 h-3.5 ml-auto transition-transform ${open ? "rotate-180" : ""}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {open && (
          <div className="mt-1 bg-gray-800 border border-white/10 rounded-lg overflow-hidden shadow-xl">
            {LANGUAGES.map((lang) => (
              <button
                key={lang.code}
                onClick={() => handleSelect(lang.code)}
                className={`flex items-center gap-2 w-full px-4 py-2.5 text-sm transition-colors ${
                  lang.code === language
                    ? "bg-red-600/20 text-red-400"
                    : "text-gray-300 hover:bg-white/5 hover:text-white"
                }`}
              >
                <span>{lang.flag}</span>
                <span>{lang.label}</span>
                {lang.code === language && (
                  <svg className="w-4 h-4 ml-auto" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                  </svg>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Desktop: compact flag button with dropdown
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 text-gray-400 hover:text-white transition-colors text-sm px-2 py-1.5 rounded-lg hover:bg-white/5"
        title="Language"
      >
        <span className="text-base">{current.flag}</span>
        <span className="hidden lg:inline text-xs font-medium">{current.label}</span>
        <svg
          className={`w-3 h-3 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 mt-2 bg-gray-900 border border-white/10 rounded-xl overflow-hidden shadow-2xl min-w-[180px] z-50">
          <div className="p-1">
            {LANGUAGES.map((lang) => (
              <button
                key={lang.code}
                onClick={() => handleSelect(lang.code)}
                className={`flex items-center gap-2.5 w-full px-3 py-2 text-sm rounded-lg transition-colors ${
                  lang.code === language
                    ? "bg-red-600/20 text-red-400"
                    : "text-gray-300 hover:bg-white/5 hover:text-white"
                }`}
              >
                <span className="text-base">{lang.flag}</span>
                <span>{lang.label}</span>
                {lang.code === language && (
                  <svg className="w-3.5 h-3.5 ml-auto" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                  </svg>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
