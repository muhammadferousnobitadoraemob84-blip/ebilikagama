import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/auth";
import { getVirtualRadioState, saveRadioFolder, setRadioEnabled } from "@/lib/virtual-radio-store";

export const dynamic = "force-dynamic";

// GET — full config for the admin page (same state as status; admin page
// re-fetches to show folder/scan metadata immediately).
export async function GET() {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const state = await getVirtualRadioState();
  return NextResponse.json(state, {
    headers: { "Cache-Control": "no-store" },
  });
}

// POST — admin actions:
//   { enabled: boolean }            → enable/disable the radio
//   { folderId, folderName? }       → set the Drive library folder
export async function POST(request: NextRequest) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const body = await request.json().catch(() => ({}));

    if (typeof body.enabled === "boolean") {
      await setRadioEnabled(body.enabled);
      return NextResponse.json({ success: true, enabled: body.enabled });
    }

    if (typeof body.folderId === "string" && body.folderId.trim()) {
      const folderId = body.folderId.trim();
      // Sanity-check the folder exists & is a folder before saving.
      const { getValidDriveToken } = await import("@/lib/google-drive");
      const token = await getValidDriveToken();
      if (!token) {
        return NextResponse.json(
          { error: "Google Drive is not connected. Connect it first (Live Replay / Quran settings)." },
          { status: 400 }
        );
      }
      const res = await fetch(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folderId)}?fields=id,name,mimeType`,
        { headers: { Authorization: `Bearer ${token.accessToken}` } }
      );
      if (!res.ok) {
        return NextResponse.json(
          { error: "Folder not found or not accessible with the connected Drive account." },
          { status: 400 }
        );
      }
      const meta = await res.json();
      if (meta.mimeType !== "application/vnd.google-apps.folder") {
        return NextResponse.json({ error: "That Drive ID is a file, not a folder." }, { status: 400 });
      }

      await saveRadioFolder(meta.id, meta.name || null);
      return NextResponse.json({ success: true, folderId: meta.id, folderName: meta.name || null });
    }

    return NextResponse.json({ error: "Nothing to do" }, { status: 400 });
  } catch (err) {
    console.error(
      "[VIRTUAL-RADIO-CONFIG] error:",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json({ error: "Failed to update configuration" }, { status: 500 });
  }
}
