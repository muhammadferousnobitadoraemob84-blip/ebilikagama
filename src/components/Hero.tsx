"use client";

import { useEffect, useState } from "react";

interface Settings {
  hero_title?: string;
  hero_description?: string;
  hero_image?: string;
}

export default function Hero() {
  const [settings, setSettings] = useState<Settings>({});

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => setSettings(data))
      .catch(() => {});
  }, []);

  return (
    <section className="relative h-[60vh] min-h-[400px] flex items-center justify-center overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0">
        {settings.hero_image ? (
          <img
            src={settings.hero_image}
            alt=""
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-gray-950 via-gray-900 to-red-950/30" />
        )}
        {/* Gradient Overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/50 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-black/70 to-transparent" />
      </div>

      {/* Animated Background Dots */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-64 h-64 bg-red-500/5 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-red-500/5 rounded-full blur-3xl animate-pulse delay-1000" />
      </div>

      {/* Content */}
      <div className="relative z-10 text-center max-w-4xl mx-auto px-4">
        <div className="inline-flex items-center gap-2 bg-red-600/20 border border-red-500/30 text-red-400 text-sm font-medium px-4 py-2 rounded-full mb-6 backdrop-blur-sm">
          <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
          Siaran Langsung
        </div>

        <h1 className="text-4xl sm:text-5xl md:text-6xl font-extrabold text-white mb-6 tracking-tight leading-tight">
          {settings.hero_title || "Siaran Langsung Televisyen Malaysia"}
        </h1>

        <p className="text-lg sm:text-xl text-gray-300 max-w-2xl mx-auto mb-8 leading-relaxed">
          {settings.hero_description ||
            "Tonton saluran televisyen Malaysia secara langsung. Semua saluran RTM di satu tempat."}
        </p>

        <a
          href="#saluran-tv"
          className="inline-flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white font-semibold px-8 py-3.5 rounded-xl transition-all duration-300 hover:shadow-lg hover:shadow-red-600/25 transform hover:-translate-y-0.5"
        >
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M8 5v14l11-7z" />
          </svg>
          Mula Menonton
        </a>
      </div>
    </section>
  );
}
