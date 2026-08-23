// Server-side Twitch live status detection
// Uses the Twitch channel page metadata — no API keys required.
// Results are cached for 10 seconds per channel to avoid hammering Twitch.

interface StatusCache {
  status: "online" | "offline" | "unknown";
  timestamp: number;
}

const cache = new Map<string, StatusCache>();
const CACHE_TTL = 10_000; // 10 seconds

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
    if (!clean) {
      setCache(key, "unknown");
      return "unknown";
    }

    const response = await fetch(`https://www.twitch.tv/${clean}`, {
      method: "GET",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      setCache(key, "unknown");
      return "unknown";
    }

    const html = await response.text();

    // Method 1: Check for isLive in page data
    if (
      html.includes('"isLive":true') ||
      html.includes('"isLive": true') ||
      html.includes('"isLive":true,')
    ) {
      setCache(key, "online");
      return "online";
    }

    // Method 2: Check for stream type indicator
    if (
      html.includes('"type":"live"') ||
      html.includes('"type": "live"') ||
      html.includes('"type":"live",')
    ) {
      setCache(key, "online");
      return "online";
    }

    // Method 3: Check for live broadcast indicator
    if (
      html.includes('"isLiveBroadcast":true') ||
      html.includes('"isLiveBroadcast": true')
    ) {
      setCache(key, "online");
      return "online";
    }

    // Method 4: Check for stream data presence (non-null stream object)
    // If the page contains a stream object with actual data, it's live
    const streamMatch = html.match(/"stream"\s*:\s*\{/);
    if (streamMatch) {
      // Verify it's not an empty/null stream
      const idx = streamMatch.index!;
      const snippet = html.substring(idx, idx + 200);
      if (
        !snippet.includes('"stream":null') &&
        !snippet.includes('"stream": null') &&
        !snippet.includes('"stream":{}') &&
        !snippet.includes('"stream": {}')
      ) {
        setCache(key, "online");
        return "online";
      }
    }

    // If we found login data but no live indicators, it's offline
    if (
      html.includes('"login":"') ||
      html.includes('"login": "') ||
      html.includes("login_name")
    ) {
      setCache(key, "offline");
      return "offline";
    }

    // Channel might not exist or page structure changed
    setCache(key, "unknown");
    return "unknown";
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

// Batch check multiple channels
export async function getMultipleChannelStatuses(
  usernames: string[]
): Promise<Record<string, "online" | "offline" | "unknown">> {
  const results: Record<string, "online" | "offline" | "unknown"> = {};

  // Check all channels concurrently
  const checks = usernames.map(async (username) => {
    const status = await getChannelStatus(username);
    results[username.toLowerCase().trim()] = status;
  });

  await Promise.allSettled(checks);
  return results;
}
