import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

const TWITCH_GQL_URL = "https://gql.twitch.tv/gql";
const TWITCH_CLIENT_ID = "kimne78kx3ncx6brgo4mv6wki5h1ko";

interface CheckResult {
  status: "live" | "offline" | "not_found" | "error";
  username: string;
  displayName?: string;
  message: string;
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Tidak dibenarkan" }, { status: 401 });
    }

    const { username } = await request.json();

    if (!username || typeof username !== "string") {
      return NextResponse.json(
        {
          status: "error" as const,
          username: "",
          message: "Sila masukkan nama pengguna Twitch.",
        } as CheckResult,
        { status: 400 }
      );
    }

    const cleanUsername = username.trim().toLowerCase();

    // Validate format
    if (!/^[a-zA-Z0-9_]{4,25}$/.test(cleanUsername)) {
      return NextResponse.json({
        status: "not_found" as const,
        username: cleanUsername,
        message: "Format username tidak sah. Username mestilah 4-25 aksara (huruf, nombor, _).",
      } as CheckResult);
    }

    // Check via Twitch GQL API
    try {
      const response = await fetch(TWITCH_GQL_URL, {
        method: "POST",
        headers: {
          "Client-ID": TWITCH_CLIENT_ID,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: `query { user(login: "${cleanUsername}") { stream { type createdAt } displayName } }`,
        }),
        signal: AbortSignal.timeout(8000),
      });

      if (!response.ok) {
        return NextResponse.json({
          status: "error" as const,
          username: cleanUsername,
          message: "Gagal menyemak saluran Twitch. Sila cuba lagi.",
        } as CheckResult);
      }

      const data = await response.json();

      // User doesn't exist
      if (!data.data?.user) {
        return NextResponse.json({
          status: "not_found" as const,
          username: cleanUsername,
          message: `Saluran Twitch "${cleanUsername}" tidak ditemui. Sila semak semula nama pengguna.`,
        } as CheckResult);
      }

      const displayName = data.data.user.displayName || cleanUsername;

      // User exists but not streaming
      if (!data.data.user.stream) {
        return NextResponse.json({
          status: "offline" as const,
          username: cleanUsername,
          displayName,
          message: `Saluran Twitch "${displayName}" sedang offline.`,
        } as CheckResult);
      }

      // User is live
      if (data.data.user.stream.type === "live") {
        return NextResponse.json({
          status: "live" as const,
          username: cleanUsername,
          displayName,
          message: `Saluran Twitch "${displayName}" sedang live!`,
        } as CheckResult);
      }

      // Stream exists but not "live" type (rerun)
      return NextResponse.json({
        status: "offline" as const,
        username: cleanUsername,
        displayName,
        message: `Saluran Twitch "${displayName}" sedang offline.`,
      } as CheckResult);
    } catch {
      return NextResponse.json({
        status: "error" as const,
        username: cleanUsername,
        message: "Gagal menyambung ke Twitch. Sila cuba lagi.",
      } as CheckResult);
    }
  } catch {
    return NextResponse.json({
      status: "error" as const,
      username: "",
      message: "Ralat semasa menyemak saluran Twitch.",
    } as CheckResult);
  }
}
