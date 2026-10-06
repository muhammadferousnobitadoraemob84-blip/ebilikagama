"use client";

// Connection Recovery banner (spec §18). Shows "Connection lost / Trying to
// reconnect…" while offline and "Connection restored" briefly after recovery.
// Renders nothing while healthy, so existing pages are visually untouched.

import { useEffect, useState } from "react";
import { useLanguage } from "@/components/LanguageProvider";
import { useConnectionStatus } from "@/lib/connection";

export default function ConnectionBanner() {
  const { t } = useLanguage();
  const vr = t as unknown as (key: string) => string;
  const status = useConnectionStatus();
  const [showRestored, setShowRestored] = useState(false);

  useEffect(() => {
    if (status === "reconnecting") {
      setShowRestored(true);
      const timer = setTimeout(() => setShowRestored(false), 2500);
      return () => clearTimeout(timer);
    }
  }, [status]);

  if (status === "online") return null;

  return (
    <div
      role="status"
      className={`fixed bottom-4 left-1/2 -translate-x-1/2 z-[90] px-4 py-2.5 rounded-xl shadow-2xl border text-sm font-medium flex items-center gap-2.5 backdrop-blur-md ${
        status === "offline"
          ? "bg-red-950/90 border-red-600/40 text-red-200"
          : showRestored
            ? "bg-green-950/90 border-green-600/40 text-green-200"
            : "hidden"
      }`}
    >
      {status === "offline" ? (
        <>
          <span className="w-2 h-2 bg-red-400 rounded-full animate-pulse flex-shrink-0" />
          {vr("conn_lost")} <span className="text-red-300/70">{vr("conn_trying")}</span>
        </>
      ) : (
        <>
          <span className="w-2 h-2 bg-green-400 rounded-full flex-shrink-0" />
          {vr("conn_restored")}
        </>
      )}
    </div>
  );
}
