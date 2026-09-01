// YouTube integration using direct HTTP calls (YouTube Data API v3)
// No external npm package required

import { getRedirectUri } from "@/lib/google-drive";
import { prisma } from "@/lib/prisma";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";

const YOUTUBE_API = "https://www.googleapis.com/youtube/v3";

// Scopes needed for YouTube read access to scheduled streams
const YOUTUBE_SCOPES = "https://www.googleapis.com/auth/youtube.readonly";

/**
 * Get redirect URI for YouTube OAuth.
 *
 * CRITICAL: This reuses the EXACT same function as Google Drive OAuth.
 * Both services use the same GOOGLE_CLIENT_ID registered in Google Cloud Console,
 * so the redirect URI MUST be identical. This prevents redirect_uri_mismatch.
 */
export function getYouTubeRedirectUri(requestUrl?: string): string {
  return getRedirectUri(requestUrl);
}

/**
 * Generate YouTube OAuth authorization URL
 */
export function getYouTubeAuthUrl(requestUrl?: string, state?: string): string {
  const redirectUri = getYouTubeRedirectUri(requestUrl);
  console.log("[YOUTUBE-AUTH] Using redirect_uri:", redirectUri);

  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: YOUTUBE_SCOPES,
    access_type: "offline",
    prompt: "consent",
    state: state || "",
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangeYouTubeCodeForTokens(code: string, requestUrl?: string) {
  const redirectUri = getYouTubeRedirectUri(requestUrl);
  console.log("[YOUTUBE-CALLBACK] Using redirect_uri:", redirectUri);

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("[YOUTUBE] Token exchange failed:", response.status, errorText);
    throw new Error(`Token exchange failed: ${errorText}`);
  }

  const data = await response.json();
  console.log("[YOUTUBE] Token exchange success. Has access_token:", !!data.access_token, "Has refresh_token:", !!data.refresh_token);
  return data;
}

/**
 * Refresh YouTube access token using the stored refresh token
 */
export async function refreshYouTubeAccessToken(refreshToken: string) {
  console.log("[YOUTUBE] Refreshing access token...");

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("[YOUTUBE] Token refresh failed:", response.status, errorText);
    throw new Error(`Failed to refresh YouTube access token: ${errorText}`);
  }

  const data = await response.json();
  console.log("[YOUTUBE] Token refresh success. Has access_token:", !!data.access_token);
  return data;
}

/**
 * Get a valid YouTube access token from the database, refreshing if needed.
 * Returns null if no tokens exist or refresh fails.
 */
export async function getValidYouTubeToken(): Promise<{
  accessToken: string;
  refreshToken: string | null;
} | null> {
  try {
    const accessTokenRecord = await prisma.setting.findUnique({ where: { key: "youtube_access_token" } });
    const refreshTokenRecord = await prisma.setting.findUnique({ where: { key: "youtube_refresh_token" } });

    const accessToken = accessTokenRecord?.value;
    const refreshToken = refreshTokenRecord?.value;

    if (!accessToken) {
      console.log("[YOUTUBE] No access token found in database");
      return null;
    }

    // Try using the current access token first
    // Test it with a simple API call
    const testResponse = await fetch(
      `${YOUTUBE_API}/channels?part=id&mine=true`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (testResponse.ok) {
      return { accessToken, refreshToken: refreshToken || null };
    }

    // Token might be expired — try refreshing
    if (!refreshToken) {
      console.log("[YOUTUBE] Access token invalid and no refresh token available");
      return null;
    }

    console.log("[YOUTUBE] Access token invalid, attempting refresh...");
    const refreshed = await refreshYouTubeAccessToken(refreshToken);

    if (!refreshed.access_token) {
      console.log("[YOUTUBE] Token refresh did not return a new access token");
      return null;
    }

    // Save the new access token
    await prisma.setting.upsert({
      where: { key: "youtube_access_token" },
      update: { value: refreshed.access_token },
      create: { key: "youtube_access_token", value: refreshed.access_token },
    });

    // Save new refresh token if provided (Google may issue a new one)
    if (refreshed.refresh_token) {
      await prisma.setting.upsert({
        where: { key: "youtube_refresh_token" },
        update: { value: refreshed.refresh_token },
        create: { key: "youtube_refresh_token", value: refreshed.refresh_token },
      });
    }

    return { accessToken: refreshed.access_token, refreshToken: refreshed.refresh_token || refreshToken };
  } catch (error) {
    console.error("[YOUTUBE] Error getting valid token:", error);
    return null;
  }
}

/**
 * Get YouTube channel info for the connected account.
 * Returns detailed error information when the API call fails.
 */
export async function getYouTubeChannelInfo(accessToken: string): Promise<{
  connected: boolean;
  channelName?: string;
  channelId?: string;
  thumbnail?: string;
  error?: string;
  errorDetails?: string;
}> {
  try {
    console.log("[YOUTUBE] Fetching channel info with access token...");

    const response = await fetch(
      `${YOUTUBE_API}/channels?part=snippet&mine=true`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    console.log("[YOUTUBE] Channel API response status:", response.status);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorCode = errorData?.error?.code || response.status;
      const errorMessage = errorData?.error?.message || `HTTP ${response.status}`;
      const errorStatus = errorData?.error?.status || "unknown";

      console.error("[YOUTUBE] Channel API error:", {
        code: errorCode,
        message: errorMessage,
        status: errorStatus,
      });

      // Provide specific error messages based on the error type
      if (response.status === 403) {
        if (errorMessage.includes("YouTube Data API has not been used") || errorMessage.includes("it is disabled")) {
          return {
            connected: false,
            error: "YouTube Data API is not enabled for this Google Cloud project.",
            errorDetails: `Enable it at: https://console.developers.google.com/apis/api/youtube.googleapis.com\nAPI Error: ${errorMessage}`,
          };
        }
        if (errorMessage.includes("quota")) {
          return {
            connected: false,
            error: "YouTube API quota has been exceeded. Please try again later.",
            errorDetails: errorMessage,
          };
        }
        return {
          connected: false,
          error: `YouTube API permission denied: ${errorMessage}`,
          errorDetails: `Status: ${errorStatus}, Code: ${errorCode}`,
        };
      }

      if (response.status === 401) {
        return {
          connected: false,
          error: "YouTube authorization has expired. Please reconnect your YouTube account.",
          errorDetails: errorMessage,
        };
      }

      return {
        connected: false,
        error: `YouTube API error (${response.status}): ${errorMessage}`,
        errorDetails: `Status: ${errorStatus}, Code: ${errorCode}`,
      };
    }

    const data = await response.json();
    console.log("[YOUTUBE] Channel API response items count:", data.items?.length || 0);

    const channel = data.items?.[0];

    if (!channel) {
      console.log("[YOUTUBE] No YouTube channel found for this Google account");
      return {
        connected: false,
        error: "No YouTube channel found for this Google account.",
        errorDetails: "The authenticated Google account does not have an associated YouTube channel. Create a YouTube channel first at youtube.com/channel_switcher.",
      };
    }

    console.log("[YOUTUBE] Channel found:", channel.snippet?.title, "ID:", channel.id);

    return {
      connected: true,
      channelName: channel.snippet?.title,
      channelId: channel.id,
      thumbnail: channel.snippet?.thumbnails?.default?.url,
    };
  } catch (error) {
    console.error("[YOUTUBE] Channel info fetch failed:", error);
    return {
      connected: false,
      error: "Unable to contact YouTube. Please try again.",
      errorDetails: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Fetch scheduled/upcoming YouTube livestreams
 */
export async function getYouTubeScheduledStreams(accessToken: string): Promise<{
  streams: YouTubeScheduledStream[];
  error?: string;
}> {
  try {
    const response = await fetch(
      `${YOUTUBE_API}/liveBroadcasts?part=snippet,contentDetails,status&broadcastStatus=upcoming&maxResults=50`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMessage = errorData?.error?.message || `API error: ${response.status}`;
      console.error("[YOUTUBE] Streams API error:", response.status, errorMessage);

      if (response.status === 403) {
        return { streams: [], error: `Quota exceeded or permission denied: ${errorMessage}` };
      }
      if (response.status === 401) {
        return { streams: [], error: "Authorization expired. Please reconnect your YouTube account." };
      }
      return { streams: [], error: errorMessage };
    }

    const data = await response.json();

    const streams: YouTubeScheduledStream[] = (data.items || []).map((item: YouTubeBroadcastItem) => ({
      id: item.id,
      title: item.snippet?.title || "Untitled",
      description: item.snippet?.description || "",
      scheduledStartTime: item.snippet?.scheduledStartTime || null,
      thumbnail: item.snippet?.thumbnails?.medium?.url || item.snippet?.thumbnails?.default?.url || null,
      channelId: item.contentDetails?.boundToRealYouTubeChannelId || "",
      status: item.status?.lifeCycleStatus || item.status?.privacyStatus || "unknown",
      youtubeUrl: `https://www.youtube.com/watch?v=${item.id}`,
    }));

    return { streams };
  } catch (error) {
    console.error("[YOUTUBE] Streams fetch failed:", error);
    return { streams: [], error: "Failed to fetch scheduled streams" };
  }
}

/**
 * Convert YouTube ISO timestamp to Malaysia time (UTC+8) components
 */
export function youtubeTimeToMalaysia(isoTimestamp: string): {
  date: string; // YYYY-MM-DD
  time: string; // HH:mm
} | null {
  try {
    const date = new Date(isoTimestamp);
    const malaysiaTime = new Date(date.getTime() + 8 * 60 * 60 * 1000);

    const year = malaysiaTime.getUTCFullYear();
    const month = String(malaysiaTime.getUTCMonth() + 1).padStart(2, "0");
    const day = String(malaysiaTime.getUTCDate()).padStart(2, "0");
    const hours = String(malaysiaTime.getUTCHours()).padStart(2, "0");
    const minutes = String(malaysiaTime.getUTCMinutes()).padStart(2, "0");

    return {
      date: `${year}-${month}-${day}`,
      time: `${hours}:${minutes}`,
    };
  } catch {
    return null;
  }
}

// ─── Types ───────────────────────────────────────────────────────────

export interface YouTubeScheduledStream {
  id: string;
  title: string;
  description: string;
  scheduledStartTime: string | null;
  thumbnail: string | null;
  channelId: string;
  status: string;
  youtubeUrl: string;
}

interface YouTubeBroadcastItem {
  id: string;
  snippet?: {
    title?: string;
    description?: string;
    scheduledStartTime?: string;
    thumbnails?: {
      default?: { url?: string };
      medium?: { url?: string };
      high?: { url?: string };
    };
  };
  contentDetails?: {
    boundToRealYouTubeChannelId?: string;
  };
  status?: {
    lifeCycleStatus?: string;
    privacyStatus?: string;
  };
}
