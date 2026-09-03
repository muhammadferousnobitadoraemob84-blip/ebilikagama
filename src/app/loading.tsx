export default function HomeLoading() {
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      {/* Background with blur */}
      <div className="absolute inset-0 bg-black/80 backdrop-blur-xl" />

      {/* Glassmorphic card */}
      <div className="relative z-10 flex flex-col items-center gap-5 px-10 py-10 sm:px-14 sm:py-12 rounded-3xl border border-white/10 bg-white/5 backdrop-blur-2xl shadow-2xl shadow-black/40 max-w-xs sm:max-w-sm w-[85vw]">
        {/* Animated ring */}
        <div className="relative w-16 h-16 sm:w-20 sm:h-20">
          <svg className="w-full h-full -rotate-90 animate-spin" viewBox="0 0 80 80">
            <circle
              cx="40"
              cy="40"
              r="36"
              fill="none"
              stroke="rgba(255,255,255,0.06)"
              strokeWidth="4"
            />
            <circle
              cx="40"
              cy="40"
              r="36"
              fill="none"
              stroke="url(#spinner-gradient)"
              strokeWidth="4"
              strokeLinecap="round"
              strokeDasharray="180 46"
            />
            <defs>
              <linearGradient id="spinner-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#ef4444" />
                <stop offset="100%" stopColor="#dc2626" />
              </linearGradient>
            </defs>
          </svg>
        </div>

        {/* Loading text */}
        <div className="text-center">
          <p className="text-white/90 text-sm sm:text-base font-semibold tracking-wide">
            Loading...
          </p>
        </div>

        {/* Subtle progress bar (indeterminate) */}
        <div className="w-full h-1 rounded-full bg-white/10 overflow-hidden">
          <div className="h-full rounded-full bg-gradient-to-r from-red-500 to-red-600 animate-loading-bar" />
        </div>
      </div>
    </div>
  );
}
