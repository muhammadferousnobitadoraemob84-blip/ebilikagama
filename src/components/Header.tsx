"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useLanguage } from "@/components/LanguageProvider";
import LanguageSelector from "@/components/LanguageSelector";

interface Settings {
  site_name?: string;
  site_logo?: string;
}

interface UserProfile {
  loggedIn: boolean;
  username?: string;
  fullName?: string;
  profilePhoto?: string | null;
  role?: string;
}

// Cross-tab logout: bumped in localStorage when any tab logs out. Other
// tabs observe the change and re-check the (now invalid) session instead
// of trusting stale UI state.
export const AUTH_EPOCH_KEY = "ebilikagama-auth-epoch";

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

// Cache user profile (any authenticated role: user / admin / owner)
let cachedProfile: UserProfile | null = null;
let profileFetchPromise: Promise<UserProfile> | null = null;

function getProfile(): Promise<UserProfile> {
  if (cachedProfile) return Promise.resolve(cachedProfile);
  if (profileFetchPromise) return profileFetchPromise;

  profileFetchPromise = fetch("/api/auth/admin-profile")
    .then((r) => r.json())
    .then((data) => {
      cachedProfile = data;
      return data;
    })
    .catch(() => ({ loggedIn: false } as UserProfile));

  return profileFetchPromise;
}

function clearProfileCache() {
  cachedProfile = null;
  profileFetchPromise = null;
}

function isAdminRole(role?: string | null): boolean {
  if (!role) return false;
  const normalized = role.toLowerCase();
  return normalized === "admin" || normalized === "owner";
}

export default function Header() {
  const [settings, setSettings] = useState<Settings>(cachedSettings || {});
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(cachedProfile);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const logoutInFlight = useRef(false);
  const router = useRouter();
  const { t } = useLanguage();

  const authenticated = profile?.loggedIn === true;
  const admin = authenticated && isAdminRole(profile?.role);

  useEffect(() => {
    getSettings().then(setSettings);
    getProfile().then((p) => {
      setProfile(p);
      // Server-side session check: the edge proxy only verifies the JWT
      // signature, but a revoked session (logout/password reset/disable)
      // fails deep validation in the API. If the server says logged-out
      // while we are on a protected page, the token is stale — leave.
      if (!p.loggedIn) {
        const path = window.location.pathname;
        const isPublicPage =
          path === "/sign-in" ||
          path === "/admin/login" ||
          path.startsWith("/blocked");
        if (!isPublicPage) {
          window.location.replace("/sign-in?loggedOut=1");
        }
      }
    });

    const handleSettingsChanged = () => {
      clearSettingsCache();
      getSettings().then(setSettings);
    };
    window.addEventListener("settings-changed", handleSettingsChanged);
    return () => window.removeEventListener("settings-changed", handleSettingsChanged);
  }, []);

  // Close the account menu on outside click / Escape
  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  // Cross-tab session invalidation: another tab logged out → re-verify and
  // leave protected pages instead of trusting stale UI state.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== AUTH_EPOCH_KEY) return;
      clearProfileCache();
      getProfile().then((p) => {
        setProfile(p);
        if (!p.loggedIn) {
          setMenuOpen(false);
          router.refresh();
        }
      });
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [router]);

  const performLogout = async () => {
    if (logoutInFlight.current) return; // prevent duplicate logout requests
    logoutInFlight.current = true;
    setConfirmOpen(false);
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // Network failure must not trap the user: still clear local state.
    } finally {
      clearProfileCache();
      // Notify other tabs that the session ended
      try {
        localStorage.setItem(AUTH_EPOCH_KEY, String(Date.now()));
        localStorage.removeItem(AUTH_EPOCH_KEY);
      } catch {
        // storage unavailable — single-tab still works
      }
      setLoggingOut(false);
      // Full navigation (not client-side push) so protected pages are
      // re-verified server-side and Back cannot restore a stale session.
      const target = `/sign-in?loggedOut=1`;
      window.location.replace(target);
    }
  };

  const siteName = settings.site_name || "eBilikAgamaTV";

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

            {/* Account menu — shown for ANY authenticated user (user, admin,
                owner). Logout lives here for everyone; admins additionally
                get the Admin Panel entry. */}
            {authenticated && (
              <div className="relative ml-2" ref={menuRef}>
                <button
                  onClick={() => setMenuOpen(!menuOpen)}
                  className="flex items-center gap-2 group"
                  aria-label={t("sign_out")}
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                >
                  {profile?.profilePhoto ? (
                    <img
                      src={profile.profilePhoto}
                      alt={profile.fullName || profile.username || "User"}
                      className={`w-8 h-8 rounded-full object-cover border-2 transition-colors ${
                        admin ? "border-red-500/50 group-hover:border-red-500" : "border-white/20 group-hover:border-white/50"
                      }`}
                    />
                  ) : (
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-xs border-2 transition-colors ${
                        admin
                          ? "bg-gradient-to-br from-red-600 to-red-800 border-red-500/50 group-hover:border-red-500"
                          : "bg-gradient-to-br from-gray-600 to-gray-700 border-white/20 group-hover:border-white/50"
                      }`}
                    >
                      {(profile?.fullName || profile?.username || "U").charAt(0).toUpperCase()}
                    </div>
                  )}
                </button>

                {menuOpen && (
                  <div
                    className="absolute right-0 top-full mt-2 w-56 bg-gray-900 border border-white/10 rounded-xl shadow-xl z-50 overflow-hidden"
                    role="menu"
                  >
                    <div className="px-4 py-3 border-b border-white/10">
                      <p className="text-white text-sm font-medium truncate">
                        {profile?.fullName || profile?.username || "User"}
                      </p>
                      <p className="text-gray-400 text-xs truncate">
                        {profile?.username || ""}
                      </p>
                    </div>
                    <div className="py-1">
                      {admin && (
                        <>
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
                        </>
                      )}
                      <button
                        onClick={() => {
                          setMenuOpen(false);
                          setConfirmOpen(true);
                        }}
                        disabled={loggingOut}
                        className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-200 hover:bg-white/10 hover:text-white transition-colors text-left disabled:opacity-50"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1m0 0h4m4 0l-4 4m4-4l-4-4" />
                        </svg>
                        {t("sign_out")}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </nav>

          {/* Mobile right buttons */}
          <div className="flex items-center gap-2 md:hidden">
            {/* Mobile account avatar — opens the shared account menu (works
                for normal users AND admins). */}
            {authenticated && (
              <button
                onClick={() => setMenuOpen(!menuOpen)}
                className="mr-1"
                aria-label={t("sign_out")}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
              >
                {profile?.profilePhoto ? (
                  <img
                    src={profile.profilePhoto}
                    alt={profile.fullName || profile.username || "User"}
                    className={`w-7 h-7 rounded-full object-cover border-2 ${
                      admin ? "border-red-500/50" : "border-white/20"
                    }`}
                  />
                ) : (
                  <div
                    className={`w-7 h-7 rounded-full flex items-center justify-center text-white font-bold text-xs border-2 ${
                      admin
                        ? "bg-gradient-to-br from-red-600 to-red-800 border-red-500/50"
                        : "bg-gradient-to-br from-gray-600 to-gray-700 border-white/20"
                    }`}
                  >
                    {(profile?.fullName || profile?.username || "U").charAt(0).toUpperCase()}
                  </div>
                )}
              </button>
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
          {authenticated ? (
            <>
              <div className="h-px bg-white/10 my-1" />
              {/* Account identity + logout for normal users and admins */}
              <div className="px-4 py-2">
                <p className="text-white text-sm font-medium truncate">
                  {profile?.fullName || profile?.username || "User"}
                </p>
                <p className="text-gray-400 text-xs truncate">{profile?.username || ""}</p>
              </div>
              {admin && (
                <Link
                  href="/admin"
                  onClick={() => setMobileMenuOpen(false)}
                  className="text-gray-200 hover:text-white transition-all text-sm font-medium px-4 py-2.5 rounded-lg"
                  prefetch={true}
                >
                  {t("admin_panel")}
                </Link>
              )}
              <button
                onClick={() => {
                  setMobileMenuOpen(false);
                  setConfirmOpen(true);
                }}
                disabled={loggingOut}
                className="flex items-center gap-3 text-gray-200 hover:text-white hover:bg-white/5 transition-all text-sm font-medium px-4 py-2.5 rounded-lg text-left disabled:opacity-50"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1m0 0h4m4 0l-4 4m4-4l-4-4" />
                </svg>
                {t("sign_out")}
              </button>
            </>
          ) : (
            <Link
              href="/sign-in"
              onClick={() => setMobileMenuOpen(false)}
              className="text-gray-500 hover:text-gray-300 transition-all text-xs font-medium px-4 py-2 rounded-lg"
              prefetch={true}
            >
              {t("sign_in_button")}
            </Link>
          )}
        </nav>
      </div>

      {/* Logout confirmation dialog */}
      {confirmOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm px-4"
          role="dialog"
          aria-modal="true"
          onClick={() => !loggingOut && setConfirmOpen(false)}
        >
          <div
            className="bg-gray-900 border border-white/10 rounded-2xl shadow-2xl w-full max-w-sm p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-white text-lg font-semibold">{t("sign_out")}</h3>
            <p className="text-gray-400 text-sm mt-2">{t("logout_confirm_message")}</p>
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setConfirmOpen(false)}
                disabled={loggingOut}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium text-gray-200 bg-white/5 hover:bg-white/10 border border-white/10 transition-colors disabled:opacity-50"
              >
                {t("logout_cancel")}
              </button>
              <button
                onClick={performLogout}
                disabled={loggingOut}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold text-white bg-gradient-to-br from-red-600 to-red-800 hover:from-red-500 hover:to-red-700 transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {loggingOut && (
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                  </svg>
                )}
                {loggingOut ? t("logout_loading") : t("sign_out")}
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
