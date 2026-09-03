export default function HomeLoading() {
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      {/* Full-screen dark overlay */}
      <div className="absolute inset-0 bg-black" />

      {/* Pill-shaped loader container */}
      <div className="relative z-10 flex items-center gap-4 px-7 py-3.5 sm:px-9 sm:py-4 rounded-full bg-[#141414] border border-white/[0.06]">
        {/* 6-bar equalizer */}
        <div className="flex items-end gap-[3px] h-[22px]">
          <div className="w-[3px] rounded-full eq-bar" style={{ backgroundColor: "#ffffff", animationDelay: "0ms", animationDuration: "0.8s" }} />
          <div className="w-[3px] rounded-full eq-bar" style={{ backgroundColor: "#d4d4d4", animationDelay: "0.15s", animationDuration: "0.65s" }} />
          <div className="w-[3px] rounded-full eq-bar" style={{ backgroundColor: "#a3a3a3", animationDelay: "0.05s", animationDuration: "0.9s" }} />
          <div className="w-[3px] rounded-full eq-bar" style={{ backgroundColor: "#d4d4d4", animationDelay: "0.2s", animationDuration: "0.7s" }} />
          <div className="w-[3px] rounded-full eq-bar" style={{ backgroundColor: "#8a8a8a", animationDelay: "0.1s", animationDuration: "0.85s" }} />
          <div className="w-[3px] rounded-full eq-bar" style={{ backgroundColor: "#ffffff", animationDelay: "0.25s", animationDuration: "0.75s" }} />
        </div>
        <span className="text-[#b0b0b0] text-[13px] sm:text-sm font-medium tracking-wide select-none">
          Loading...
        </span>
      </div>
    </div>
  );
}
