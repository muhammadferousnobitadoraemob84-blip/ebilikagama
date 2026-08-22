"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

interface Settings {
  site_name?: string;
  site_logo?: string;
}

export default function Header() {
  const [settings, setSettings] = useState<Settings>({});
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => setSettings(data))
      .catch(() => {});
  }, []);

  const siteName = settings.site_name || "eBilikAgamaTV";

  return (
    <header className="sticky top-0 z-50 bg-black/95 backdrop-blur-md border-b border-white/10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-3 group">
            {settings.site_logo ? (
              <img
                src={settings.site_logo}
                alt={siteName}
                className="h-8 w-auto"
              />
            ) : (
              <div className="w-8 h-8 bg-gradient-to-br from-red-600 to-red-800 rounded-lg flex items-center justify-center text-white font-bold text-sm">
                MS
              </div>
            )}
            <span className="text-white font-bold text-lg group-hover:text-red-400 transition-colors">
              {siteName}
            </span>
          </Link>

          {/* Desktop Nav */}
          <nav className="hidden md:flex items-center gap-6">
            <Link
              href="/"
              className="text-gray-300 hover:text-white transition-colors text-sm font-medium"
            >
              Utama
            </Link>
            <Link
              href="/#saluran-tv"
              className="text-gray-300 hover:text-white transition-colors text-sm font-medium"
            >
              Saluran TV
            </Link>
            <Link
              href="/#saluran-khas"
              className="text-gray-300 hover:text-white transition-colors text-sm font-medium"
            >
              Saluran Khas
            </Link>
          </nav>

          {/* Mobile menu button */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden text-gray-300 hover:text-white p-2"
            aria-label="Menu"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {mobileMenuOpen ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              )}
            </svg>
          </button>
        </div>

        {/* Mobile Nav */}
        {mobileMenuOpen && (
          <nav className="md:hidden pb-4 border-t border-white/10 mt-2 pt-4 flex flex-col gap-3">
            <Link
              href="/"
              onClick={() => setMobileMenuOpen(false)}
              className="text-gray-300 hover:text-white transition-colors text-sm font-medium px-2 py-1"
            >
              Utama
            </Link>
            <Link
              href="/#saluran-tv"
              onClick={() => setMobileMenuOpen(false)}
              className="text-gray-300 hover:text-white transition-colors text-sm font-medium px-2 py-1"
            >
              Saluran TV
            </Link>
            <Link
              href="/#saluran-khas"
              onClick={() => setMobileMenuOpen(false)}
              className="text-gray-300 hover:text-white transition-colors text-sm font-medium px-2 py-1"
            >
              Saluran Khas
            </Link>
          </nav>
        )}
      </div>
    </header>
  );
}
