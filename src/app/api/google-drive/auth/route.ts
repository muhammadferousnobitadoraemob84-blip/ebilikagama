import { NextRequest, NextResponse } from "next/server";
import { getAuthUrl } from "@/lib/google-drive";
import { verifyToken, isAdminRole } from "@/lib/auth";

export const dynamic = "force-dynamic";

// GET - Redirect to Google OAuth consent screen
export async function GET(request: NextRequest) {
  try {
    // Verify admin authentication
    const token = request.cookies.get("admin-token")?.value;
    if (!token) {
      // Not authenticated — redirect to admin login
      return NextResponse.redirect(new URL("/admin/login", request.url));
    }

    const gdriveSession = await verifyToken(token);
    if (!gdriveSession || !isAdminRole(gdriveSession.role)) {
      return NextResponse.redirect(new URL("/admin/login", request.url));
    }

    // Generate state token (includes admin token hash for callback)
    const state = Buffer.from(JSON.stringify({ adminToken: token })).toString(
      "base64"
    );

    // Get the request URL to construct redirect URI
    const requestUrl = request.url;
    const authUrl = getAuthUrl(requestUrl, state);

    // Perform HTTP redirect to Google OAuth consent screen
    // DO NOT return JSON — the browser navigates here directly
    return NextResponse.redirect(authUrl);
  } catch (error) {
    console.error("[GOOGLE-DRIVE-AUTH] Error:", error);
    // On error, redirect back to Quran Audio admin with error
    return NextResponse.redirect(
      new URL("/admin/quran-audio?drive_error=auth_failed", request.url)
    );
  }
}
