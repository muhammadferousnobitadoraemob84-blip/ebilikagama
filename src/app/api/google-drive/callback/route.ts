import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForTokens, verifyGoogleDriveConnection } from "@/lib/google-drive";
import { exchangeYouTubeCodeForTokens, getYouTubeChannelInfo } from "@/lib/youtube";
import { prisma } from "@/lib/prisma";
import { ensureDatabase } from "@/lib/db-init";

export const dynamic = "force-dynamic";

// GET - OAuth callback from Google
// Handles BOTH Google Drive AND YouTube flows (same registered redirect URI)
// Distinguished by the state parameter
export async function GET(request: NextRequest) {
  try {
    await ensureDatabase();

    const { searchParams } = new URL(request.url);
    const code = searchParams.get("code");
    const state = searchParams.get("state");
    const error = searchParams.get("error");

    // Decode state to determine which flow this is
    let flowType = "drive";
    try {
      if (state) {
        const decoded = JSON.parse(Buffer.from(state, "base64").toString());
        if (decoded.type === "youtube") flowType = "youtube";
      }
    } catch {
      // Default to drive flow
    }

    // Handle OAuth errors
    if (error) {
      console.error("[GOOGLE-CALLBACK] OAuth error:", error);
      if (flowType === "youtube") {
        return NextResponse.redirect(
          new URL("/admin/youtube?yt=error&message=Authorization denied", request.url)
        );
      }
      return NextResponse.redirect(
        new URL("/admin/settings?drive=error&message=Authorization denied", request.url)
      );
    }

    if (!code) {
      if (flowType === "youtube") {
        return NextResponse.redirect(
          new URL("/admin/youtube?yt=error&message=No authorization code", request.url)
        );
      }
      return NextResponse.redirect(
        new URL("/admin/settings?drive=error&message=No authorization code", request.url)
      );
    }

    // ── YouTube Flow ──
    if (flowType === "youtube") {
      console.log("[GOOGLE-CALLBACK] YouTube flow detected");

      // Pass request.url so redirect_uri matches the auth URL exactly
      const tokens = await exchangeYouTubeCodeForTokens(code, request.url);

      if (!tokens.access_token) {
        return NextResponse.redirect(
          new URL("/admin/youtube?yt=error&message=Failed+to+get+access+token+from+Google", request.url)
        );
      }

      console.log("[GOOGLE-CALLBACK] YouTube token exchange successful. Saving tokens...");

      // ALWAYS save tokens first — OAuth succeeded even if channel verification fails
      await prisma.setting.upsert({
        where: { key: "youtube_access_token" },
        update: { value: tokens.access_token },
        create: { key: "youtube_access_token", value: tokens.access_token },
      });

      if (tokens.refresh_token) {
        await prisma.setting.upsert({
          where: { key: "youtube_refresh_token" },
          update: { value: tokens.refresh_token },
          create: { key: "youtube_refresh_token", value: tokens.refresh_token },
        });
      }

      // Now verify the YouTube channel
      const channelInfo = await getYouTubeChannelInfo(tokens.access_token);

      if (!channelInfo.connected) {
        // Tokens are saved, but channel verification failed.
        // Save as connected=false and pass the specific error message.
        // The admin can retry after fixing the issue (e.g., enable YouTube Data API).
        await prisma.setting.upsert({
          where: { key: "youtube_connected" },
          update: { value: "error" },
          create: { key: "youtube_connected", value: "error" },
        });

        const errorMsg = encodeURIComponent(channelInfo.error || "Failed to verify YouTube connection");
        const errorDetails = encodeURIComponent(channelInfo.errorDetails || "");
        console.error("[GOOGLE-CALLBACK] YouTube channel verification failed:", channelInfo.error, channelInfo.errorDetails);

        return NextResponse.redirect(
          new URL(`/admin/youtube?yt=error&message=${errorMsg}&details=${errorDetails}`, request.url)
        );
      }

      console.log("[GOOGLE-CALLBACK] YouTube channel verified:", channelInfo.channelName);

      await prisma.setting.upsert({
        where: { key: "youtube_connected" },
        update: { value: "true" },
        create: { key: "youtube_connected", value: "true" },
      });

      await prisma.setting.upsert({
        where: { key: "youtube_channel_name" },
        update: { value: channelInfo.channelName || "" },
        create: { key: "youtube_channel_name", value: channelInfo.channelName || "" },
      });

      await prisma.setting.upsert({
        where: { key: "youtube_channel_id" },
        update: { value: channelInfo.channelId || "" },
        create: { key: "youtube_channel_id", value: channelInfo.channelId || "" },
      });

      return NextResponse.redirect(
        new URL("/admin/youtube?yt=success", request.url)
      );
    }

    // ── Google Drive Flow (original) ──
    console.log("[GOOGLE-CALLBACK] Google Drive flow detected");

    const requestUrl = request.url;
    const tokens = await exchangeCodeForTokens(code, requestUrl);

    if (!tokens.access_token) {
      return NextResponse.redirect(
        new URL("/admin/settings?drive=error&message=Failed to get access token", request.url)
      );
    }

    const connection = await verifyGoogleDriveConnection(tokens.access_token);

    if (!connection.connected) {
      return NextResponse.redirect(
        new URL("/admin/settings?drive=error&message=Failed to verify connection", request.url)
      );
    }

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

    return NextResponse.redirect(
      new URL("/admin/settings?drive=success", request.url)
    );
  } catch (error) {
    console.error("[GOOGLE-CALLBACK] Error:", error);
    // Determine redirect based on state
    try {
      const { searchParams } = new URL(request.url);
      const state = searchParams.get("state");
      if (state) {
        const decoded = JSON.parse(Buffer.from(state, "base64").toString());
        if (decoded.type === "youtube") {
          return NextResponse.redirect(
            new URL("/admin/youtube?yt=error&message=Server error", request.url)
          );
        }
      }
    } catch {
      // Fall through
    }
    return NextResponse.redirect(
      new URL("/admin/settings?drive=error&message=Server error", request.url)
    );
  }
}
