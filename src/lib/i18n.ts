export type Language = "en" | "bm" | "zh";

export interface LanguageOption {
  code: Language;
  label: string;
  flag: string;
}

export const LANGUAGES: LanguageOption[] = [
  { code: "en", label: "English", flag: "🇬🇧" },
  { code: "bm", label: "Bahasa Melayu", flag: "🇲🇾" },
  { code: "zh", label: "中文", flag: "🇨🇳" },
];

export const DEFAULT_LANGUAGE: Language = "en";

export type TranslationKey = keyof typeof translations.en;

const translations = {
  en: {
    // Header
    nav_home: "Home",
    nav_saluran_tv: "TV Channels",
    nav_saluran_khas: "Special Channels",
    nav_schedule: "Schedule",
    nav_admin: "Admin",
    lang_selector_label: "Language",

    // Hero
    hero_badge: "Live Broadcast",
    hero_cta: "Start Watching",

    // Home
    hero_title_fallback: "eBilikAgamaTV",
    hero_desc_fallback: "Islamic media platform developed by the Islamic Affairs Unit of SMJK Chung Hwa Tenom to expand Islamic dakwah among students and parents.",
    saluran_tv_title: "TV Channels",
    saluran_khas_title: "Special Channels",
    no_channels: "No channels available at the moment.",
    load_channels_error: "Failed to load channels",
    load_channels_error_desc: "Please check your internet connection and try again.",
    try_again: "Try Again",

    // Channel Card
    watch_now: "Watch Now →",
    live: "LIVE",
    offline: "OFFLINE",
    status_online: "ONLINE",
    status_offline: "OFFLINE",
    checking_status: "Checking...",

    // Channel Page
    loading_channel: "Loading channel...",
    channel_not_found: "Channel not found",
    channel_not_found_desc: "The channel you're looking for doesn't exist or has been deleted.",
    back_to_channels: "← Back to Channel List",
    back: "Back",
    schedule_title: "Program Schedule",

    // Schedule
    today: "Today",
    loading_schedule: "Loading schedule...",
    no_programs: "No programs for this date.",
    now_playing: "Now Playing",

    // Footer
    copyright: "© 2026 eBilikAgamaTV. All rights reserved.",
    contact_us: "Contact Us",
    no_contact: "No contact information",
    follow_us: "Follow Us",
    no_social: "No social media links",
  },

  bm: {
    // Header
    nav_home: "Utama",
    nav_saluran_tv: "Saluran TV",
    nav_saluran_khas: "Saluran Khas",
    nav_schedule: "Jadual",
    nav_admin: "Admin",
    lang_selector_label: "Bahasa",

    // Hero
    hero_badge: "Siaran Langsung",
    hero_cta: "Mula Menonton",

    // Home
    hero_title_fallback: "eBilikAgamaTV",
    hero_desc_fallback: "Media Bilik Agama™ yang dibangunkan oleh Unit Hal Ehwal Islam SMJK Chung Hwa Tenom untuk memperluas dakwah Islam dikalangan murid dan ibu bapa.",
    saluran_tv_title: "Saluran TV",
    saluran_khas_title: "Saluran Khas",
    no_channels: "Tiada saluran tersedia buat masa ini.",
    load_channels_error: "Gagal memuatkan saluran",
    load_channels_error_desc: "Sila semak sambungan internet anda dan cuba lagi.",
    try_again: "Cuba Semula",

    // Channel Card
    watch_now: "Tonton Sekarang →",
    live: "LIVE",
    offline: "OFFLINE",
    status_online: "DALAM TALIAN",
    status_offline: "LUAR TALIAN",
    checking_status: "Menyemak...",

    // Channel Page
    loading_channel: "Memuatkan saluran...",
    channel_not_found: "Saluran tidak dijumpai",
    channel_not_found_desc: "Saluran yang anda cari tidak wujud atau telah dipadam.",
    back_to_channels: "← Kembali ke Senarai Saluran",
    back: "Kembali",
    schedule_title: "Jadual Siaran",

    // Schedule
    today: "Hari Ini",
    loading_schedule: "Memuatkan jadual...",
    no_programs: "Tiada program untuk tarikh ini.",
    now_playing: "Sedang Bersiaran",

    // Footer
    copyright: "© 2026 eBilikAgamaTV. Hak cipta terpelihara.",
    contact_us: "Hubungi Kami",
    no_contact: "Tiada maklumat hubungan",
    follow_us: "Ikuti Kami",
    no_social: "Tiada pautan media sosial",
  },

  zh: {
    // Header
    nav_home: "首页",
    nav_saluran_tv: "电视频道",
    nav_saluran_khas: "特别频道",
    nav_schedule: "节目表",
    nav_admin: "管理",
    lang_selector_label: "语言",

    // Hero
    hero_badge: "直播中",
    hero_cta: "开始观看",

    // Home
    hero_title_fallback: "eBilikAgamaTV",
    hero_desc_fallback: "由 SMJK Chung Hwa Tenom 伊斯兰事务部开发的伊斯兰媒体平台，旨在扩大学生和家长之间的伊斯兰宣教。",
    saluran_tv_title: "电视频道",
    saluran_khas_title: "特别频道",
    no_channels: "目前暂无可用频道。",
    load_channels_error: "加载频道失败",
    load_channels_error_desc: "请检查您的互联网连接并重试。",
    try_again: "重试",

    // Channel Card
    watch_now: "立即观看 →",
    live: "直播中",
    offline: "离线",
    status_online: "在线",
    status_offline: "离线",
    checking_status: "检查中...",

    // Channel Page
    loading_channel: "加载频道中...",
    channel_not_found: "频道未找到",
    channel_not_found_desc: "您查找的频道不存在或已被删除。",
    back_to_channels: "← 返回频道列表",
    back: "返回",
    schedule_title: "节目时间表",

    // Schedule
    today: "今天",
    loading_schedule: "加载时间表中...",
    no_programs: "该日期暂无节目。",
    now_playing: "正在播出",

    // Footer
    copyright: "© 2026 eBilikAgamaTV. 版权所有。",
    contact_us: "联系我们",
    no_contact: "暂无联系方式",
    follow_us: "关注我们",
    no_social: "暂无社交媒体链接",
  },
} as const;

export function t(key: TranslationKey, lang: Language): string {
  return translations[lang]?.[key] || translations.en[key] || key;
}

export function getLocaleCode(lang: Language): string {
  switch (lang) {
    case "en":
      return "en-US";
    case "bm":
      return "ms-MY";
    case "zh":
      return "zh-CN";
  }
}
