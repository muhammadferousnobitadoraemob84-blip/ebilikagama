import { NextRequest, NextResponse } from "next/server";
import { getYouTubeRedirectUri } from "@/lib/youtube";
import { getRedirectUri } from "@/lib/google-drive";
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

    // Use request.url to derive the redirect URI the same way the auth route does
    const redirectUri = getYouTubeRedirectUri(request.url);
    const driveRedirectUri = getRedirectUri(request.url);
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
      driveRedirectUri,
      urisMatch: redirectUri === driveRedirectUri,
      redirectUriSource: process.env.GOOGLE_REDIRECT_URI
        ? "GOOGLE_REDIRECT_URI env var"
        : `derived from request host: ${new URL(request.url).host}`,
      instructions: {
        note: `YouTube OAuth and Google Drive OAuth now share the EXACT same redirect URI function. Both use getRedirectUri() from google-drive.ts.`,
        youtubeRedirectUri: redirectUri,
        driveRedirectUri: driveRedirectUri,
        match: redirectUri === driveRedirectUri ? "MATCH - URIs are identical" : "MISMATCH - URIs differ!",
        googleCloudConsole: `https://console.cloud.google.com/apis/credentials`,
        step: `Ensure this redirect URI is registered as an Authorized redirect URI in Google Cloud Console for the OAuth client`,
      },
    });
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}
