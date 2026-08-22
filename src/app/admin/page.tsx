"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Channel {
  id: string;
  name: string;
  category: string;
  active: boolean;
  liveStatus: string;
}

interface Stats {
  total: number;
  saluranTV: number;
  saluranKhas: number;
  live: number;
  offline: number;
  active: number;
}

export default function AdminDashboard() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [stats, setStats] = useState<Stats>({
    total: 0,
    saluranTV: 0,
    saluranKhas: 0,
    live: 0,
    offline: 0,
    active: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Fetch all channels (including inactive) for admin
    fetch("/api/channels")
      .then((r) => r.json())
      .then((data) => {
        setChannels(data);
        setStats({
          total: data.length,
          saluranTV: data.filter((c: Channel) => c.category === "saluran-tv").length,
          saluranKhas: data.filter((c: Channel) => c.category === "saluran-khas").length,
          live: data.filter((c: Channel) => c.liveStatus === "live").length,
          offline: data.filter((c: Channel) => c.liveStatus !== "live").length,
          active: data.filter((c: Channel) => c.active).length,
        });
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-10 h-10 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const statCards = [
    {
      label: "Jumlah Saluran",
      value: stats.total,
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
        </svg>
      ),
      color: "from-blue-500 to-blue-600",
    },
    {
      label: "Saluran TV",
      value: stats.saluranTV,
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
      ),
      color: "from-green-500 to-green-600",
    },
    {
      label: "Saluran Khas",
      value: stats.saluranKhas,
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
        </svg>
      ),
      color: "from-purple-500 to-purple-600",
    },
    {
      label: "Sedang LIVE",
      value: stats.live,
      icon: (
        <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
          <path d="M8 5v14l11-7z" />
        </svg>
      ),
      color: "from-red-500 to-red-600",
    },
    {
      label: "Offline",
      value: stats.offline,
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
        </svg>
      ),
      color: "from-gray-500 to-gray-600",
    },
    {
      label: "Aktif",
      value: stats.active,
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
      color: "from-emerald-500 to-emerald-600",
    },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-white text-2xl font-bold">Dashboard</h1>
          <p className="text-gray-400 mt-1">Ringkasan kandungan laman</p>
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

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        {statCards.map((stat) => (
          <div
            key={stat.label}
            className="admin-card flex items-center gap-4"
          >
            <div className={`w-12 h-12 bg-gradient-to-br ${stat.color} rounded-xl flex items-center justify-center text-white flex-shrink-0`}>
              {stat.icon}
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{stat.value}</p>
              <p className="text-gray-400 text-sm">{stat.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Quick Links */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Link
          href="/admin/channels"
          className="admin-card hover:border-white/20 transition-colors group"
        >
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-white font-semibold group-hover:text-red-400 transition-colors">
                Pengurusan Saluran
              </h3>
              <p className="text-gray-400 text-sm mt-1">
                Tambah, sunting, padam, dan susun saluran
              </p>
            </div>
            <svg className="w-5 h-5 text-gray-500 group-hover:text-red-400 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </div>
        </Link>

        <Link
          href="/admin/settings"
          className="admin-card hover:border-white/20 transition-colors group"
        >
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-white font-semibold group-hover:text-red-400 transition-colors">
                Tetapan Laman
              </h3>
              <p className="text-gray-400 text-sm mt-1">
                Logo, hero, tajuk, footer, media sosial
              </p>
            </div>
            <svg className="w-5 h-5 text-gray-500 group-hover:text-red-400 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </div>
        </Link>
      </div>
    </div>
  );
}
