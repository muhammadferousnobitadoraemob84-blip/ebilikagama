"use client";

// Backup & Restore (spec §20) — OWNER ONLY. Creates a JSON backup of
// supported database/configuration data (hashed passwords only, no media
// binaries, no OAuth tokens). Metadata row shows Last Backup / Size / Status.

import { useCallback, useEffect, useState } from "react";
import { useLanguage } from "@/components/LanguageProvider";

interface BackupMeta {
  createdAt: string;
  sizeBytes: number;
  status: string;
  counts: Record<string, number>;
  durationMs?: number;
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export default function BackupPage() {
  const { t } = useLanguage();
  const vr = t as unknown as (key: string) => string;
  const [latest, setLatest] = useState<BackupMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [ok, setOk] = useState("");
  const [confirming, setConfirming] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/backup", { cache: "no-store" });
      if (!res.ok) {
        setError(res.status === 403 ? vr("bp_owner_only") : vr("bp_err"));
        return;
      }
      const d = await res.json();
      setLatest(d.latest ?? null);
      setError("");
    } catch {
      setError(vr("bp_err"));
    } finally {
      setLoading(false);
    }
  }, [vr]);

  useEffect(() => {
    load();
  }, [load]);

  const create = async () => {
    setConfirming(false);
    setCreating(true);
    setOk("");
    try {
      const res = await fetch("/api/backup", { method: "POST" });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}) as { error?: string });
        setError(d.error ?? vr("bp_err"));
        return;
      }
      // Download the returned JSON and refresh metadata.
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ebilikagama-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setOk(vr("bp_done"));
      load();
    } catch {
      setError(vr("bp_err"));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-5 max-w-3xl">
      <div>
        <h1 className="text-white text-2xl font-bold">{vr("bp_title")}</h1>
        <p className="text-gray-400 text-sm mt-1">{vr("bp_subtitle")}</p>
      </div>

      {error && <div className="bg-red-600/10 border border-red-600/30 text-red-400 px-4 py-3 rounded-xl text-sm">{error}</div>}
      {ok && <div className="bg-green-600/10 border border-green-600/30 text-green-400 px-4 py-3 rounded-xl text-sm">{ok}</div>}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="admin-card !p-4">
          <p className="text-gray-500 text-[11px] uppercase">{vr("bp_last")}</p>
          <p className="text-white text-sm font-semibold mt-1">{latest ? new Date(latest.createdAt).toLocaleString([], { hour12: false }) : vr("bp_never")}</p>
        </div>
        <div className="admin-card !p-4">
          <p className="text-gray-500 text-[11px] uppercase">{vr("bp_status")}</p>
          <p className={`text-sm font-semibold mt-1 ${latest?.status === "success" ? "text-green-400" : "text-gray-400"}`}>{latest?.status ?? "—"}</p>
        </div>
        <div className="admin-card !p-4">
          <p className="text-gray-500 text-[11px] uppercase">{vr("bp_size")}</p>
          <p className="text-white text-sm font-semibold mt-1">{latest ? fmtSize(latest.sizeBytes) : "—"}</p>
        </div>
      </div>

      <div className="admin-card space-y-3">
        <h2 className="text-white font-semibold text-sm">{vr("bp_create")}</h2>
        <p className="text-gray-500 text-xs leading-relaxed">{vr("bp_includes")}</p>
        <ul className="text-gray-400 text-xs grid grid-cols-1 sm:grid-cols-2 gap-1 list-disc list-inside">
          <li>{vr("bp_inc_users")}</li>
          <li>{vr("bp_inc_channels")}</li>
          <li>{vr("bp_inc_schedule")}</li>
          <li>{vr("bp_inc_radio")}</li>
          <li>{vr("bp_inc_azan")}</li>
          <li>{vr("bp_inc_settings")}</li>
          <li>{vr("bp_inc_visitor")}</li>
          <li>{vr("bp_inc_audit")}</li>
        </ul>
        <p className="text-yellow-500/80 text-xs leading-relaxed">{vr("bp_excluded")}</p>
        <button onClick={() => setConfirming(true)} disabled={creating || loading} className="admin-btn admin-btn-primary text-sm w-full sm:w-auto disabled:opacity-50">
          {creating ? vr("bp_creating") : vr("bp_create")}
        </button>
      </div>

      {confirming && (
        <div className="fixed inset-0 bg-black/70 z-[70] flex items-center justify-center p-4" onClick={() => !creating && setConfirming(false)}>
          <div className="admin-card w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-white font-bold text-lg">{vr("bp_confirm_title")}</h3>
            <p className="text-gray-300 text-sm mt-2">{vr("bp_confirm_desc")}</p>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setConfirming(false)} disabled={creating} className="flex-1 admin-btn admin-btn-secondary text-sm">{vr("logout_cancel")}</button>
              <button onClick={create} disabled={creating} className="flex-1 admin-btn admin-btn-primary text-sm">
                {creating ? vr("bp_creating") : vr("bp_confirm_yes")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
