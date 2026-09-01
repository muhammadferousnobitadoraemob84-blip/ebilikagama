import { NextRequest, NextResponse } from "next/server";
import { getYouTubeAuthUrl } from "@/lib/youtube";
import { verifyToken } from "@/lib/auth";

export const dynamic = "force-dynamic";

// GET - Generate YouTube authorization URL
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

    const state = Buffer.from(JSON.stringify({ type: "youtube", adminToken: token })).toString("base64");
    const authUrl = getYouTubeAuthUrl(undefined, state);

    return NextResponse.json({ authUrl });
  } catch (error) {
    console.error("[YOUTUBE-AUTH] Error:", error);
    return NextResponse.json({ error: "Failed to generate authorization URL" }, { status: 500 });
  }
}
