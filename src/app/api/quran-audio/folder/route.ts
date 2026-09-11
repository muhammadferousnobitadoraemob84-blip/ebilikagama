import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/auth";
import { prisma, withRetry } from "@/lib/prisma";
import { getValidDriveToken } from "@/lib/google-drive";

export const dynamic = "force-dynamic";

// GET — Get the currently configured Quran Audio Google Drive settings
export async function GET() {
  try {
    const session = await getAdminSession();
    if (!session) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const [folderRecord, emailRecord, connectedRecord, qariRecord, lastSyncRecord] = await Promise.all([
      withRetry(() => prisma.setting.findUnique({ where: { key: "quran_audio_folder_id" } })),
      withRetry(() => prisma.setting.findUnique({ where: { key: "google_drive_email" } })),
      withRetry(() => prisma.setting.findUnique({ where: { key: "google_drive_connected" } })),
      withRetry(() => prisma.setting.findUnique({ where: { key: "quran_audio_qari" } })),
      withRetry(() => prisma.setting.findUnique({ where: { key: "quran_audio_last_sync" } })),
    ]);

    // Try to get folder name if we have a folder ID
    let folderName = "";
    if (folderRecord?.value) {
      const token = await getValidDriveToken();
      if (token) {
        try {
          const response = await fetch(
            `https://www.googleapis.com/drive/v3/files/${folderRecord.value}?fields=name`,
            {
              headers: {
                Authorization: `Bearer ${token.accessToken}`,
              },
            }
          );
          if (response.ok) {
            const data = await response.json();
            folderName = data.name || "";
          }
        } catch {
          // Ignore
        }
      }
    }

    return NextResponse.json({
      connected: connectedRecord?.value === "true",
      email: emailRecord?.value || null,
      folderId: folderRecord?.value || null,
      folderName,
      qari: qariRecord?.value || "",
      lastSync: lastSyncRecord?.value || null,
    });
  } catch (error) {
    console.error("[QURAN-FOLDER] GET error:", error);
    return NextResponse.json(
      { connected: false, folderId: null, folderName: "", qari: "", lastSync: null },
      { status: 200 }
    );
  }
}

// POST — Save the Quran Audio configuration (folder + qari) together
export async function POST(request: NextRequest) {
  try {
    const session = await getAdminSession();
    if (!session) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { folderId, folderName, qari } = await request.json();

    if (!folderId) {
      return NextResponse.json({ error: "Missing folderId" }, { status: 400 });
    }

    if (!qari?.trim()) {
      return NextResponse.json({ error: "Missing qari name" }, { status: 400 });
    }

    // Verify the folder exists and is accessible
    const token = await getValidDriveToken();
    if (!token) {
      return NextResponse.json(
        { error: "Google Drive is not connected." },
        { status: 400 }
      );
    }

    try {
      const verifyResponse = await fetch(
        `https://www.googleapis.com/drive/v3/files/${folderId}?fields=id,name,mimeType`,
        {
          headers: {
            Authorization: `Bearer ${token.accessToken}`,
          },
        }
      );

      if (!verifyResponse.ok) {
        return NextResponse.json(
          { error: "Could not access the selected folder. Please check your permissions." },
          { status: 400 }
        );
      }

      const verifyData = await verifyResponse.json();
      if (verifyData.mimeType !== "application/vnd.google-apps.folder") {
        return NextResponse.json(
          { error: "The selected item is not a folder." },
          { status: 400 }
        );
      }
    } catch {
      return NextResponse.json(
        { error: "Failed to verify folder access." },
        { status: 500 }
      );
    }

    // Save all settings atomically
    await Promise.all([
      withRetry(() =>
        prisma.setting.upsert({
          where: { key: "quran_audio_folder_id" },
          update: { value: folderId },
          create: { key: "quran_audio_folder_id", value: folderId },
        })
      ),
      withRetry(() =>
        prisma.setting.upsert({
          where: { key: "quran_audio_folder_name" },
          update: { value: folderName || "" },
          create: { key: "quran_audio_folder_name", value: folderName || "" },
        })
      ),
      withRetry(() =>
        prisma.setting.upsert({
          where: { key: "quran_audio_qari" },
          update: { value: qari.trim() },
          create: { key: "quran_audio_qari", value: qari.trim() },
        })
      ),
    ]);

    return NextResponse.json({
      success: true,
      folderId,
      folderName: folderName || "",
      qari: qari.trim(),
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[QURAN-FOLDER] POST error:", msg);
    return NextResponse.json({ error: "Failed to save: " + msg }, { status: 500 });
  }
}

// DELETE — Remove the configured folder and qari (disconnect)
export async function DELETE() {
  try {
    const session = await getAdminSession();
    if (!session) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    await withRetry(() =>
      prisma.setting.deleteMany({
        where: {
          key: {
            in: [
              "quran_audio_folder_id",
              "quran_audio_folder_name",
              "quran_audio_qari",
              "quran_audio_last_sync",
            ],
          },
        },
      })
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[QURAN-FOLDER] DELETE error:", msg);
    return NextResponse.json({ error: "Failed to disconnect: " + msg }, { status: 500 });
  }
}
