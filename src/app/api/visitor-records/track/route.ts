import { NextRequest, NextResponse } from "next/server";
import { logVisitorActivity } from "@/lib/visitor-records";

export const dynamic = "force-dynamic";

/**
 * POST /api/visitor-records/track — logs ONE meaningful visitor action.
 * The authenticated user + session are derived server-side from the JWT;
 * the client never supplies identity. Errors never block the feature.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ ok: false, reason: "bad-body" }, { status: 400 });
  }

  const result = await logVisitorActivity(request, {
    feature: typeof body.feature === "string" ? body.feature : "",
    action: typeof body.action === "string" ? body.action : "",
    page: typeof body.page === "string" ? body.page : undefined,
    metadata: body.metadata,
    vsid: typeof body.vsid === "string" ? body.vsid : null,
  });

  return NextResponse.json(result, { status: 200 });
}
