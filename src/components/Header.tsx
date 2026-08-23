"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useLanguage } from "@/components/LanguageProvider";
import LanguageSelector from "@/components/LanguageSelector";

interface Settings {
  site_name?: string;
  site_logo?: string;
}

interface AdminProfile {
  loggedIn: boolean;
  username?: string;
  fullName?: string;
  profilePhoto?: string | null;
  role?: string;
}

export default function Header() {
  const [settings, setSettings] = useState<Settings>({});
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [adminProfile, setAdminProfile] = useState<AdminProfile | null>(null);
  const { t } = useLanguage();

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => setSettings(data))
      .catch(() => {});

    // Check if admin is logged in
    fetch("/api/auth/admin-profile")
      .then((r) => r.json())
      .then((data) => setAdminProfile(data))
      .catch(() => {});
  }, []);

  const siteName = settings.site_name || "eBilikAgamaTV";

  return (
    <header className="sticky top-0 z-50 bg-black/95 backdrop-blur-md border-b border-white/10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14 sm:h-16">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2.5 group">
            {settings.site_logo ? (
              <img
                src={settings.site_logo}
                alt={siteName}
                className="h-7 sm:h-8 w-auto"
              />
            ) : (
              <div className="w-7 h-7 sm:w-8 sm:h-8 bg-gradient-to-br from-red-600 to-red-800 rounded-lg flex items-center justify-center text-white font-bold text-xs sm:text-sm">
                MS
              </div>
            )}
            <span className="text-white font-bold text-base sm:text-lg group-hover:text-red-400 transition-colors">
              {siteName}
            </span>
          </Link>

          {/* Desktop Nav + Language + Admin Profile */}
          <nav className="hidden md:flex items-center gap-5 lg:gap-6">
            <Link
              href="/"
              className="text-gray-300 hover:text-white transition-colors text-sm font-medium"
            >
              {t("nav_home")}
            </Link>
            <Link
              href="/#saluran-tv"
              className="text-gray-300 hover:text-white transition-colors text-sm font-medium"
            >
              {t("nav_saluran_tv")}
            </Link>
            <Link
              href="/#saluran-khas"
              className="text-gray-300 hover:text-white transition-colors text-sm font-medium"
            >
              {t("nav_saluran_khas")}
            </Link>
            <Link
              href="/schedule"
              className="text-gray-300 hover:text-white transition-colors text-sm font-medium"
            >
              {t("nav_schedule")}
            </Link>

            <div className="w-px h-5 bg-white/10" />

            <LanguageSelector />

            {/* Admin Profile Indicator */}
            {adminProfile?.loggedIn && (
              <Link
                href="/admin"
                className="flex items-center gap-2 ml-2 group"
                title={`${adminProfile.fullName || adminProfile.username} - Admin`}
              >
                {adminProfile.profilePhoto ? (
                  <img
                    src={adminProfile.profilePhoto}
                    alt="Admin"
                    className="w-8 h-8 rounded-full object-cover border-2 border-red-500/50 group-hover:border-red-500 transition-colors"
                  />
                ) : (
                  <div className="w-8 h-8 bg-gradient-to-br from-red-600 to-red-800 rounded-full flex items-center justify-center text-white font-bold text-xs border-2 border-red-500/50 group-hover:border-red-500 transition-colors">
                    {(adminProfile.fullName || adminProfile.username || "A").charAt(0).toUpperCase()}
                  </div>
                )}
              </Link>
            )}
          </nav>

          {/* Mobile right buttons */}
          <div className="flex items-center gap-2 md:hidden">
            {/* Mobile Admin Profile Indicator */}
            {adminProfile?.loggedIn && (
              <Link href="/admin" className="mr-1">
                {adminProfile.profilePhoto ? (
                  <img
                    src={adminProfile.profilePhoto}
                    alt="Admin"
                    className="w-7 h-7 rounded-full object-cover border-2 border-red-500/50"
                  />
                ) : (
                  <div className="w-7 h-7 bg-gradient-to-br from-red-600 to-red-800 rounded-full flex items-center justify-center text-white font-bold text-xs border-2 border-red-500/50">
                    {(adminProfile.fullName || adminProfile.username || "A").charAt(0).toUpperCase()}
                  </div>
                )}
              </Link>
            )}
            <LanguageSelector mobile />
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="text-gray-300 hover:text-white p-2 -mr-2"
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
        </div>
      </div>

      {/* Mobile Nav Drawer */}
      <div
        className={`md:hidden overflow-hidden transition-all duration-300 ease-in-out ${
          mobileMenuOpen ? "max-h-96 opacity-100" : "max-h-0 opacity-0"
        }`}
      >
        <nav className="px-4 pb-4 pt-2 border-t border-white/10 flex flex-col gap-1">
          <Link
            href="/"
            onClick={() => setMobileMenuOpen(false)}
            className="text-gray-300 hover:text-white hover:bg-white/5 transition-all text-sm font-medium px-4 py-3 rounded-lg"
          >
            {t("nav_home")}
          </Link>
          <Link
            href="/#saluran-tv"
            onClick={() => setMobileMenuOpen(false)}
            className="text-gray-300 hover:text-white hover:bg-white/5 transition-all text-sm font-medium px-4 py-3 rounded-lg"
          >
            {t("nav_saluran_tv")}
          </Link>
          <Link
            href="/#saluran-khas"
            onClick={() => setMobileMenuOpen(false)}
            className="text-gray-300 hover:text-white hover:bg-white/5 transition-all text-sm font-medium px-4 py-3 rounded-lg"
          >
            {t("nav_saluran_khas")}
          </Link>
          <Link
            href="/schedule"
            onClick={() => setMobileMenuOpen(false)}
            className="text-gray-300 hover:text-white hover:bg-white/5 transition-all text-sm font-medium px-4 py-3 rounded-lg"
          >
            {t("nav_schedule")}
          </Link>
          <div className="h-px bg-white/10 my-1" />
          <Link
            href="/admin/login"
            onClick={() => setMobileMenuOpen(false)}
            className="text-gray-500 hover:text-gray-300 transition-all text-xs font-medium px-4 py-2 rounded-lg"
          >
            {t("nav_admin")}
          </Link>
        </nav>
      </div>
    </header>
  );
}
