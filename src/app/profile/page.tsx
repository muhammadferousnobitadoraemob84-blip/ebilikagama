"use client";

// My Profile (spec §13/§14) — identity, language, active sessions, and a
// secure password change through the EXISTING /api/auth/account endpoint.
// The current password is never displayed anywhere.

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useLanguage } from "@/components/LanguageProvider";
import { LANGUAGES, type Language } from "@/lib/i18n";
import { useConnectionStatus } from "@/lib/connection";

interface Me {
  authenticated: boolean;
  username: string;
  fullName: string | null;
  profilePhoto: string | null;
  role: string;
}
interface SessionRow {
  id: string;
  device: string;
  loginAt: string;
  lastActivityAt: string;
  logoutAt: string | null;
  activeNow: boolean;
}

function fmt(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString([], { hour12: false }) : "—";
}

export default function ProfilePage() {
  const { t, language: lang, setLanguage: setLang } = useLanguage();
  const vr = t as unknown as (key: string) => string;
  const router = useRouter();
  const conn = useConnectionStatus();

  const [me, setMe] = useState<Me | null>(null);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [meRes, sessRes] = await Promise.all([
        fetch("/api/auth/me", { cache: "no-store" }),
        fetch("/api/profile/sessions", { cache: "no-store" }),
      ]);
      if (meRes.ok) setMe(await meRes.json());
      if (sessRes.ok) {
        const d = await sessRes.json();
        setSessions(d.sessions ?? []);
      }
    } catch {
      // transient
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const changePassword = async () => {
    if (!currentPassword || !newPassword) return;
    if (newPassword !== confirmPassword) {
      setMsg({ type: "err", text: vr("um_err_password_mismatch") });
      return;
    }
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/auth/account", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const d = await res.json();
      if (!res.ok) {
        setMsg({ type: "err", text: d.error || vr("um_err_update") });
      } else {
        setMsg({ type: "ok", text: vr("mp_password_changed") });
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
        load();
      }
    } catch {
      setMsg({ type: "err", text: vr("um_err_network") });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-10 h-10 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!me?.authenticated) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 px-4 text-center">
        <p className="text-white text-lg font-bold">{vr("sign_in_required")}</p>
        <button onClick={() => router.push("/sign-in")} className="admin-btn admin-btn-primary text-sm">{vr("sign_in_button")}</button>
      </div>
    );
  }

  const roleLabel = (r: string) =>
    r === "owner" ? vr("um_role_owner") : r === "admin" ? vr("um_role_admin") : r === "editor" ? vr("mp_role_editor") : r === "viewer" ? vr("mp_role_viewer") : vr("um_role_user");

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-5">
      <h1 className="text-white text-2xl font-bold">{vr("mp_title")}</h1>

      {conn !== "online" && (
        <div className="bg-yellow-600/10 border border-yellow-600/30 text-yellow-300 px-4 py-3 rounded-xl text-sm">
          {conn === "offline" ? vr("conn_lost") : vr("conn_restored")}
        </div>
      )}

      {/* Identity */}
      <div className="bg-gray-900 border border-white/10 rounded-2xl p-5">
        <div className="flex items-center gap-4">
          {me.profilePhoto ? (
            <img src={me.profilePhoto} alt={me.fullName || me.username} className="w-16 h-16 rounded-full object-cover border-2 border-red-500/50" />
          ) : (
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-red-600 to-red-800 flex items-center justify-center text-white text-xl font-bold">
              {(me.fullName || me.username).charAt(0).toUpperCase()}
            </div>
          )}
          <div className="min-w-0">
            <p className="text-white text-lg font-bold truncate">{me.fullName || me.username}</p>
            <p className="text-gray-500 text-sm truncate">{me.username}</p>
            <span className="inline-block mt-1 text-[10px] font-bold px-2 py-0.5 rounded bg-red-600/20 text-red-300">
              {roleLabel(me.role)}
            </span>
          </div>
        </div>
      </div>

      {/* Language */}
      <div className="bg-gray-900 border border-white/10 rounded-2xl p-5">
        <h2 className="text-white font-semibold text-sm mb-3">{vr("mp_language")}</h2>
        <div className="flex gap-2 flex-wrap">
          {LANGUAGES.map((l) => (
            <button
              key={l.code}
              onClick={() => setLang(l.code as Language)}
              className={`px-3 py-2 rounded-lg text-xs font-medium border transition-colors ${
                lang === l.code ? "bg-red-600/20 border-red-600/40 text-red-300" : "bg-white/5 border-white/10 text-gray-300 hover:bg-white/10"
              }`}
            >
              {l.flag} {l.label}
            </button>
          ))}
        </div>
      </div>

      {/* Password change */}
      <div className="bg-gray-900 border border-white/10 rounded-2xl p-5 space-y-3">
        <h2 className="text-white font-semibold text-sm">{vr("mp_change_password")}</h2>
        <p className="text-gray-600 text-xs">{vr("mp_password_note")}</p>
        <input
          type="password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          placeholder={vr("mp_current_password")}
          autoComplete="current-password"
          className="admin-input text-sm"
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder={vr("um_label_password")}
            autoComplete="new-password"
            className="admin-input text-sm"
          />
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder={vr("um_label_confirm_password")}
            autoComplete="new-password"
            className="admin-input text-sm"
          />
        </div>
        {msg && (
          <p className={`text-xs ${msg.type === "ok" ? "text-green-400" : "text-red-400"}`}>{msg.text}</p>
        )}
        <button onClick={changePassword} disabled={saving || !currentPassword || !newPassword} className="admin-btn admin-btn-primary text-sm disabled:opacity-50">
          {saving ? vr("loading") : vr("mp_update_password")}
        </button>
      </div>

      {/* Active sessions */}
      <div className="bg-gray-900 border border-white/10 rounded-2xl p-5">
        <h2 className="text-white font-semibold text-sm mb-3">{vr("mp_sessions")}</h2>
        <ul className="space-y-2">
          {sessions.length === 0 && <li className="text-gray-500 text-sm">{vr("vrec_empty")}</li>}
          {sessions.map((s) => (
            <li key={s.id} className="flex items-center gap-3 bg-gray-900/60 border border-white/10 rounded-xl px-3 py-2.5">
              <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${s.activeNow ? "bg-green-500 animate-pulse" : "bg-gray-600"}`} />
              <div className="min-w-0 flex-1">
                <p className="text-white text-sm font-medium">{s.device}</p>
                <p className="text-gray-500 text-[11px]">
                  {s.activeNow ? vr("mp_active_now") : `${vr("mp_last_active")}: ${fmt(s.lastActivityAt)}`}
                </p>
              </div>
              <span className="text-gray-600 text-[10px] whitespace-nowrap">{fmt(s.loginAt)}</span>
            </li>
          ))}
        </ul>
        <p className="text-gray-600 text-[11px] mt-3">{vr("mp_sessions_note")}</p>
      </div>
    </div>
  );
}
