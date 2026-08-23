// Server-side Twitch live status detection
// Uses the Twitch GQL API (the same internal API the Twitch website uses).
// No OAuth credentials needed — uses the public Twitch web Client-ID.
// Results are cached for 10 seconds per channel to avoid rate limiting.

const TWITCH_GQL_URL = "https://gql.twitch.tv/gql";
const TWITCH_CLIENT_ID = "kimne78kx3ncx6brgo4mv6wki5h1ko";

interface StatusCache {
  status: "online" | "offline" | "unknown";
  timestamp: number;
}

const cache = new Map<string, StatusCache>();
const CACHE_TTL = 10_000; // 10 seconds

interface GQLResponse {
  data: {
    user: {
      stream: { type: string; createdAt: string } | null;
      displayName: string;
    } | null;
  };
}

export async function getChannelStatus(
  username: string
): Promise<"online" | "offline" | "unknown"> {
  const key = username.toLowerCase().trim();

  // Check cache
  const cached = cache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.status;
  }

  try {
    const clean = key.replace(/[^a-zA-Z0-9_]/g, "");
    if (!clean || clean.length < 4) {
      setCache(key, "unknown");
      return "unknown";
    }

    const response = await fetch(TWITCH_GQL_URL, {
      method: "POST",
      headers: {
        "Client-ID": TWITCH_CLIENT_ID,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: `query { user(login: "${clean}") { stream { type createdAt } displayName } }`,
      }),
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      setCache(key, "unknown");
      return "unknown";
    }

    const data: GQLResponse = await response.json();

    // User doesn't exist
    if (!data.data?.user) {
      setCache(key, "unknown");
      return "unknown";
    }

    // User exists but no stream → OFFLINE
    if (!data.data.user.stream) {
      setCache(key, "offline");
      return "offline";
    }

    // Stream exists and type is "live" → ONLINE
    if (data.data.user.stream.type === "live") {
      setCache(key, "online");
      return "online";
    }

    // Stream exists but not "live" type (e.g. "rerun") → treat as offline
    setCache(key, "offline");
    return "offline";
  } catch {
    // Network error — return last cached status or unknown
    const cached = cache.get(key);
    if (cached) return cached.status;
    return "unknown";
  }
}

function setCache(
  key: string,
  status: "online" | "offline" | "unknown"
): void {
  cache.set(key, { status, timestamp: Date.now() });
}

// Batch check multiple channels concurrently
export async function getMultipleChannelStatuses(
  usernames: string[]
): Promise<Record<string, "online" | "offline" | "unknown">> {
  const results: Record<string, "online" | "offline" | "unknown"> = {};

  const checks = usernames.map(async (username) => {
    const status = await getChannelStatus(username);
    results[username.toLowerCase().trim()] = status;
  });

  await Promise.allSettled(checks);
  return results;
}
