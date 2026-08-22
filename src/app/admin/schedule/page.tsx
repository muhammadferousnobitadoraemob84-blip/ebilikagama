"use client";

import { useEffect, useState, useCallback } from "react";

interface Channel {
  id: string;
  name: string;
  category: string;
  active: boolean;
}

interface Program {
  id: string;
  channelId: string;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  description: string | null;
  thumbnail: string | null;
  status: string;
  channel: { id: string; name: string };
  createdAt: string;
}

interface ProgramForm {
  channelId: string;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  description: string;
  thumbnail: string;
  status: string;
}

const emptyForm: ProgramForm = {
  channelId: "",
  title: "",
  date: "",
  startTime: "",
  endTime: "",
  description: "",
  thumbnail: "",
  status: "scheduled",
};

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString("ms-MY", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return dateStr;
  }
}

function calcDuration(start: string, end: string): string {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  let diff = (eh * 60 + em) - (sh * 60 + sm);
  if (diff < 0) diff += 24 * 60; // crosses midnight
  const h = Math.floor(diff / 60);
  const m = diff % 60;
  if (h > 0 && m > 0) return `${h}j ${m}min`;
  if (h > 0) return `${h} jam`;
  return `${m} min`;
}

export default function AdminSchedulePage() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [programs, setPrograms] = useState<Program[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ProgramForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Filters
  const [filterChannel, setFilterChannel] = useState("");
  const [filterDate, setFilterDate] = useState("");
  const [filterStatus, setFilterStatus] = useState("");

  const showToast = (type: "success" | "error", message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 4000);
  };

  const fetchChannels = useCallback(async () => {
    try {
      const res = await fetch("/api/channels?all=true");
      if (res.ok) {
        const data = await res.json();
        setChannels(data.filter((c: Channel) => c.active));
      }
    } catch {
      // ignore
    }
  }, []);

  const fetchPrograms = useCallback(async () => {
    try {
      const params = new URLSearchParams({ all: "true" });
      if (filterChannel) params.set("filterChannel", filterChannel);
      if (filterDate) params.set("filterDate", filterDate);
      if (filterStatus) params.set("filterStatus", filterStatus);

      const res = await fetch(`/api/programs?${params}`);
      if (res.ok) {
        const data = await res.json();
        setPrograms(data);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [filterChannel, filterDate, filterStatus]);

  useEffect(() => {
    fetchChannels();
  }, [fetchChannels]);

  useEffect(() => {
    fetchPrograms();
  }, [fetchPrograms]);

  // Real-time updates via SSE
  useEffect(() => {
    const evtSource = new EventSource("/api/programs/events");
    evtSource.onmessage = () => {
      fetchPrograms();
    };
    evtSource.onerror = () => {
      evtSource.close();
    };
    return () => evtSource.close();
  }, [fetchPrograms]);

  const openAddForm = () => {
    setEditingId(null);
    setForm({ ...emptyForm, date: new Date().toISOString().split("T")[0] });
    setShowForm(true);
  };

  const openEditForm = (program: Program) => {
    setEditingId(program.id);
    setForm({
      channelId: program.channelId,
      title: program.title,
      date: program.date,
      startTime: program.startTime,
      endTime: program.endTime,
      description: program.description || "",
      thumbnail: program.thumbnail || "",
      status: program.status,
    });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.channelId || !form.title || !form.date || !form.startTime || !form.endTime) {
      showToast("error", "Sila isi semua medan wajib.");
      return;
    }

    setSaving(true);
    try {
      const url = editingId ? `/api/programs/${editingId}` : "/api/programs";
      const method = editingId ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      const data = await res.json();

      if (!res.ok) {
        if (data.conflict) {
          showToast("error", data.error);
        } else {
          showToast("error", data.error || "Gagal menyimpan program.");
        }
        return;
      }

      showToast("success", editingId ? "Program berjaya dikemas kini." : "Program berjaya ditambah.");
      setShowForm(false);
      setEditingId(null);
      setForm(emptyForm);
      fetchPrograms();
    } catch {
      showToast("error", "Ralat semasa menyimpan program.");
    } finally {
      setSaving(false);
    }
  };

  const handleDuplicate = async (program: Program) => {
    try {
      const res = await fetch("/api/programs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channelId: program.channelId,
          title: `${program.title} (Salinan)`,
          date: program.date,
          startTime: program.startTime,
          endTime: program.endTime,
          description: program.description,
          thumbnail: program.thumbnail,
          status: "scheduled",
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        showToast("error", data.error || "Gagal menyalin program.");
        return;
      }

      showToast("success", "Program berjaya disalin.");
      fetchPrograms();
    } catch {
      showToast("error", "Ralat semasa menyalin program.");
    }
  };

  const handleDelete = async (id: string) => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/programs/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        showToast("error", data.error || "Gagal memadam program.");
        return;
      }
      showToast("success", "Program berjaya dipadam.");
      setShowDeleteConfirm(null);
      fetchPrograms();
    } catch {
      showToast("error", "Ralat semasa memadam program.");
    } finally {
      setDeleting(false);
    }
  };

  const today = new Date().toISOString().split("T")[0];

  return (
    <div className="space-y-6">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-5 py-3 rounded-xl shadow-2xl text-sm font-medium flex items-center gap-2 ${
          toast.type === "success"
            ? "bg-green-600 text-white"
            : "bg-red-600 text-white"
        }`}>
          {toast.type === "success" ? "✓" : "✕"} {toast.message}
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Jadual Siaran</h1>
          <p className="text-gray-400 text-sm mt-1">Urus jadual siaran program untuk semua saluran.</p>
        </div>
        <button
          onClick={openAddForm}
          className="inline-flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white px-5 py-2.5 rounded-xl text-sm font-medium transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Tambah Program
        </button>
      </div>

      {/* Filters */}
      <div className="bg-gray-900/50 border border-white/10 rounded-xl p-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Saluran</label>
            <select
              value={filterChannel}
              onChange={(e) => setFilterChannel(e.target.value)}
              className="w-full bg-gray-800 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-red-500"
            >
              <option value="">Semua Saluran</option>
              {channels.map((ch) => (
                <option key={ch.id} value={ch.id}>{ch.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Tarikh</label>
            <input
              type="date"
              value={filterDate}
              onChange={(e) => setFilterDate(e.target.value)}
              className="w-full bg-gray-800 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-red-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Status</label>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="w-full bg-gray-800 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-red-500"
            >
              <option value="">Semua Status</option>
              <option value="scheduled">Dijadual</option>
              <option value="live">LIVE</option>
              <option value="finished">Selesai</option>
            </select>
          </div>
        </div>
      </div>

      {/* Programs Table */}
      <div className="bg-gray-900/50 border border-white/10 rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-12 text-center">
            <div className="w-8 h-8 border-2 border-red-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-gray-400 text-sm">Memuatkan jadual...</p>
          </div>
        ) : programs.length === 0 ? (
          <div className="p-12 text-center">
            <div className="w-16 h-16 bg-gray-800 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
            <p className="text-gray-400">Tiada program dijumpai.</p>
            <p className="text-gray-500 text-sm mt-1">Klik &quot;+ Tambah Program&quot; untuk menambah program pertama.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left text-xs text-gray-400 font-medium px-4 py-3">Tarikh</th>
                  <th className="text-left text-xs text-gray-400 font-medium px-4 py-3">Masa</th>
                  <th className="text-left text-xs text-gray-400 font-medium px-4 py-3">Saluran</th>
                  <th className="text-left text-xs text-gray-400 font-medium px-4 py-3">Program</th>
                  <th className="text-left text-xs text-gray-400 font-medium px-4 py-3">Tempoh</th>
                  <th className="text-left text-xs text-gray-400 font-medium px-4 py-3">Status</th>
                  <th className="text-right text-xs text-gray-400 font-medium px-4 py-3">Tindakan</th>
                </tr>
              </thead>
              <tbody>
                {programs.map((program) => {
                  const isLive = program.status === "live" ||
                    (program.date === today &&
                      program.startTime <= new Date().toTimeString().slice(0, 5) &&
                      program.endTime > new Date().toTimeString().slice(0, 5));

                  return (
                    <tr key={program.id} className={`border-b border-white/5 hover:bg-white/5 transition-colors ${
                      isLive ? "bg-green-600/10" : ""
                    }`}>
                      <td className="px-4 py-3 text-sm text-gray-300">{formatDate(program.date)}</td>
                      <td className="px-4 py-3 text-sm text-gray-300 whitespace-nowrap">
                        {program.startTime} - {program.endTime}
                      </td>
                      <td className="px-4 py-3 text-sm text-white font-medium">{program.channel.name}</td>
                      <td className="px-4 py-3">
                        <div className="text-sm text-white font-medium">{program.title}</div>
                        {program.description && (
                          <div className="text-xs text-gray-500 mt-0.5 max-w-xs truncate">{program.description}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-400">
                        {calcDuration(program.startTime, program.endTime)}
                      </td>
                      <td className="px-4 py-3">
                        {isLive ? (
                          <span className="inline-flex items-center gap-1 bg-green-600 text-white text-xs font-medium px-2 py-1 rounded-md">
                            <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
                            LIVE
                          </span>
                        ) : program.status === "finished" ? (
                          <span className="bg-gray-600/80 text-gray-300 text-xs font-medium px-2 py-1 rounded-md">Selesai</span>
                        ) : (
                          <span className="bg-blue-600/80 text-blue-200 text-xs font-medium px-2 py-1 rounded-md">Dijadual</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => openEditForm(program)}
                            className="text-gray-400 hover:text-blue-400 text-xs px-2 py-1 rounded transition-colors"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDuplicate(program)}
                            className="text-gray-400 hover:text-yellow-400 text-xs px-2 py-1 rounded transition-colors"
                          >
                            Salin
                          </button>
                          <button
                            onClick={() => setShowDeleteConfirm(program.id)}
                            className="text-gray-400 hover:text-red-400 text-xs px-2 py-1 rounded transition-colors"
                          >
                            Padam
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add/Edit Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-white/10 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-white/10">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-white">
                  {editingId ? "Edit Program" : "Tambah Program"}
                </h2>
                <button
                  onClick={() => { setShowForm(false); setEditingId(null); setForm(emptyForm); }}
                  className="text-gray-400 hover:text-white p-2"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="p-6 space-y-5">
              {/* Title */}
              <div>
                <label className="block text-sm text-gray-300 mb-1.5">Tajuk Program *</label>
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="Contoh: Berita Tengah Hari"
                  className="w-full bg-gray-800 border border-white/10 rounded-lg px-4 py-2.5 text-white text-sm focus:outline-none focus:border-red-500 placeholder-gray-500"
                />
              </div>

              {/* Channel */}
              <div>
                <label className="block text-sm text-gray-300 mb-1.5">Saluran *</label>
                <select
                  value={form.channelId}
                  onChange={(e) => setForm({ ...form, channelId: e.target.value })}
                  className="w-full bg-gray-800 border border-white/10 rounded-lg px-4 py-2.5 text-white text-sm focus:outline-none focus:border-red-500"
                >
                  <option value="">Pilih Saluran</option>
                  {channels.map((ch) => (
                    <option key={ch.id} value={ch.id}>{ch.name}</option>
                  ))}
                </select>
              </div>

              {/* Date + Status */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-300 mb-1.5">Tarikh *</label>
                  <input
                    type="date"
                    value={form.date}
                    onChange={(e) => setForm({ ...form, date: e.target.value })}
                    className="w-full bg-gray-800 border border-white/10 rounded-lg px-4 py-2.5 text-white text-sm focus:outline-none focus:border-red-500"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-300 mb-1.5">Status</label>
                  <select
                    value={form.status}
                    onChange={(e) => setForm({ ...form, status: e.target.value })}
                    className="w-full bg-gray-800 border border-white/10 rounded-lg px-4 py-2.5 text-white text-sm focus:outline-none focus:border-red-500"
                  >
                    <option value="scheduled">Dijadual</option>
                    <option value="live">LIVE</option>
                    <option value="finished">Selesai</option>
                  </select>
                </div>
              </div>

              {/* Start + End Time */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-300 mb-1.5">Masa Mula *</label>
                  <input
                    type="time"
                    value={form.startTime}
                    onChange={(e) => setForm({ ...form, startTime: e.target.value })}
                    className="w-full bg-gray-800 border border-white/10 rounded-lg px-4 py-2.5 text-white text-sm focus:outline-none focus:border-red-500"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-300 mb-1.5">Masa Tamat *</label>
                  <input
                    type="time"
                    value={form.endTime}
                    onChange={(e) => setForm({ ...form, endTime: e.target.value })}
                    className="w-full bg-gray-800 border border-white/10 rounded-lg px-4 py-2.5 text-white text-sm focus:outline-none focus:border-red-500"
                  />
                </div>
              </div>

              {/* Duration preview */}
              {form.startTime && form.endTime && (
                <div className="bg-gray-800/50 rounded-lg px-4 py-2 text-sm text-gray-400">
                  Tempoh: <span className="text-white font-medium">{calcDuration(form.startTime, form.endTime)}</span>
                </div>
              )}

              {/* Description */}
              <div>
                <label className="block text-sm text-gray-300 mb-1.5">Penerangan</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Penerangan program (pilihan)"
                  rows={3}
                  className="w-full bg-gray-800 border border-white/10 rounded-lg px-4 py-2.5 text-white text-sm focus:outline-none focus:border-red-500 placeholder-gray-500 resize-none"
                />
              </div>

              {/* Thumbnail URL */}
              <div>
                <label className="block text-sm text-gray-300 mb-1.5">URL Thumbnail</label>
                <input
                  type="text"
                  value={form.thumbnail}
                  onChange={(e) => setForm({ ...form, thumbnail: e.target.value })}
                  placeholder="https://... (pilihan)"
                  className="w-full bg-gray-800 border border-white/10 rounded-lg px-4 py-2.5 text-white text-sm focus:outline-none focus:border-red-500 placeholder-gray-500"
                />
              </div>
            </div>

            <div className="p-6 border-t border-white/10 flex items-center justify-end gap-3">
              <button
                onClick={() => { setShowForm(false); setEditingId(null); setForm(emptyForm); }}
                className="px-5 py-2.5 bg-white/10 hover:bg-white/20 text-white rounded-xl text-sm font-medium transition-colors"
              >
                Batal
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !form.title || !form.channelId || !form.date || !form.startTime || !form.endTime}
                className="px-6 py-2.5 bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl text-sm font-medium transition-colors"
              >
                {saving ? "Menyimpan..." : editingId ? "Kemas Kini" : "Simpan"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-white/10 rounded-2xl w-full max-w-md p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-red-600/20 rounded-full flex items-center justify-center">
                <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <h3 className="text-lg font-bold text-white">Padam Program</h3>
            </div>
            <p className="text-gray-300 text-sm mb-6">
              Adakah anda pasti mahu memadamkan program ini? Tindakan ini tidak boleh dibatalkan.
            </p>
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => setShowDeleteConfirm(null)}
                className="px-5 py-2.5 bg-white/10 hover:bg-white/20 text-white rounded-xl text-sm font-medium transition-colors"
              >
                Batal
              </button>
              <button
                onClick={() => handleDelete(showDeleteConfirm)}
                disabled={deleting}
                className="px-6 py-2.5 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded-xl text-sm font-medium transition-colors"
              >
                {deleting ? "Memadam..." : "Padam"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
