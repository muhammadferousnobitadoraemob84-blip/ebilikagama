"use client";

import ChannelCard from "./ChannelCard";

interface Channel {
  id: string;
  name: string;
  twitchUsername: string;
  thumbnail: string | null;
  description: string | null;
  liveStatus: string;
  displayOrder: number;
}

interface ChannelSectionProps {
  title: string;
  channels: Channel[];
  id?: string;
}

export default function ChannelSection({ title, channels, id }: ChannelSectionProps) {
  if (channels.length === 0) return null;

  return (
    <section id={id} className="py-6 sm:py-8">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
        {/* Section Title */}
        <div className="flex items-center gap-2.5 sm:gap-3 mb-4 sm:mb-6">
          <div className="w-1 h-6 sm:h-8 bg-red-600 rounded-full" />
          <h2 className="text-white text-lg sm:text-xl md:text-2xl font-bold tracking-tight">
            {title}
          </h2>
          <div className="flex-1 h-px bg-gradient-to-r from-white/10 to-transparent ml-3 sm:ml-4" />
        </div>

        {/* Channel Grid — 2 cols on mobile, expanding on larger screens */}
        <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2.5 sm:gap-4">
          {channels.map((channel) => (
            <ChannelCard key={channel.id} channel={channel} />
          ))}
        </div>
      </div>
    </section>
  );
}
