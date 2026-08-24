"use client";

import { useState, useEffect } from "react";
import { useLanguage } from "@/components/LanguageProvider";

export default function SubscribeSection() {
  const { t } = useLanguage();
  const [email, setEmail] = useState("");
  const [subscriberCount, setSubscriberCount] = useState(0);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [showForm, setShowForm] = useState(false);

  // Fetch subscriber count on mount
  useEffect(() => {
    fetchSubscriberCount();
  }, []);

  const fetchSubscriberCount = async () => {
    try {
      const res = await fetch("/api/subscribe");
      if (res.ok) {
        const data = await res.json();
        setSubscriberCount(data.count);
      }
    } catch {
      // Ignore error - keep default count
    }
  };

  const handleSubscribe = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;

    setLoading(true);
    setMessage("");

    try {
      const res = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      const data = await res.json();

      if (res.ok) {
        setIsSubscribed(true);
        setSubscriberCount(data.count);
        setMessage(t("subscribe_success"));
        setEmail("");
        setShowForm(false);
      } else {
        setMessage(data.error || t("subscribe_error"));
      }
    } catch {
      setMessage(t("subscribe_error"));
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

          {/* Subscribe Form / Button */}
          {!showForm ? (
            <div className="text-center">
              <button
                onClick={() => setShowForm(true)}
                className="bg-red-600 hover:bg-red-700 text-white px-6 sm:px-8 py-3 sm:py-4 rounded-xl font-bold text-sm sm:text-base transition-all transform hover:scale-105 flex items-center gap-2 mx-auto"
              >
                <span>✨</span>
                {t("subscribe_button")}
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubscribe} className="max-w-md mx-auto">
              <div className="flex flex-col sm:flex-row gap-3">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t("subscribe_email_placeholder")}
                  required
                  className="flex-1 bg-gray-800 border border-gray-700 text-white px-4 py-3 rounded-xl focus:outline-none focus:border-red-500 transition-colors"
                />
                <button
                  type="submit"
                  disabled={loading}
                  className="bg-red-600 hover:bg-red-700 disabled:bg-red-800 disabled:cursor-not-allowed text-white px-6 py-3 rounded-xl font-bold text-sm transition-colors flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <>
                      <span>✨</span>
                      {t("subscribe_button")}
                    </>
                  )}
                </button>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowForm(false);
                  setMessage("");
                }}
                className="text-gray-500 text-sm mt-3 hover:text-gray-400 transition-colors"
              >
                {t("subscribe_cancel")}
              </button>
            </form>
          )}

          {/* Message */}
          {message && (
            <div
              className={`mt-4 text-center text-sm font-medium ${
                isSubscribed ? "text-green-400" : "text-red-400"
              }`}
            >
              {message}
            </div>
          )}

          {/* Already Subscribed State */}
          {isSubscribed && (
            <div className="mt-4 text-center">
              <span className="inline-flex items-center gap-2 bg-green-600/20 text-green-400 px-4 py-2 rounded-full text-sm font-medium">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                {t("subscribe_already")}
              </span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
