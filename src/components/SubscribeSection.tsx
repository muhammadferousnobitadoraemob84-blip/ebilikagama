"use client";

import { useState, useEffect } from "react";
import { useLanguage } from "@/components/LanguageProvider";

export default function SubscribeSection() {
  const { t } = useLanguage();
  const [subscriberCount, setSubscriberCount] = useState(0);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);

  // Fetch subscriber count and subscription status on mount
  useEffect(() => {
    checkSubscriptionStatus();
  }, []);

  const checkSubscriptionStatus = async () => {
    try {
      const res = await fetch("/api/subscribe");
      if (res.ok) {
        const data = await res.json();
        setSubscriberCount(data.count);
        setIsSubscribed(data.isSubscribed);
      }
    } catch {
      // Ignore error - keep defaults
    } finally {
      setInitialLoading(false);
    }
  };

  const handleSubscribe = async () => {
    if (loading || isSubscribed) return;

    setLoading(true);

    try {
      const res = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      const data = await res.json();

      if (res.ok) {
        setIsSubscribed(true);
        setSubscriberCount(data.count);
      }
    } catch {
      // Silently fail - user can try again
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="py-12 sm:py-16 bg-gradient-to-b from-gray-900 to-black">
      <div className="max-w-4xl mx-auto px-4 sm:px-6">
        <div className="bg-gradient-to-br from-red-900/30 to-gray-900 rounded-2xl p-6 sm:p-8 border border-red-500/20">
          {/* Header */}
          <div className="text-center mb-6">
            <div className="inline-flex items-center gap-2 bg-red-600/20 text-red-400 px-3 py-1.5 rounded-full text-xs font-medium mb-4">
              <span className="text-base">📺</span>
              {t("subscribe_badge")}
            </div>
            <h2 className="text-white text-xl sm:text-2xl font-bold mb-3">
              {t("subscribe_title")}
            </h2>
            <p className="text-gray-400 text-sm sm:text-base max-w-lg mx-auto">
              {t("subscribe_description")}
            </p>
          </div>

          {/* Subscriber Count */}
          <div className="text-center mb-6">
            <span className="text-3xl sm:text-4xl font-bold text-white">
              {subscriberCount.toLocaleString()}
            </span>
            <span className="text-gray-400 text-sm sm:text-base ml-2">
              {t("subscribe_count_label")}
            </span>
          </div>

          {/* Subscribe Button */}
          <div className="text-center">
            {initialLoading ? (
              <div className="inline-flex items-center gap-2 bg-gray-700 text-gray-300 px-6 sm:px-8 py-3 sm:py-4 rounded-xl font-bold text-sm sm:text-base">
                <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
                Loading...
              </div>
            ) : isSubscribed ? (
              <div className="inline-flex items-center gap-2 bg-green-600/20 text-green-400 px-6 sm:px-8 py-3 sm:py-4 rounded-xl font-bold text-sm sm:text-base border border-green-500/30">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                {t("subscribe_already")}
              </div>
            ) : (
              <button
                onClick={handleSubscribe}
                disabled={loading}
                className="bg-red-600 hover:bg-red-700 disabled:bg-red-800 disabled:cursor-not-allowed text-white px-6 sm:px-8 py-3 sm:py-4 rounded-xl font-bold text-sm sm:text-base transition-all transform hover:scale-105 flex items-center gap-2 mx-auto"
              >
                {loading ? (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <span>✨</span>
                )}
                {t("subscribe_button")}
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
