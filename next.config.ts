import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow Twitch embed domains
  async headers() {
    const headers = [
      // Cache static assets aggressively — PRODUCTION ONLY. In dev, Turbopack
      // serves stable (non-hashed) chunk URLs; marking them `immutable` pins a
      // stale bundle in the browser and code changes appear to never load.
      // Production filenames are content-hashed, so immutable is safe there.
      ...(process.env.NODE_ENV === "production"
        ? [
            {
              source: "/_next/static/:path*",
              headers: [
                {
                  key: "Cache-Control",
                  value: "public, max-age=31536000, immutable",
                },
              ],
            },
          ]
        : []),
      // NOTE: /api/images must NOT be cached via a global header rule.
      // A blanket Cache-Control here was applied to ERROR responses too
      // (503/404), letting the CDN and browsers store broken-image answers
      // for 24h — the mechanism behind the replay-thumbnail cache-poisoning
      // incident. The route handler sets per-response headers: long cache on
      // success, no-store on every error path.
      {
        // Cache channel API with short stale-while-revalidate
        source: "/api/channels",
        headers: [
          {
            key: "Cache-Control",
            value: "public, s-maxage=10, stale-while-revalidate=30",
          },
        ],
      },
      {
        // Cache replay API
        source: "/api/replays",
        headers: [
          {
            key: "Cache-Control",
            value: "public, s-maxage=30, stale-while-revalidate=60",
          },
        ],
      },        {
          // Cache settings API
          source: "/api/settings",
          headers: [
            {
              key: "Cache-Control",
              value: "public, s-maxage=60, stale-while-revalidate=300",
            },
          ],
        },
    ];
    return headers;
  },
  // Optimize images
  images: {
    formats: ["image/avif", "image/webp"],
  },
};

export default nextConfig;
