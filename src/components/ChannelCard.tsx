"use client";

import Link from "next/link";

interface Channel {
  id: string;
  name: string;
  twitchUsername: string;
  thumbnail: string | null;
  description: string | null;
  liveStatus: string;
}

export default function ChannelCard({ channel }: { channel: Channel }) {
  const isLive = channel.liveStatus === "live";

  return (
    <Link
      href={`/channels/${channel.id}`}
      className="group block relative overflow-hidden rounded-xl bg-gray-900 border border-white/5 hover:border-white/20 transition-all duration-300 hover:shadow-2xl hover:shadow-red-500/10"
    >
      {/* Thumbnail */}
      <div className="relative aspect-video overflow-hidden">
        {channel.thumbnail ? (
          <img
            src={channel.thumbnail}
            alt={channel.name}
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-gray-800 to-gray-900 flex items-center justify-center">
            <svg className="w-12 h-12 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          </div>
        )}

        {/* LIVE Badge */}
        {isLive && (
          <div className="absolute top-3 left-3 bg-red-600 text-white text-xs font-bold px-2.5 py-1 rounded-md flex items-center gap-1.5 shadow-lg">
            <span className="w-2 h-2 bg-white rounded-full animate-pulse" />
            LIVE
          </div>
        )}

        {/* Offline Badge */}
        {!isLive && (
          <div className="absolute top-3 left-3 bg-gray-600/80 text-gray-200 text-xs font-medium px-2.5 py-1 rounded-md">
            OFFLINE
          </div>
        )}

        {/* Hover Overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-end p-4">
          <span className="text-white text-sm font-medium bg-red-600 px-3 py-1.5 rounded-lg transform translate-y-2 group-hover:translate-y-0 transition-transform duration-300">
            Tonton Sekarang →
          </span>
        </div>
      </div>

      {/* Channel Info */}
      <div className="p-3">
        <h3 className="text-white font-semibold text-sm truncate group-hover:text-red-400 transition-colors">
          {channel.name}
        </h3>
        {channel.description && (
          <p className="text-gray-500 text-xs mt-1 line-clamp-1">
            {channel.description}
          </p>
        )}
      </div>
    </Link>
  );
}
