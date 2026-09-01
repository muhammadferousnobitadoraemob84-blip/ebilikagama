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
        note: `YouTube OAuth now shares the same redirect URI as Google Drive (${redirectUri}). No additional Google Cloud Console configuration needed if Google Drive OAuth is already working.`,
        flow: `Auth URL → Google → callback → /api/google-drive/callback (state param routes to YouTube flow)`,
        googleCloudConsole: `https://console.cloud.google.com/apis/credentials`,
      },
    });
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}
