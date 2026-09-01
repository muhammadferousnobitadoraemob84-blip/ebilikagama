import { NextRequest, NextResponse } from "next/server";
import { getYouTubeRedirectUri } from "@/lib/youtube";
import { verifyToken } from "@/lib/auth";

export const dynamic = "force-dynamic";

// GET - Check YouTube OAuth configuration (admin-only diagnostic)
export async function GET(request: NextRequest) {
  try {
    const token = request.cookies.get("admin-token")?.value;
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await verifyToken(token);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const redirectUri = getYouTubeRedirectUri();
    const hasClientId = !!process.env.GOOGLE_CLIENT_ID;
    const hasClientSecret = !!process.env.GOOGLE_CLIENT_SECRET;
    const clientIdPrefix = process.env.GOOGLE_CLIENT_ID
      ? process.env.GOOGLE_CLIENT_ID.substring(0, 12) + "..."
      : "NOT SET";

    return NextResponse.json({
      configured: hasClientId && hasClientSecret,
      clientId: clientIdPrefix,
      clientSecretSet: hasClientSecret,
      redirectUri,
      redirectUriSource: process.env.YOUTUBE_REDIRECT_URI
        ? "YOUTUBE_REDIRECT_URI env var"
        : "hardcoded fallback",
      instructions: {
        step1: `Ensure this exact redirect URI is registered in Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client ID → Authorized redirect URIs:`,
        redirectUriToRegister: redirectUri,
        step2: `Google Cloud Console URL: https://console.cloud.google.com/apis/credentials`,
        step3: `Click your OAuth client → Edit → Add the redirect URI above → Save`,
      },
    });
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}
