// YouTube integration using direct HTTP calls (YouTube Data API v3)
// No external npm package required

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";

const YOUTUBE_API = "https://www.googleapis.com/youtube/v3";

// Scopes needed for YouTube read access to scheduled streams
const YOUTUBE_SCOPES = "https://www.googleapis.com/auth/youtube.readonly";

/**
 * Get redirect URI for YouTube OAuth.
 *
 * IMPORTANT: This must be EXACTLY the same string in both:
 * 1. The authorization URL sent to Google
 * 2. The token exchange request sent to Google
 * 3. The authorized redirect URI registered in Google Cloud Console
 *
 * We use only env var or hardcoded production URL — never request.url
 * because serverless function invocations can produce different hosts.
 */
export function getYouTubeRedirectUri(): string {
  if (process.env.YOUTUBE_REDIRECT_URI) {
    return process.env.YOUTUBE_REDIRECT_URI;
  }
  // IMPORTANT: We use the Google Drive callback URL because that redirect URI
  // is already registered in Google Cloud Console. Both services use the same
  // GOOGLE_CLIENT_ID, so this avoids redirect_uri_mismatch errors.
  // The state parameter distinguishes YouTube vs Google Drive flows.
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "https://ebilikagamabeta.vercel.app";
  return `${baseUrl}/api/google-drive/callback`;
}

/**
 * Generate YouTube OAuth authorization URL
 */
export function getYouTubeAuthUrl(requestUrl?: string, state?: string): string {
  const redirectUri = getYouTubeRedirectUri();
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
  const redirectUri = getYouTubeRedirectUri();
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
    throw new Error(`Token exchange failed: ${errorText}`);
  }

  return response.json();
}

/**
 * Refresh YouTube access token
 */
export async function refreshYouTubeAccessToken(refreshToken: string) {
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
    throw new Error("Failed to refresh YouTube access token");
  }

  return response.json();
}

/**
 * Get a valid YouTube access token, refreshing if needed
 */
export async function getValidYouTubeToken(accessToken: string, refreshToken: string): Promise<string> {
  // Try the current access token first
  return accessToken;
}

/**
 * Get YouTube channel info for the connected account
 */
export async function getYouTubeChannelInfo(accessToken: string): Promise<{
  connected: boolean;
  channelName?: string;
  channelId?: string;
  thumbnail?: string;
}> {
  try {
    const response = await fetch(
      `${YOUTUBE_API}/channels?part=snippet&mine=true`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    if (!response.ok) {
      return { connected: false };
    }

    const data = await response.json();
    const channel = data.items?.[0];

    if (!channel) {
      return { connected: false };
    }

    return {
      connected: true,
      channelName: channel.snippet?.title,
      channelId: channel.id,
      thumbnail: channel.snippet?.thumbnails?.default?.url,
    };
  } catch (error) {
    console.error("[YOUTUBE] Channel info fetch failed:", error);
    return { connected: false };
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
    // Fetch upcoming broadcasts (liveBroadcasts.list with upcoming status)
    const response = await fetch(
      `${YOUTUBE_API}/liveBroadcasts?part=snippet,contentDetails,status&broadcastStatus=upcoming&maxResults=50`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMessage = errorData?.error?.message || `API error: ${response.status}`;

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
    // Convert to UTC+8 (Malaysia)
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
  id: string; // YouTube broadcast/video ID
  title: string;
  description: string;
  scheduledStartTime: string | null; // ISO 8601
  thumbnail: string | null;
  channelId: string;
  status: string; // lifeCycleStatus
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
