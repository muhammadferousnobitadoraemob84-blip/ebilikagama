"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

interface Channel {
  id: string;
  name: string;
  category: string;
  twitchUsername: string;
  thumbnail: string | null;
  description: string | null;
  liveStatus: string;
  displayOrder: number;
  active: boolean;
}

interface Toast {
  type: "success" | "error";
  message: string;
}

export default function AdminChannels() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "saluran-tv" | "saluran-khas">("all");
  const [deleteModal, setDeleteModal] = useState<string | null>(null);
  const [deleteModalName, setDeleteModalName] = useState("");
  const [deleteWarning, setDeleteWarning] = useState<{ programCount: number; channelId: string; channelName: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);

  const showToast = (type: "success" | "error", message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 4000);
  };

  const fetchChannels = useCallback(async () => {
    try {
      const res = await fetch("/api/channels?all=true");
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      setChannels(data.sort((a: Channel, b: Channel) => a.displayOrder - b.displayOrder));
    } catch {
      showToast("error", "Gagal memuatkan senarai saluran");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchChannels();
  }, [fetchChannels]);

  const filteredChannels = filter === "all" ? channels : channels.filter((c) => c.category === filter);

  const openDeleteModal = (id: string, name: string) => {
    setDeleteModal(id);
    setDeleteModalName(name);
  };

  const handleDelete = async (force = false) => {
    if (!deleteModal) return;
    setDeleting(true);

    try {
      const url = force
        ? `/api/channels/${deleteModal}?force=true`
        : `/api/channels/${deleteModal}`;
      const res = await fetch(url, { method: "DELETE" });
      const data = await res.json();

      // First request: warning about programs
      if (data.warning && !force) {
        setDeleteWarning({
          programCount: data.programCount,
          channelId: data.channelId,
          channelName: data.channelName,
        });
        setDeleting(false);
        return;
      }

      if (!res.ok) {
        showToast("error", data.error || "Saluran gagal dipadam. Sila cuba lagi.");
        setDeleting(false);
        return;
      }

      // Remove from local state
      setChannels((prev) => prev.filter((c) => c.id !== deleteModal));
      setDeleteModal(null);
      setDeleteModalName("");
      setDeleteWarning(null);
      const msg = data.programsDeleted > 0
        ? `Saluran berjaya dipadam bersama ${data.programsDeleted} program jadual.`
        : "Saluran berjaya dipadam.";
      showToast("success", msg);
    } catch {
      showToast("error", "Saluran gagal dipadam. Sila cuba lagi.");
    } finally {
      setDeleting(false);
    }
  };

  const handleToggleActive = async (channel: Channel) => {
    try {
      const res = await fetch(`/api/channels/${channel.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !channel.active }),
      });
      if (res.ok) {
        setChannels((prev) =>
          prev.map((c) => (c.id === channel.id ? { ...c, active: !c.active } : c))
        );
        showToast("success", channel.active ? "Saluran dinonaktifkan." : "Saluran diaktifkan.");
      } else {
        const data = await res.json();
        showToast("error", data.error || "Gagal mengubah status saluran.");
      }
    } catch {
      showToast("error", "Gagal mengubah status saluran.");
    }
  };

  const handleMoveUp = async (channel: Channel) => {
    const sameCategory = channels
      .filter((c) => c.category === channel.category)
      .sort((a, b) => a.displayOrder - b.displayOrder);
    const idx = sameCategory.findIndex((c) => c.id === channel.id);
    if (idx <= 0) return;

    const prev = sameCategory[idx - 1];
    const updates = [
      { id: channel.id, displayOrder: prev.displayOrder },
      { id: prev.id, displayOrder: channel.displayOrder },
    ];

    try {
      const res = await fetch("/api/channels", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channels: updates }),
      });
      if (res.ok) {
        fetchChannels();
      }
    } catch {
      // silent
    }
  };

  const handleMoveDown = async (channel: Channel) => {
    const sameCategory = channels
      .filter((c) => c.category === channel.category)
      .sort((a, b) => a.displayOrder - b.displayOrder);
    const idx = sameCategory.findIndex((c) => c.id === channel.id);
    if (idx >= sameCategory.length - 1) return;

    const next = sameCategory[idx + 1];
    const updates = [
      { id: channel.id, displayOrder: next.displayOrder },
      { id: next.id, displayOrder: channel.displayOrder },
    ];

    try {
      const res = await fetch("/api/channels", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channels: updates }),
      });
      if (res.ok) {
        fetchChannels();
      }
    } catch {
      // silent
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-10 h-10 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div>
      {/* Toast Notification */}
      {toast && (
        <div className={`fixed top-4 right-4 z-[60] max-w-sm w-full px-4 py-3 rounded-xl text-sm font-medium shadow-lg flex items-center gap-2 transition-all ${
          toast.type === "success"
            ? "bg-green-600/90 text-white border border-green-500/50"
            : "bg-red-600/90 text-white border border-red-500/50"
        }`}>
          {toast.type === "success" ? (
            <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          ) : (
            <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          )}
          {toast.message}
        </div>
      )}

      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-white text-2xl font-bold">Pengurusan Saluran</h1>
          <p className="text-gray-400 mt-1">Urus semua saluran televisyen</p>
        </div>
        <Link
          href="/admin/channels/new"
          className="admin-btn admin-btn-primary flex items-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Tambah Saluran
        </Link>
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-2 mb-6">
        {[
          { value: "all" as const, label: "Semua" },
          { value: "saluran-tv" as const, label: "Saluran TV" },
          { value: "saluran-khas" as const, label: "Saluran Khas" },
        ].map((tab) => (
          <button
            key={tab.value}
            onClick={() => setFilter(tab.value)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              filter === tab.value
                ? "bg-red-600 text-white"
                : "bg-white/5 text-gray-400 hover:text-white hover:bg-white/10"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Channel List */}
      {filteredChannels.length === 0 ? (
        <div className="text-center py-20 admin-card">
          <p className="text-gray-400 text-lg mb-4">Tiada saluran ditemui</p>
          <Link
            href="/admin/channels/new"
            className="inline-flex items-center gap-2 admin-btn admin-btn-primary"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Tambah Saluran Pertama
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredChannels.map((channel, idx) => (
            <div
              key={channel.id}
              className={`admin-card flex items-center gap-4 ${
                !channel.active ? "opacity-60" : ""
              }`}
            >
              {/* Thumbnail */}
              <div className="w-24 sm:w-32 flex-shrink-0">
                {channel.thumbnail ? (
                  <img
                    src={channel.thumbnail}
                    alt={channel.name}
                    className="w-full aspect-video object-cover rounded-lg"
                  />
                ) : (
                  <div className="w-full aspect-video bg-gray-800 rounded-lg flex items-center justify-center">
                    <svg className="w-8 h-8 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  </div>
                )}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="text-white font-semibold truncate">{channel.name}</h3>
                  {channel.liveStatus === "live" && (
                    <span className="bg-red-600 text-white text-xs font-bold px-2 py-0.5 rounded flex items-center gap-1">
                      <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
                      LIVE
                    </span>
                  )}
                  {!channel.active && (
                    <span className="bg-gray-600 text-gray-300 text-xs font-medium px-2 py-0.5 rounded">
                      DINONAKTIFKAN
                    </span>
                  )}
                </div>
                <p className="text-gray-400 text-sm truncate">
                  Twitch: {channel.twitchUsername}
                </p>
                <div className="flex items-center gap-3 mt-1">
                  <span className="text-gray-500 text-xs">
                    {channel.category === "saluran-tv" ? "Saluran TV" : "Saluran Khas"}
                  </span>
                  <span className="text-gray-600 text-xs">•</span>
                  <span className="text-gray-500 text-xs">Susunan: {channel.displayOrder}</span>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 flex-shrink-0">
                {/* Move Up/Down */}
                <div className="hidden sm:flex flex-col gap-1">
                  <button
                    onClick={() => handleMoveUp(channel)}
                    disabled={idx === 0 || filteredChannels[idx - 1]?.category !== channel.category}
                    className="text-gray-500 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed p-1"
                    title="Gerak ke atas"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                    </svg>
                  </button>
                  <button
                    onClick={() => handleMoveDown(channel)}
                    disabled={idx === filteredChannels.length - 1 || filteredChannels[idx + 1]?.category !== channel.category}
                    className="text-gray-500 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed p-1"
                    title="Gerak ke bawah"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                </div>

                {/* Enable/Disable */}
                <button
                  onClick={() => handleToggleActive(channel)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    channel.active
                      ? "bg-green-600/20 text-green-400 hover:bg-green-600/30"
                      : "bg-gray-600/20 text-gray-400 hover:bg-gray-600/30"
                  }`}
                  title={channel.active ? "Nonaktifkan" : "Aktifkan"}
                >
                  {channel.active ? "Aktif" : "Mati"}
                </button>

                {/* Edit */}
                <Link
                  href={`/admin/channels/edit/${channel.id}`}
                  className="px-3 py-1.5 bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 rounded-lg text-xs font-medium transition-colors"
                >
                  Sunting
                </Link>

                {/* Delete */}
                <button
                  onClick={() => openDeleteModal(channel.id, channel.name)}
                  className="px-3 py-1.5 bg-red-600/20 text-red-400 hover:bg-red-600/30 rounded-lg text-xs font-medium transition-colors"
                >
                  Padam
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteModal && !deleteWarning && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-white/10 rounded-2xl p-6 max-w-md w-full">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-red-600/20 rounded-xl flex items-center justify-center">
                <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              </div>
              <h3 className="text-white font-semibold text-lg">Padam Saluran</h3>
            </div>
            <p className="text-gray-400 mb-2">
              Adakah anda pasti mahu memadamkan saluran ini?
            </p>
            <p className="text-gray-500 text-sm mb-6">
              &quot;{deleteModalName}&quot; — Tindakan ini tidak boleh dibatalkan.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => { setDeleteModal(null); setDeleteModalName(""); }}
                className="admin-btn admin-btn-secondary"
                disabled={deleting}
              >
                Batal
              </button>
              <button
                onClick={() => handleDelete(false)}
                disabled={deleting}
                className="admin-btn admin-btn-danger flex items-center gap-2"
              >
                {deleting ? (
                  <>
                    <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                    Memadam...
                  </>
                ) : (
                  "Padam"
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Program Warning Modal */}
      {deleteWarning && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-white/10 rounded-2xl p-6 max-w-md w-full">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-yellow-600/20 rounded-xl flex items-center justify-center">
                <svg className="w-5 h-5 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              </div>
              <h3 className="text-white font-semibold text-lg">Amaran Jadual Siaran</h3>
            </div>
            <p className="text-gray-300 mb-2">
              Saluran <strong>&quot;{deleteWarning.channelName}&quot;</strong> mempunyai <strong>{deleteWarning.programCount} program</strong> jadual yang berkaitan.
            </p>
            <p className="text-gray-400 text-sm mb-6">
              Semua program jadual untuk saluran ini akan turut dipadamkan. Adakah anda pasti?
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => { setDeleteWarning(null); setDeleteModal(null); setDeleteModalName(""); }}
                className="admin-btn admin-btn-secondary"
                disabled={deleting}
              >
                Batal
              </button>
              <button
                onClick={() => handleDelete(true)}
                disabled={deleting}
                className="admin-btn admin-btn-danger flex items-center gap-2"
              >
                {deleting ? (
                  <>
                    <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                    Memadam...
                  </>
                ) : (
                  "Padam Saluran & Jadual"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
