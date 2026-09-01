import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// GET - This route is no longer the direct OAuth callback target.
// YouTube OAuth now uses /api/google-drive/callback (same registered redirect URI).
// This route redirects to the Google Drive callback with the same query params,
// preserving any code/state from a direct hit.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const callbackUrl = new URL("/api/google-drive/callback", request.url);

  // Forward all query params (code, state, error)
  for (const [key, value] of searchParams.entries()) {
    callbackUrl.searchParams.set(key, value);
  }

  // Ensure state contains the YouTube flow type
  const state = searchParams.get("state");
  if (state) {
    try {
      const decoded = JSON.parse(Buffer.from(state, "base64").toString());
      if (decoded.type !== "youtube") {
        decoded.type = "youtube";
        const newState = Buffer.from(JSON.stringify(decoded)).toString("base64");
        callbackUrl.searchParams.set("state", newState);
      }
    } catch {
      // State can't be decoded; Google Drive callback will handle it
    }
  }

  return NextResponse.redirect(callbackUrl);
}
