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
    nav_radio: "Radio",
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
    loading: "Loading...",
    loading_channel: "Loading channel...",
    channel_not_found: "Channel not found",
    channel_not_found_desc: "The channel you're looking for doesn't exist or has been deleted.",
    back_to_channels: "← Back to Channel List",
    back: "Back",
    schedule_title: "TV Schedule",
    view_full_schedule: "View Full Schedule",
    no_program_available: "No program available.",
    next: "NEXT",
    program_guide: "Program Guide",
    on_air: "ON AIR",
    upcoming: "UPCOMING",

    // Schedule / EPG
    today: "Today",
    loading_schedule: "Loading schedule...",
    no_programs: "No programs for this date.",
    now_playing: "NOW PLAYING",
    epg_date: "Date",
    epg_channel: "Channel",
    epg_start: "Start",
    epg_end: "End",
    epg_duration: "Duration",
    epg_description: "Description",
    epg_close: "Close",

    // Subscribe
    subscribe_badge: "FREE SUBSCRIPTION",
    subscribe_title: "Don't Miss What's Happening on Bilik Agama! 📺",
    subscribe_description: "Subscribe for free to stay updated with our live broadcasts, programs and latest eBilikAgamaTV content.",
    subscribe_button: "SUBSCRIBE FOR FREE",
    subscribe_count_label: "subscribers",
    subscribe_success: "Successfully subscribed!",
    subscribe_error: "Subscription failed. Please try again.",
    subscribe_already: "SUBSCRIBED",

    // Live Replay
    live_replay_title: "Live Replay",
    live_replay_description: "Watch recordings of our live broadcasts.",
    replay_not_found: "Replay not found",

    // Radio
    radio_title: "Radio eBilikAgama",
    radio_subtitle: "Listen to live radio broadcasts.",
    radio_listen: "Listen Now",
    radio_playing: "Playing",
    radio_offline: "OFFLINE",
    radio_online: "ONLINE",
    radio_unavailable: "Radio is currently unavailable.",
    radio_try_again: "Try Again",
    radio_no_stations: "No radio stations available yet.",
    radio_search: "Search radio...",
    radio_all_categories: "All Categories",
    radio_categories: "Radio Categories",

    // Admin Radio
    admin_radio: "Radio Management",
    admin_radio_add: "Add Radio",
    admin_radio_edit: "Edit Radio",
    admin_radio_delete: "Delete Radio",
    admin_radio_name: "Radio Name",
    admin_radio_stream_url: "Stream URL",
    admin_radio_description: "Description",
    admin_radio_category: "Category",
    admin_radio_status: "Status",
    admin_radio_enabled: "Enabled",
    admin_radio_disabled: "Disabled",
    admin_radio_order: "Display Order",
    admin_radio_thumbnail: "Radio Thumbnail",
    admin_radio_test: "Test Stream",
    admin_radio_confirm_delete: "Are you sure you want to delete this radio?",
    admin_radio_stream_ok: "Stream can be played",
    admin_radio_stream_fail: "Stream cannot be reached",

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
    nav_radio: "Radio",
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
    loading: "Memuatkan...",
    loading_channel: "Memuatkan saluran...",
    channel_not_found: "Saluran tidak dijumpai",
    channel_not_found_desc: "Saluran yang anda cari tidak wujud atau telah dipadam.",
    back_to_channels: "← Kembali ke Senarai Saluran",
    back: "Kembali",
    schedule_title: "Jadual Siaran",
    view_full_schedule: "Lihat Jadual Penuh",
    no_program_available: "Tiada program tersedia.",
    next: "SETERUSNYA",
    program_guide: "Panduan Program",
    on_air: "SEDANG DISIAR",
    upcoming: "Akan Datang",

    // Schedule / EPG
    today: "Hari Ini",
    loading_schedule: "Memuatkan jadual...",
    no_programs: "Tiada program untuk tarikh ini.",
    now_playing: "SEDANG BERSIARAN",
    epg_date: "Tarikh",
    epg_channel: "Saluran",
    epg_start: "Mula",
    epg_end: "Tamat",
    epg_duration: "Tempoh",
    epg_description: "Penerangan",
    epg_close: "Tutup",

    // Subscribe
    subscribe_badge: "LANGGANAN PERCUMA",
    subscribe_title: "Jangan Terlepas Apa-Apa Dari Bilik Agama! 📺",
    subscribe_description: "Langgan secara percuma untuk terus mengikuti siaran langsung, program dan kandungan terbaru eBilikAgamaTV.",
    subscribe_button: "LANGGAN PERCUMA",
    subscribe_count_label: "pelanggan",
    subscribe_success: "Berjaya melanggan!",
    subscribe_error: "Langganan gagal. Sila cuba lagi.",
    subscribe_already: "SUDAH DILANGGAN",

    // Live Replay
    live_replay_title: "Ulang Tonton Siaran Langsung",
    live_replay_description: "Tonton rakaman siaran langsung kami.",
    replay_not_found: "Ulang tonton tidak dijumpai",

    // Radio
    radio_title: "Radio eBilikAgama",
    radio_subtitle: "Dengarkan siaran radio secara langsung.",
    radio_listen: "Dengar Sekarang",
    radio_playing: "Sedang Dimainkan",
    radio_offline: "LUAR TALIAN",
    radio_online: "DALAM TALIAN",
    radio_unavailable: "Radio tidak dapat dimainkan buat masa ini.",
    radio_try_again: "Cuba Lagi",
    radio_no_stations: "Tiada stesen radio tersedia lagi.",
    radio_search: "Cari radio...",
    radio_all_categories: "Semua Kategori",
    radio_categories: "Kategori Radio",

    // Admin Radio
    admin_radio: "Pengurusan Radio",
    admin_radio_add: "Tambah Radio",
    admin_radio_edit: "Sunting Radio",
    admin_radio_delete: "Padam Radio",
    admin_radio_name: "Nama Radio",
    admin_radio_stream_url: "URL Siaran",
    admin_radio_description: "Penerangan",
    admin_radio_category: "Kategori",
    admin_radio_status: "Status",
    admin_radio_enabled: "Diaktifkan",
    admin_radio_disabled: "Dinyahaktifkan",
    admin_radio_order: "Susunan Paparan",
    admin_radio_thumbnail: "Gambar Radio",
    admin_radio_test: "Semak Siaran",
    admin_radio_confirm_delete: "Adakah anda pasti mahu memadam radio ini?",
    admin_radio_stream_ok: "Siaran boleh dimainkan",
    admin_radio_stream_fail: "Siaran tidak dapat dicapai",

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
    nav_radio: "广播",
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
    loading: "加载中...",
    loading_channel: "加载频道中...",
    channel_not_found: "频道未找到",
    channel_not_found_desc: "您查找的频道不存在或已被删除。",
    back_to_channels: "← 返回频道列表",
    back: "返回",
    schedule_title: "节目时间表",
    view_full_schedule: "查看完整节目表",
    no_program_available: "暂无节目。",
    next: "接下来",
    program_guide: "节目指南",
    on_air: "正在播出",
    upcoming: "即将播出",

    // Schedule / EPG
    today: "今天",
    loading_schedule: "加载时间表中...",
    no_programs: "该日期暂无节目。",
    now_playing: "正在播出",
    epg_date: "日期",
    epg_channel: "频道",
    epg_start: "开始",
    epg_end: "结束",
    epg_duration: "时长",
    epg_description: "描述",
    epg_close: "关闭",

    // Subscribe
    subscribe_badge: "免费订阅",
    subscribe_title: "不要错过 Bilik Agama 的精彩内容！📺",
    subscribe_description: "免费订阅，及时获取直播、节目和最新 eBilikAgamaTV 内容。",
    subscribe_button: "免费订阅",
    subscribe_count_label: "订阅者",
    subscribe_success: "订阅成功！",
    subscribe_error: "订阅失败，请重试。",
    subscribe_already: "已订阅",

    // Live Replay
    live_replay_title: "直播回放",
    live_replay_description: "观看我们的直播录像。",
    replay_not_found: "未找到回放",

    // Radio
    radio_title: "eBilikAgama 广播",
    radio_subtitle: "收听直播广播。",
    radio_listen: "立即收听",
    radio_playing: "正在播放",
    radio_offline: "离线",
    radio_online: "在线",
    radio_unavailable: "广播暂时无法播放。",
    radio_try_again: "重试",
    radio_no_stations: "暂无广播电台。",
    radio_search: "搜索广播...",
    radio_all_categories: "所有类别",
    radio_categories: "广播类别",

    // Admin Radio
    admin_radio: "广播管理",
    admin_radio_add: "添加广播",
    admin_radio_edit: "编辑广播",
    admin_radio_delete: "删除广播",
    admin_radio_name: "广播名称",
    admin_radio_stream_url: "串流网址",
    admin_radio_description: "描述",
    admin_radio_category: "类别",
    admin_radio_status: "状态",
    admin_radio_enabled: "已启用",
    admin_radio_disabled: "已禁用",
    admin_radio_order: "显示顺序",
    admin_radio_thumbnail: "广播缩略图",
    admin_radio_test: "测试串流",
    admin_radio_confirm_delete: "确定要删除此广播吗？",
    admin_radio_stream_ok: "串流可以播放",
    admin_radio_stream_fail: "串流无法连接",

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
