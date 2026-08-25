"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

interface Radio {
  id: string;
  name: string;
  description: string | null;
  streamUrl: string;
  thumbnail: string | null;
  category: string;
  enabled: boolean;
  displayOrder: number;
  createdAt: string;
}

export default function AdminRadios() {
  const router = useRouter();
  const [radios, setRadios] = useState<Radio[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchRadios();
  }, []);

  const fetchRadios = async () => {
    try {
      const res = await fetch("/api/radios");
      const data = await res.json();
      setRadios(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  const handleToggle = async (radio: Radio) => {
    try {
      const res = await fetch(`/api/radios/${radio.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !radio.enabled }),
      });
      if (res.ok) {
        setRadios((prev) =>
          prev.map((r) => (r.id === radio.id ? { ...r, enabled: !r.enabled } : r))
        );
      }
    } catch {
      // ignore
    }
  };

  const handleDelete = async (radio: Radio) => {
    if (!confirm("Adakah anda pasti mahu memadam radio ini?")) return;
    try {
      const res = await fetch(`/api/radios/${radio.id}`, { method: "DELETE" });
      if (res.ok) {
        setRadios((prev) => prev.filter((r) => r.id !== radio.id));
      }
    } catch {
      // ignore
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-white text-2xl font-bold">Pengurusan Radio</h1>
          <p className="text-gray-400 mt-1">Urus stesen radio</p>
        </div>
        <button
          onClick={() => router.push("/admin/radios/new")}
          className="admin-btn admin-btn-primary flex items-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Tambah Radio
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <div className="w-10 h-10 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : radios.length === 0 ? (
        <div className="text-center py-20">
          <p className="text-gray-500">Tiada radio lagi. Klik &quot;Tambah Radio&quot; untuk bermula.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {radios.map((radio) => (
            <div
              key={radio.id}
              className={`bg-gray-900 border rounded-xl p-4 flex items-center gap-4 ${
                radio.enabled ? "border-white/10" : "border-white/5 opacity-60"
              }`}
            >
              {/* Thumbnail */}
              {radio.thumbnail ? (
                <img
                  src={radio.thumbnail}
                  alt={radio.name}
                  className="w-16 h-16 rounded-lg object-cover flex-shrink-0"
                />
              ) : (
                <div className="w-16 h-16 bg-gray-800 rounded-lg flex items-center justify-center flex-shrink-0">
                  <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2z" />
                  </svg>
                </div>
              )}

              {/* Info */}
              <div className="flex-1 min-w-0">
                <h3 className="text-white font-semibold text-sm truncate">{radio.name}</h3>
                <p className="text-gray-500 text-xs mt-0.5 truncate">{radio.streamUrl}</p>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-gray-600 text-[10px]">{radio.category}</span>
                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                    radio.enabled ? "bg-green-600/10 text-green-400" : "bg-gray-600/10 text-gray-500"
                  }`}>
                    {radio.enabled ? "Aktif" : "Dinyahaktifkan"}
                  </span>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => handleToggle(radio)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    radio.enabled
                      ? "bg-yellow-600/10 text-yellow-400 hover:bg-yellow-600/20"
                      : "bg-green-600/10 text-green-400 hover:bg-green-600/20"
                  }`}
                >
                  {radio.enabled ? "Nyahaktif" : "Aktifkan"}
                </button>
                <button
                  onClick={() => router.push(`/admin/radios/edit/${radio.id}`)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-600/10 text-blue-400 hover:bg-blue-600/20 transition-colors"
                >
                  Sunting
                </button>
                <button
                  onClick={() => handleDelete(radio)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-red-600/10 text-red-400 hover:bg-red-600/20 transition-colors"
                >
                  Padam
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
