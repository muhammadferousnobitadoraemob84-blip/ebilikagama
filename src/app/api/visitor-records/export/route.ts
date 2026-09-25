import { NextRequest, NextResponse } from "next/server";
import { prisma, withRetry } from "@/lib/prisma";
import { ensureDatabase } from "@/lib/db-init";
import { getAdminSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

const CSV_HEADERS = [
  "Date",
  "Time",
  "User ID",
  "Full Name",
  "Username",
  "Role",
  "Feature",
  "Action",
  "Page",
  "Session ID",
];

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * GET /api/visitor-records/export — ADMIN ONLY.
 * Streams the currently filtered records as CSV (spec §16). Same filter
 * contract as the list endpoint; hard cap of 10,000 rows per export.
 */
export async function GET(request: NextRequest) {
  const admin = await getAdminSession();
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await ensureDatabase();

  const sp = request.nextUrl.searchParams;
  const from = sp.get("from");
  const to = sp.get("to");
  const userId = sp.get("userId") ?? "";
  const role = sp.get("role") ?? "";
  const feature = sp.get("feature") ?? "";
  const action = sp.get("action") ?? "";
  const sessionId = sp.get("sessionId") ?? "";
  const search = (sp.get("search") ?? "").trim();
  const sort = sp.get("sort") === "oldest" ? "oldest" : "newest";

  const activityWhere: Record<string, unknown> = {};
  if (from || to) {
    activityWhere.createdAt = {
      ...(from ? { gte: new Date(`${from}T00:00:00`) } : {}),
      ...(to ? { lte: new Date(`${to}T23:59:59.999`) } : {}),
    };
  }
  if (feature) activityWhere.feature = feature;
  if (action) activityWhere.action = action;
  if (sessionId) activityWhere.sessionId = sessionId;

  const userWhere: Record<string, unknown> = {};
  if (userId) userWhere.id = userId;
  if (role) userWhere.role = role;
  if (Object.keys(userWhere).length > 0) activityWhere.user = userWhere;
  if (search) {
    // Same combined-OR contract as the list endpoint (spec §8).
    activityWhere.OR = [
      { user: { id: { contains: search, mode: "insensitive" } } },
      { user: { fullName: { contains: search, mode: "insensitive" } } },
      { user: { username: { contains: search, mode: "insensitive" } } },
      { sessionId: { contains: search, mode: "insensitive" } },
      { feature: { contains: search, mode: "insensitive" } },
      { action: { contains: search, mode: "insensitive" } },
    ];
  }

  const rows = await withRetry(() =>
    prisma.visitorActivity.findMany({
      where: activityWhere,
      include: {
        user: { select: { id: true, username: true, fullName: true, role: true } },
      },
      orderBy: { createdAt: sort === "newest" ? "desc" : "asc" },
      take: 10_000,
    })
  );

  const lines = [CSV_HEADERS.join(",")];
  for (const r of rows) {
    const d = r.createdAt;
    // Split into date/time per the spec's table columns.
    const date = `${String(d.getDate()).padStart(2, "0")}/${String(
      d.getMonth() + 1
    ).padStart(2, "0")}/${d.getFullYear()}`;
    const time = d.toTimeString().slice(0, 8);
    lines.push(
      [
        date,
        time,
        csvEscape(r.user.id),
        csvEscape(r.user.fullName ?? ""),
        csvEscape(r.user.username),
        csvEscape(r.user.role),
        csvEscape(r.feature),
        csvEscape(r.action),
        csvEscape(r.page ?? ""),
        csvEscape(r.sessionId),
      ].join(",")
    );
  }

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(`\uFEFF${lines.join("\r\n")}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="visitor-records-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
