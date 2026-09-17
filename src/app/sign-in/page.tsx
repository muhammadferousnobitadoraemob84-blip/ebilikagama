"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useLanguage } from "@/components/LanguageProvider";

// Login must fail visibly instead of spinning forever if the backend or
// network hangs (cold serverless start, DB stall, lost connection).
const LOGIN_TIMEOUT_MS = 15_000;

export default function SignInPage() {
  const searchParams = useSearchParams();
  const redirect = searchParams.get("redirect") || "/";
  const { t } = useLanguage();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [adminView, setAdminView] = useState(false);

  // Live database status: when the backend database is down (e.g. exhausted
  // hosting transfer quota), sign-in cannot succeed — so say so plainly and
  // show live recovery status instead of a misleading "invalid credentials"
  // style error after every attempt.
  const [dbStatus, setDbStatus] = useState<"unknown" | "ok" | "down">("unknown");
  const [checkingDb, setCheckingDb] = useState(false);

  const checkDb = useCallback(async () => {
    setCheckingDb(true);
    try {
      const r = await fetch("/api/health/db", { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      setDbStatus(j?.database === "reachable" ? "ok" : "down");
    } catch {
      setDbStatus("down");
    } finally {
      setCheckingDb(false);
    }
  }, []);

  useEffect(() => {
    checkDb();
    const id = setInterval(checkDb, 60_000); // poll until service returns
    return () => clearInterval(id);
  }, [checkDb]);

  // Post-logout confirmation: Header redirects here with ?loggedOut=1
  const loggedOutNotice = searchParams.get("loggedOut") === "1";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return; // no duplicate submissions
    setError("");
    setLoading(true);

    // AbortController guarantees the fetch cannot hang past the timeout.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LOGIN_TIMEOUT_MS);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, isAdmin: adminView ? true : undefined }),
        signal: controller.signal,
      });

      let data: { error?: string } = {};
      try {
        data = await res.json();
      } catch {
        // Non-JSON response (proxy error page etc.) — fall through to !res.ok
      }

      if (!res.ok) {
        if (res.status === 503) checkDb(); // database outage — refresh the banner
        setError(data.error || t("sign_in_error_generic"));
        return; // finally resets loading
      }

      console.log("[LOGIN] success → redirect", redirect || "/");
      // Authentication succeeded: navigate with a FULL document load.
      // router.push() uses the client router cache, which may contain a
      // prefetch of the target made *before* login (while logged out, "/" is
      // cached as a 307 to /sign-in?redirect=%2F). The push then "succeeds"
      // by replaying that cached redirect — user stays stranded on the
      // sign-in route while the previous user's header identity keeps
      // rendering (multi-user contamination). A full load makes the server
      // evaluate the fresh session cookie directly and cannot be poisoned
      // by pre-login cache entries. It is also typically faster than a
      // client-side push here, because no stale RSC round-trip precedes it.
      setLoading(false);
      window.location.replace(redirect || "/");
      return;
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setError(t("sign_in_error_timeout"));
      } else {
        setError(t("sign_in_error_network"));
      }
    } finally {
      clearTimeout(timer);
      setLoading(false); // always reset: success, failure, or timeout
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-black px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="mx-auto mb-4 w-16 h-16 bg-gradient-to-br from-red-600 to-red-800 rounded-2xl flex items-center justify-center text-white font-bold text-2xl shadow-lg shadow-red-600/20">
            MS
          </div>
          <h1 className="text-white text-2xl font-bold">{t("sign_in_title")}</h1>
          <p className="text-gray-400 mt-2">{t("sign_in_subtitle")}</p>
        </div>

        {/* Login Form */}
        <form onSubmit={handleSubmit} className="space-y-5 bg-gray-900 rounded-xl border border-white/10 p-6">
          {loggedOutNotice && (
            <div
              className="bg-green-600/10 border border-green-600/30 text-green-400 px-4 py-3 rounded-xl text-sm flex items-center gap-2"
              role="status"
            >
              <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {t("logout_success")}
            </div>
          )}
          {dbStatus === "down" && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4" role="alert">
              <div className="flex items-start gap-3">
                <svg className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
                <div className="flex-1 min-w-0">
                  <p className="text-amber-400 text-sm font-semibold">{t("service_disruption_title")}</p>
                  <p className="text-amber-200/70 text-xs mt-1 leading-relaxed">{t("service_disruption_detail")}</p>
                  <div className="flex items-center gap-3 mt-2.5">
                    <span className="inline-flex items-center gap-1.5 text-xs text-gray-400">
                      {t("service_disruption_status")}:
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border border-red-500/30 bg-red-500/10 text-red-400 text-[11px] font-medium">
                        <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
                        {t("service_status_down")}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={checkDb}
                      disabled={checkingDb}
                      className="text-xs text-amber-400 hover:text-amber-300 underline underline-offset-2 disabled:opacity-50"
                    >
                      {checkingDb ? t("service_disruption_retrying") : t("service_disruption_retry")}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
          {error && dbStatus !== "down" && (
            <div className="bg-red-600/10 border border-red-600/30 text-red-400 px-4 py-3 rounded-xl text-sm flex items-center gap-2">
              <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
              {error}
            </div>
          )}

          <div>
            <label className="block text-gray-300 text-sm font-medium mb-2">
              {t("sign_in_username_label")}
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
              </div>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full admin-input pl-10!"
                placeholder={adminView ? "Admin username" : "username / email"}
                required
                autoComplete="username"
                autoFocus
              />
            </div>
          </div>

          <div>
            <label className="block text-gray-300 text-sm font-medium mb-2">
              {t("sign_in_password_label")}
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full admin-input pl-10! pr-10!"
                placeholder="••••••••"
                required
                autoComplete="current-password"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-500 hover:text-gray-300 transition-colors"
                tabIndex={-1}
              >
                {showPassword ? (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full admin-btn admin-btn-primary py-3 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                {t("sign_in_button")}
              </span>
            ) : (
              t("sign_in_button")
            )}
          </button>

          {/* Administrator entry point — visually distinct, redirects to the
              dedicated admin sign-in (role is verified server-side) */}
          <div className="pt-3 border-t border-white/10 text-center">
            <p className="text-gray-500 text-xs mb-2">{t("admin_sign_in_prompt")}</p>
            <a
              href="/admin/login"
              className="inline-flex items-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 text-gray-300 hover:text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              {t("admin_sign_in_button")}
            </a>
          </div>
        </form>
      </div>
    </div>
  );
}
