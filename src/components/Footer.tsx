"use client";

import { useEffect, useState } from "react";
import { useLanguage } from "@/components/LanguageProvider";

interface Settings {
  footer_text?: string;
  contact_email?: string;
  social_facebook?: string;
  social_twitter?: string;
  social_youtube?: string;
  social_instagram?: string;
  social_tiktok?: string;
}

export default function Footer() {
  const [settings, setSettings] = useState<Settings>({});
  const { t } = useLanguage();

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => setSettings(data))
      .catch(() => {});
  }, []);

  const socialLinks = [
    { key: "social_facebook", label: "Facebook", icon: "M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" },
    { key: "social_twitter", label: "Twitter", icon: "M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" },
    { key: "social_youtube", label: "YouTube", icon: "M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" },
    { key: "social_instagram", label: "Instagram", icon: "M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" },
    { key: "social_tiktok", label: "TikTok", icon: "M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z" },
  ];

  return (
    <footer className="bg-black/80 border-t border-white/10 mt-12 sm:mt-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6 sm:gap-8">
          {/* Brand */}
          <div>
            <div className="flex items-center gap-2.5 mb-3 sm:mb-4">
              <div className="w-7 h-7 sm:w-8 sm:h-8 bg-gradient-to-br from-red-600 to-red-800 rounded-lg flex items-center justify-center text-white font-bold text-xs sm:text-sm">
                MS
              </div>
              <span className="text-white font-bold text-base sm:text-lg">eBilikAgamaTV</span>
            </div>
            <p className="text-gray-400 text-xs sm:text-sm">
              {settings.footer_text || t("copyright")}
            </p>
          </div>

          {/* Contact */}
          <div>
            <h3 className="text-white font-semibold mb-3 sm:mb-4 text-sm sm:text-base">{t("contact_us")}</h3>
            {settings.contact_email ? (
              <a
                href={`mailto:${settings.contact_email}`}
                className="text-gray-400 hover:text-white transition-colors text-xs sm:text-sm"
              >
                {settings.contact_email}
              </a>
            ) : (
              <p className="text-gray-500 text-xs sm:text-sm">{t("no_contact")}</p>
            )}
          </div>

          {/* Social Links */}
          <div>
            <h3 className="text-white font-semibold mb-3 sm:mb-4 text-sm sm:text-base">{t("follow_us")}</h3>
            <div className="flex gap-2.5 sm:gap-3">
              {socialLinks.map((social) => {
                const url = settings[social.key as keyof Settings];
                if (!url) return null;
                return (
                  <a
                    key={social.key}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-9 h-9 sm:w-10 sm:h-10 bg-white/10 hover:bg-white/20 rounded-lg flex items-center justify-center transition-colors"
                    aria-label={social.label}
                  >
                    <svg className="w-4 h-4 sm:w-5 sm:h-5 text-gray-300" fill="currentColor" viewBox="0 0 24 24">
                      <path d={social.icon} />
                    </svg>
                  </a>
                );
              })}
              {!Object.values(settings).some((v) => v && typeof v === "string" && v.startsWith("http")) && (
                <p className="text-gray-500 text-xs sm:text-sm">{t("no_social")}</p>
              )}
            </div>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="mt-8 sm:mt-10 pt-5 sm:pt-6 border-t border-white/5 flex flex-col sm:flex-row items-center justify-between gap-2 sm:gap-3">
          <p className="text-gray-600 text-[11px] sm:text-xs">
            {settings.footer_text || t("copyright")}
          </p>
          <a
            href="/admin/login"
            className="inline-flex items-center gap-1.5 bg-white/5 hover:bg-white/10 border border-white/10 text-gray-400 hover:text-gray-200 text-[11px] sm:text-xs font-medium px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-lg transition-all"
            title="Admin"
          >
            <svg className="w-3 h-3 sm:w-3.5 sm:h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Admin
          </a>
        </div>
      </div>
    </footer>
  );
}
