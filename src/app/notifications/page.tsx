"use client";

// User notifications (spec §12/§17) — the signed-in user's announcements.
// Web-notification permission is requested AT MOST once, only from this
// explicit opt-in button — never repeatedly, never on page load.

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useLanguage } from "@/components/LanguageProvider";

interface Row {
  id: string;
  title: string;
  message: string;
  feature: string | null;
  createdAt: string;
  expiresAt: string | null;
  readAt: string | null;
}

function fmt(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString([], { hour12: false }) : "—";
}

export default function NotificationsPage() {
  const { t } = useLanguage();
  const vr = t as unknown as (key: string) => string;
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [authed, setAuthed] = useState(true);
  // Web Notifications prep (§17): capability + one-time permission request.
  const [notifSupported, setNotifSupported] = useState(false);
  const [notifPerm, setNotifPerm] = useState<NotificationPermission | "unsupported">("unsupported");
  const [askedOnce, setAskedOnce] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications?scope=mine", { cache: "no-store" });
      if (res.status === 401) {
        setAuthed(false);
        return;
      }
      if (res.ok) {
        const d = await res.json();
        setRows(d.rows ?? []);
      }
    } catch {
      // transient
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    // Capability detection — honest about unsupported browsers (§17).
    try {
      if (typeof window !== "undefined" && "Notification" in window) {
        setNotifSupported(true);
        setNotifPerm(Notification.permission);
      }
      setAskedOnce(localStorage.getItem("ebilikagama-notif-asked") === "1");
    } catch {
      // ignore
    }
  }, [load]);

  const markRead = async (id: string) => {
    try {
      await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "mark-read", id }),
      });
      load();
    } catch {
      // transient
    }
  };

  const requestPermission = async () => {
    if (!notifSupported) return;
    setAskedOnce(true);
    try {
      localStorage.setItem("ebilikagama-notif-asked", "1");
      const perm = await Notification.requestPermission();
      setNotifPerm(perm);
    } catch {
      setNotifPerm("denied");
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-10 h-10 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!authed) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 px-4 text-center">
        <p className="text-white text-lg font-bold">{vr("sign_in_required")}</p>
        <button onClick={() => router.push("/sign-in")} className="admin-btn admin-btn-primary text-sm">{vr("sign_in_button")}</button>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-4">
      <h1 className="text-white text-2xl font-bold">{vr("nc_title")}</h1>

      {/* Web notification opt-in (never asked more than once) */}
      {notifSupported && notifPerm === "default" && !askedOnce && (
        <div className="bg-gray-900 border border-white/10 rounded-2xl p-4 flex items-center justify-between gap-3">
          <p className="text-gray-300 text-xs">{vr("wn_optin_desc")}</p>
          <button onClick={requestPermission} className="admin-btn admin-btn-secondary text-xs flex-shrink-0">
            {vr("wn_optin")}
          </button>
        </div>
      )}
      {notifSupported && notifPerm === "denied" && (
        <p className="text-gray-600 text-[11px]">{vr("wn_blocked")}</p>
      )}
      {!notifSupported && (
        <p className="text-gray-600 text-[11px]">{vr("wn_unsupported")}</p>
      )}

      {rows.length === 0 ? (
        <div className="bg-gray-900 border border-white/10 rounded-2xl p-8 text-center">
          <p className="text-gray-400 text-sm">{vr("nc_none")}</p>
        </div>
      ) : (
        rows.map((n) => (
          <div
            key={n.id}
            className={`bg-gray-900 border rounded-2xl p-4 ${n.readAt ? "border-white/10 opacity-70" : "border-red-600/30"}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-white text-sm font-bold">
                  {!n.readAt && <span className="inline-block w-2 h-2 bg-red-500 rounded-full mr-2 align-middle" />}
                  {n.title}
                </p>
                <p className="text-gray-300 text-sm mt-1 whitespace-pre-wrap">{n.message}</p>
                <p className="text-gray-600 text-[11px] mt-2">
                  {fmt(n.createdAt)}
                  {n.feature ? ` · ${n.feature}` : ""}
                  {n.expiresAt ? ` · ${vr("nc_expiry")}: ${fmt(n.expiresAt)}` : ""}
                </p>
              </div>
              {!n.readAt && (
                <button onClick={() => markRead(n.id)} className="text-gray-500 hover:text-white text-xs px-2 py-1 flex-shrink-0">
                  {vr("nc_mark_read")}
                </button>
              )}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
