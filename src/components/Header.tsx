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

// Cache settings to avoid refetching on every render
let cachedSettings: Settings | null = null;
let settingsFetchPromise: Promise<Settings> | null = null;

// Clear settings cache — called after admin saves settings
export function clearSettingsCache() {
  cachedSettings = null;
  settingsFetchPromise = null;
}

function getSettings(): Promise<Settings> {
  if (cachedSettings) return Promise.resolve(cachedSettings);
  if (settingsFetchPromise) return settingsFetchPromise;

  settingsFetchPromise = fetch("/api/settings")
    .then((r) => r.json())
    .then((data) => {
      cachedSettings = data;
      return data;
    })
    .catch(() => ({} as Settings));

  return settingsFetchPromise;
}

// Cache admin profile
let cachedAdminProfile: AdminProfile | null = null;
let adminProfileFetchPromise: Promise<AdminProfile> | null = null;

function getAdminProfile(): Promise<AdminProfile> {
  if (cachedAdminProfile) return Promise.resolve(cachedAdminProfile);
  if (adminProfileFetchPromise) return adminProfileFetchPromise;

  adminProfileFetchPromise = fetch("/api/auth/admin-profile")
    .then((r) => r.json())
    .then((data) => {
      cachedAdminProfile = data;
      return data;
    })
    .catch(() => ({ loggedIn: false } as AdminProfile));

  return adminProfileFetchPromise;
}

function isAdminRole(role?: string | null): boolean {
  if (!role) return false;
  const normalized = role.toLowerCase();
  return normalized === "admin" || normalized === "owner";
}

export default function Header() {
  const [settings, setSettings] = useState<Settings>(cachedSettings || {});
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [adminProfile, setAdminProfile] = useState<AdminProfile | null>(cachedAdminProfile);
  const [menuOpen, setMenuOpen] = useState(false);
  const { t } = useLanguage();

  useEffect(() => {
    getSettings().then(setSettings);
    getAdminProfile().then(setAdminProfile);

    const handleSettingsChanged = () => {
      clearSettingsCache();
      getSettings().then(setSettings);
    };
    window.addEventListener("settings-changed", handleSettingsChanged);
    return () => window.removeEventListener("settings-changed", handleSettingsChanged);
  }, []);

  const siteName = settings.site_name || "eBilikAgamaTV";
  const admin = adminProfile?.loggedIn && isAdminRole(adminProfile?.role);

  return (
    <header className="sticky top-0 z-50 bg-black/95 backdrop-blur-md border-b border-white/10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14 sm:h-16">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2.5 group" prefetch={true}>
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
              prefetch={true}
            >
              {t("nav_home")}
            </Link>
            <Link
              href="/#saluran-tv"
              className="text-gray-300 hover:text-white transition-colors text-sm font-medium"
              prefetch={true}
            >
              {t("nav_saluran_tv")}
            </Link>
            <Link
              href="/radio"
              className="text-gray-300 hover:text-white transition-colors text-sm font-medium"
              prefetch={true}
            >
              {t("nav_radio")}
            </Link>
            <Link
              href="/#saluran-khas"
              className="text-gray-300 hover:text-white transition-colors text-sm font-medium"
              prefetch={true}
            >
              {t("nav_saluran_khas")}
            </Link>
            <Link
              href="/schedule"
              className="text-gray-300 hover:text-white transition-colors text-sm font-medium"
              prefetch={true}
            >
              {t("nav_schedule")}
            </Link>

            <div className="w-px h-5 bg-white/10" />

            <LanguageSelector />

            {/* Admin Profile Indicator + Menu */}
            {admin && (
              <div className="relative ml-2">
                <button
                  onClick={() => setMenuOpen(!menuOpen)}
                  className="flex items-center gap-2 group"
                  aria-label="Admin account menu"
                >
                  {adminProfile?.profilePhoto ? (
                    <img
                      src={adminProfile.profilePhoto}
                      alt="Admin"
                      className="w-8 h-8 rounded-full object-cover border-2 border-red-500/50 group-hover:border-red-500 transition-colors"
                    />
                  ) : (
                    <div className="w-8 h-8 bg-gradient-to-br from-red-600 to-red-800 rounded-full flex items-center justify-center text-white font-bold text-xs border-2 border-red-500/50 group-hover:border-red-500 transition-colors">
                      {(adminProfile?.fullName || adminProfile?.username || "A").charAt(0).toUpperCase()}
                    </div>
                  )}
                </button>

                {menuOpen && (
                  <div className="absolute right-0 top-full mt-2 w-56 bg-gray-900 border border-white/10 rounded-xl shadow-xl z-50 overflow-hidden">
                    <div className="px-4 py-3 border-b border-white/10">
                      <p className="text-white text-sm font-medium truncate">
                        {adminProfile?.fullName || adminProfile?.username || "Admin"}
                      </p>
                      <p className="text-gray-400 text-xs truncate">
                        {adminProfile?.username || ""}
                      </p>
                    </div>
                    <div className="py-1">
                      <Link
                        href="/admin"
                        onClick={() => setMenuOpen(false)}
                        className="flex items-center gap-3 px-4 py-2.5 text-sm text-gray-200 hover:bg-white/10 hover:text-white transition-colors"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                        Admin Panel
                      </Link>
                      <div className="border-t border-white/10 my-1" />
                      <button
                        onClick={async () => {
                          setMenuOpen(false);
                          await fetch("/api/auth/logout", { method: "POST" });
                          window.location.href = "/sign-in";
                        }}
                        className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-200 hover:bg-white/10 hover:text-white transition-colors text-left"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                        Sign Out
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </nav>

          {/* Mobile right buttons */}
          <div className="flex items-center gap-2 md:hidden">
            {/* Mobile Admin Profile Indicator */}
            {admin && (
              <Link href="/admin" className="mr-1" prefetch={true}>
                {adminProfile?.profilePhoto ? (
                  <img
                    src={adminProfile.profilePhoto}
                    alt="Admin"
                    className="w-7 h-7 rounded-full object-cover border-2 border-red-500/50"
                  />
                ) : (
                  <div className="w-7 h-7 bg-gradient-to-br from-red-600 to-red-800 rounded-full flex items-center justify-center text-white font-bold text-xs border-2 border-red-500/50">
                    {(adminProfile?.fullName || adminProfile?.username || "A").charAt(0).toUpperCase()}
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
            prefetch={true}
          >
            {t("nav_home")}
          </Link>
          <Link
            href="/#saluran-tv"
            onClick={() => setMobileMenuOpen(false)}
            className="text-gray-300 hover:text-white hover:bg-white/5 transition-all text-sm font-medium px-4 py-3 rounded-lg"
            prefetch={true}
          >
            {t("nav_saluran_tv")}
          </Link>
          <Link
            href="/radio"
            onClick={() => setMobileMenuOpen(false)}
            className="text-gray-300 hover:text-white hover:bg-white/5 transition-all text-sm font-medium px-4 py-3 rounded-lg"
            prefetch={true}
          >
            {t("nav_radio")}
          </Link>
          <Link
            href="/#saluran-khas"
            onClick={() => setMobileMenuOpen(false)}
            className="text-gray-300 hover:text-white hover:bg-white/5 transition-all text-sm font-medium px-4 py-3 rounded-lg"
            prefetch={true}
          >
            {t("nav_saluran_khas")}
          </Link>
          <Link
            href="/schedule"
            onClick={() => setMobileMenuOpen(false)}
            className="text-gray-300 hover:text-white hover:bg-white/5 transition-all text-sm font-medium px-4 py-3 rounded-lg"
            prefetch={true}
          >
            {t("nav_schedule")}
          </Link>
          <div className="h-px bg-white/10 my-1" />
          {admin ? (
            <Link
              href="/admin"
              onClick={() => setMobileMenuOpen(false)}
              className="text-gray-200 hover:text-white transition-all text-xs font-medium px-4 py-2 rounded-lg"
              prefetch={true}
            >
              Admin Panel
            </Link>
          ) : (
            <Link
              href="/sign-in"
              onClick={() => setMobileMenuOpen(false)}
              className="text-gray-500 hover:text-gray-300 transition-all text-xs font-medium px-4 py-2 rounded-lg"
              prefetch={true}
            >
              Sign In
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
