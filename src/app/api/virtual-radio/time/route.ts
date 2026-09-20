import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Public server-time endpoint for the virtual radio clock sync.
// Returns the authoritative server clock; the client derives its offset
// from two local timestamps around this response (NTP-style midpoint).
export async function GET() {
  const now = Date.now();

  return NextResponse.json(
    {
      serverTime: now,
      iso: new Date(now).toISOString(),
    },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
        // Inline the server receive time too: in multi-tier setups
        // (CDN → server) the body timestamp is the more reliable sample.
      },
    }
  );
}
