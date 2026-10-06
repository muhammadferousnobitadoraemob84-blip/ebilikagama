"use client";

// My Favorites (spec §15) — channels / radio / replay / quran the user has
// favorited. Identity is server-derived; this page only renders.

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useLanguage } from "@/components/LanguageProvider";

interface Item {
  id: string;
  itemType: string;
  itemId: string;
  title: string | null;
  href: string | null;
}

const TYPE_LABEL: Record<string, string> = {
  channel: "fav_tv",
  radio: "fav_radio",
  replay: "fav_replay",
  quran: "fav_quran",
};

export default function FavoritesPage() {
  const { t } = useLanguage();
  const vr = t as unknown as (key: string) => string;
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [authed, setAuthed] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/favorites", { cache: "no-store" });
      if (res.status === 401) {
        setAuthed(false);
        return;
      }
      if (res.ok) {
        const d = await res.json();
        setItems(d.items ?? []);
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

  const remove = async (itemType: string, itemId: string) => {
    try {
      await fetch("/api/favorites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemType, itemId }),
      });
      load();
    } catch {
      // transient
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

  const grouped: Record<string, Item[]> = {};
  for (const it of items) (grouped[it.itemType] ??= []).push(it);

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-5">
      <h1 className="text-white text-2xl font-bold">{vr("fav_title")}</h1>

      {items.length === 0 && (
        <div className="bg-gray-900 border border-white/10 rounded-2xl p-8 text-center">
          <p className="text-gray-400 text-sm">{vr("fav_empty")}</p>
          <p className="text-gray-600 text-xs mt-1">{vr("fav_empty_hint")}</p>
        </div>
      )}

      {Object.entries(grouped).map(([type, list]) => (
        <div key={type} className="bg-gray-900 border border-white/10 rounded-2xl p-5">
          <h2 className="text-white font-semibold text-sm mb-3">{vr(TYPE_LABEL[type] ?? type)}</h2>
          <ul className="space-y-2">
            {list.map((it) => (
              <li key={it.id} className="flex items-center gap-3 bg-gray-900/60 border border-white/10 rounded-xl px-3 py-2.5">
                <a href={it.href ?? "#"} className="text-white text-sm font-medium hover:text-red-400 transition-colors flex-1 min-w-0 truncate">
                  {it.title ?? it.itemId}
                </a>
                <button
                  onClick={() => remove(it.itemType, it.itemId)}
                  className="text-gray-500 hover:text-red-400 text-xs px-2 py-1 flex-shrink-0"
                  aria-label={vr("fav_remove")}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
