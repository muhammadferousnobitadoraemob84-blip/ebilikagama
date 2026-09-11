import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureDatabase } from "@/lib/db-init";
import { verifyToken, isAdminRole } from "@/lib/auth";

export const dynamic = "force-dynamic";

// GET - Check Google Drive connection status
export async function GET(request: NextRequest) {
  try {
    await ensureDatabase();

    // Verify admin authentication
    const token = request.cookies.get("admin-token")?.value;
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const gdriveSession = await verifyToken(token);
    if (!gdriveSession || !isAdminRole(gdriveSession.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Check connection status
    const connectedRecord = await prisma.setting.findUnique({
      where: { key: "google_drive_connected" },
    });

    const emailRecord = await prisma.setting.findUnique({
      where: { key: "google_drive_email" },
    });

    return NextResponse.json({
      connected: connectedRecord?.value === "true",
      email: emailRecord?.value || null,
    });
  } catch (error) {
    console.error("[GOOGLE-DRIVE-STATUS] Error:", error);
    return NextResponse.json(
      { connected: false, email: null },
      { status: 200 }
    );
  }
}
