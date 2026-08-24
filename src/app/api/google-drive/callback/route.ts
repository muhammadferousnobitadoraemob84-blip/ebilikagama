import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForTokens, verifyGoogleDriveConnection } from "@/lib/google-drive";
import { prisma } from "@/lib/prisma";
import { ensureDatabase } from "@/lib/db-init";

export const dynamic = "force-dynamic";

// GET - OAuth callback from Google
export async function GET(request: NextRequest) {
  try {
    await ensureDatabase();

    const { searchParams } = new URL(request.url);
    const code = searchParams.get("code");
    const state = searchParams.get("state");
    const error = searchParams.get("error");

    // Handle OAuth errors
    if (error) {
      console.error("[GOOGLE-DRIVE-CALLBACK] OAuth error:", error);
      return NextResponse.redirect(
        new URL("/admin/settings?drive=error&message=Authorization denied", request.url)
      );
    }

    if (!code) {
      return NextResponse.redirect(
        new URL("/admin/settings?drive=error&message=No authorization code", request.url)
      );
    }

    // Exchange code for tokens - pass request URL for redirect URI
    const requestUrl = request.url;
    const tokens = await exchangeCodeForTokens(code, requestUrl);

    if (!tokens.access_token) {
      return NextResponse.redirect(
        new URL("/admin/settings?drive=error&message=Failed to get access token", request.url)
      );
    }

    // Verify connection and get user email
    const connection = await verifyGoogleDriveConnection(tokens.access_token);

    if (!connection.connected) {
      return NextResponse.redirect(
        new URL("/admin/settings?drive=error&message=Failed to verify connection", request.url)
      );
    }

    // Save tokens to database
    await prisma.setting.upsert({
      where: { key: "google_drive_access_token" },
      update: { value: tokens.access_token },
      create: { key: "google_drive_access_token", value: tokens.access_token },
    });

    if (tokens.refresh_token) {
      await prisma.setting.upsert({
        where: { key: "google_drive_refresh_token" },
        update: { value: tokens.refresh_token },
        create: { key: "google_drive_refresh_token", value: tokens.refresh_token },
      });
    }

    await prisma.setting.upsert({
      where: { key: "google_drive_connected" },
      update: { value: "true" },
      create: { key: "google_drive_connected", value: "true" },
    });

    await prisma.setting.upsert({
      where: { key: "google_drive_email" },
      update: { value: connection.email || "" },
      create: { key: "google_drive_email", value: connection.email || "" },
    });

    // Redirect to settings with success
    return NextResponse.redirect(
      new URL("/admin/settings?drive=success", request.url)
    );
  } catch (error) {
    console.error("[GOOGLE-DRIVE-CALLBACK] Error:", error);
    return NextResponse.redirect(
      new URL("/admin/settings?drive=error&message=Server error", request.url)
    );
  }
}
