interface Settings {
  hero_title?: string;
  hero_description?: string;
  hero_image?: string;
}

interface HeroProps {
  settings?: Settings;
  translations?: {
    hero_badge: string;
    hero_cta: string;
    hero_title_fallback: string;
    hero_desc_fallback: string;
  };
}

export default function Hero({ settings = {}, translations }: HeroProps) {
  const tr = translations || {
    hero_badge: "Live Broadcast",
    hero_cta: "Start Watching",
    hero_title_fallback: "eBilikAgamaTV",
    hero_desc_fallback: "Islamic media platform developed by the Islamic Affairs Unit of SMJK Chung Hwa Tenom to expand Islamic dakwah among students and parents.",
  };

  return (
    <section className="relative h-[40vh] sm:h-[50vh] md:h-[60vh] min-h-[280px] sm:min-h-[350px] md:min-h-[400px] flex items-center justify-center overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0">
        {settings.hero_image ? (
          <img
            src={settings.hero_image}
            alt=""
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-gray-950 via-gray-900 to-red-950/30" />
        )}
        {/* Gradient Overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/50 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-black/70 to-transparent" />
      </div>

      {/* Animated Background Dots */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-64 h-64 bg-red-500/5 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-red-500/5 rounded-full blur-3xl animate-pulse delay-1000" />
      </div>

      {/* Content */}
      <div className="relative z-10 text-center max-w-4xl mx-auto px-4 sm:px-6">
        <div className="inline-flex items-center gap-1.5 sm:gap-2 bg-red-600/20 border border-red-500/30 text-red-400 text-xs sm:text-sm font-medium px-3 sm:px-4 py-1.5 sm:py-2 rounded-full mb-4 sm:mb-6 backdrop-blur-sm">
          <span className="w-1.5 h-1.5 sm:w-2 sm:h-2 bg-red-500 rounded-full animate-pulse" />
          {tr.hero_badge}
        </div>

        <h1 className="text-2xl sm:text-4xl md:text-5xl lg:text-6xl font-extrabold text-white mb-3 sm:mb-6 tracking-tight leading-tight">
          {settings.hero_title || tr.hero_title_fallback}
        </h1>

        <p className="text-sm sm:text-lg md:text-xl text-gray-300 max-w-2xl mx-auto mb-5 sm:mb-8 leading-relaxed">
          {settings.hero_description || tr.hero_desc_fallback}
        </p>

        <a
          href="#saluran-tv"
          className="inline-flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white font-semibold text-sm sm:text-base px-6 sm:px-8 py-3 sm:py-3.5 rounded-xl transition-all duration-300 hover:shadow-lg hover:shadow-red-600/25 transform hover:-translate-y-0.5"
        >
          <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M8 5v14l11-7z" />
          </svg>
          {tr.hero_cta}
        </a>
      </div>
    </section>
  );
}
