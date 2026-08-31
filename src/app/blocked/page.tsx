import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Access Restricted - eBilikAgamaTV",
  robots: { index: false, follow: false },
};

export default function BlockedPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-950 to-black flex items-center justify-center p-4">
      <div className="max-w-lg w-full text-center">
        {/* Shield / Lock Icon */}
        <div className="mx-auto mb-6 w-24 h-24 rounded-full bg-red-900/30 border-2 border-red-500/50 flex items-center justify-center">
          <svg
            className="w-12 h-12 text-red-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 15v2m0 0v2m0-2h2m-2 0H10m4-6V7a4 4 0 00-8 0v4h8z"
            />
          </svg>
        </div>

        {/* English */}
        <h1 className="text-3xl sm:text-4xl font-bold text-white mb-3">
          ACCESS RESTRICTED
        </h1>
        <p className="text-lg text-gray-300 mb-6">
          This website is only available in Malaysia.
        </p>

        {/* Divider */}
        <div className="w-20 h-px bg-gray-600 mx-auto mb-6" />

        {/* Bahasa Melayu */}
        <p className="text-base text-gray-400 italic">
          Akses ke laman web ini hanya tersedia di Malaysia.
        </p>
      </div>
    </div>
  );
}
