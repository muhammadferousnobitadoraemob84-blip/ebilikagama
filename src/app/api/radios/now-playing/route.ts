import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const TWITCH_GQL_URL = "https://gql.twitch.tv/gql";
const TWITCH_CLIENT_ID = "kimne78kx3ncx6brgo4mv6wki5h1ko";

interface NowPlayingCache {
  title: string | null;
  artist: string | null;
  game: string | null;
  timestamp: number;
}

const cache = new Map<string, NowPlayingCache>();
const CACHE_TTL = 3000; // 3 seconds — matches frontend polling interval

interface TwitchGQLResponse {
  data: {
    user: {
      stream: {
        type: string;
        title: string;
        game: { name: string } | null;
        createdAt: string;
      } | null;
      displayName: string;
    } | null;
  };
}

export async function GET(request: NextRequest) {
  try {
    const username = request.nextUrl.searchParams.get("username");

    if (!username || typeof username !== "string") {
      return NextResponse.json(
        { song: null, artist: null, game: null, available: false },
        {
          headers: {
            "Cache-Control": "no-store, no-cache, must-revalidate",
            Pragma: "no-cache",
          },
        }
      );
    }

    const cleanUsername = username.trim().toLowerCase().replace(/[^a-zA-Z0-9_]/g, "");

    if (!cleanUsername || cleanUsername.length < 4) {
      return NextResponse.json(
        { song: null, artist: null, game: null, available: false },
        {
          headers: {
            "Cache-Control": "no-store, no-cache, must-revalidate",
            Pragma: "no-cache",
          },
        }
      );
    }

    // Check cache first
    const cached = cache.get(cleanUsername);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return NextResponse.json(
        {
          song: cached.title,
          artist: cached.artist,
          game: cached.game,
          available: !!cached.title,
          cached: true,
        },
        {
          headers: {
            "Cache-Control": "no-store, no-cache, must-revalidate",
            Pragma: "no-cache",
          },
        }
      );
    }

    // Query Twitch GQL for stream metadata
    try {
      const response = await fetch(TWITCH_GQL_URL, {
        method: "POST",
        headers: {
          "Client-ID": TWITCH_CLIENT_ID,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: `query {
            user(login: "${cleanUsername}") {
              stream {
                type
                title
                game { name }
                createdAt
              }
              displayName
            }
          }`,
        }),
        signal: AbortSignal.timeout(8000),
      });

      if (!response.ok) {
        setCache(cleanUsername, null, null, null);
        return NextResponse.json(
          { song: null, artist: null, game: null, available: false },
          {
            headers: {
              "Cache-Control": "no-store, no-cache, must-revalidate",
              Pragma: "no-cache",
            },
          }
        );
      }

      const data: TwitchGQLResponse = await response.json();

      // User doesn't exist or no stream
      if (!data.data?.user?.stream || data.data.user.stream.type !== "live") {
        setCache(cleanUsername, null, null, null);
        return NextResponse.json(
          { song: null, artist: null, game: null, available: false },
          {
            headers: {
              "Cache-Control": "no-store, no-cache, must-revalidate",
              Pragma: "no-cache",
            },
          }
        );
      }

      const stream = data.data.user.stream;
      const streamTitle = stream.title || null;
      const gameName = stream.game?.name || null;

      // Parse song info from the stream title
      // Music radio channels typically format their title as:
      // "Song - Artist" or "Artist - Song" or "Now Playing: Song by Artist"
      const { song, artist } = parseSongFromTitle(streamTitle);

      setCache(cleanUsername, song, artist, gameName);

      return NextResponse.json(
        {
          song,
          artist,
          game: gameName,
          streamTitle,
          available: !!song,
        },
        {
          headers: {
            "Cache-Control": "no-store, no-cache, must-revalidate",
            Pragma: "no-cache",
          },
        }
      );
    } catch {
      setCache(cleanUsername, null, null, null);
      return NextResponse.json(
        { song: null, artist: null, game: null, available: false },
        {
          headers: {
            "Cache-Control": "no-store, no-cache, must-revalidate",
            Pragma: "no-cache",
          },
        }
      );
    }
  } catch {
    return NextResponse.json(
      { song: null, artist: null, game: null, available: false },
      {
        status: 500,
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate",
          Pragma: "no-cache",
        },
      }
    );
  }
}

/**
 * Parse song title and artist from a Twitch stream title.
 * Music radio streams typically use formats like:
 * - "Song - Artist"
 * - "Artist - Song"
 * - "Now Playing: Song by Artist"
 * - "🎵 Song - Artist"
 * - Just the song name
 */
function parseSongFromTitle(title: string | null): { song: string | null; artist: string | null } {
  if (!title) return { song: null, artist: null };

  // Clean common prefixes
  let cleaned = title
    .replace(/^🎵\s*/i, "")
    .replace(/^🎶\s*/i, "")
    .replace(/^♪\s*/i, "")
    .replace(/^♫\s*/i, "")
    .replace(/^now playing:\s*/i, "")
    .replace(/^currently playing:\s*/i, "")
    .trim();

  // Try "Song - Artist" or "Artist - Song" pattern
  const dashMatch = cleaned.match(/^(.+?)\s*[-–—]\s*(.+)$/);
  if (dashMatch) {
    const [, part1, part2] = dashMatch;
    // Heuristic: if one part is much shorter, it's likely the artist
    if (part1.length < part2.length * 0.5) {
      return { song: part2.trim(), artist: part1.trim() };
    }
    return { song: part1.trim(), artist: part2.trim() };
  }

  // Try "Song by Artist" pattern
  const byMatch = cleaned.match(/^(.+?)\s+by\s+(.+)$/i);
  if (byMatch) {
    return { song: byMatch[1].trim(), artist: byMatch[2].trim() };
  }

  // Try "Song ft. Artist" or "Song feat. Artist"
  const ftMatch = cleaned.match(/^(.+?)\s+(?:ft\.?|feat\.?)\s+(.+)$/i);
  if (ftMatch) {
    return { song: ftMatch[1].trim(), artist: ftMatch[2].trim() };
  }

  // No clear pattern — just return the title as the song
  return { song: cleaned, artist: null };
}

function setCache(
  username: string,
  song: string | null,
  artist: string | null,
  game: string | null
): void {
  cache.set(username, {
    title: song,
    artist,
    game,
    timestamp: Date.now(),
  });
}
