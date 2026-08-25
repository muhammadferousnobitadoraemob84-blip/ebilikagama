import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ensureDatabase } from "@/lib/db-init";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Tidak dibenarkan" }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get("file") as File;
    const purpose = formData.get("purpose") as string; // e.g. "site_logo", "hero_image", "channel_thumbnail"
    const targetId = formData.get("targetId") as string; // e.g. channel ID for channel thumbnails

    if (!file) {
      return NextResponse.json(
        { error: "Tiada fail dihantar" },
        { status: 400 }
      );
    }

    // Validate file type
    const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json(
        { error: "Jenis fail tidak dibenarkan. Gunakan JPG, PNG, atau WebP." },
        { status: 400 }
      );
    }

    // Validate file size (5MB max)
    if (file.size > 5 * 1024 * 1024) {
      return NextResponse.json(
        { error: "Saiz fail melebihi 5MB" },
        { status: 400 }
      );
    }

    // Convert to base64 data URL
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const base64 = buffer.toString("base64");
    const dataUrl = `data:${file.type};base64,${base64}`;

    // Save directly to the database based on purpose
    await ensureDatabase();

    if (purpose === "site_logo" || purpose === "hero_image") {
      // Save directly to settings table
      await prisma.setting.upsert({
        where: { key: purpose },
        update: { value: dataUrl },
        create: { key: purpose, value: dataUrl },
      });
      // Return the API URL that serves this image (not the huge base64)
      return NextResponse.json({
        url: `/api/images/setting/${purpose}`,
        saved: true,
      });
    } else if (purpose === "channel_thumbnail" && targetId) {
      // Save to channel thumbnail
      await prisma.channel.update({
        where: { id: targetId },
        data: { thumbnail: dataUrl },
      });
      return NextResponse.json({
        url: `/api/images/channel/${targetId}`,
        saved: true,
      });
    } else if (purpose === "replay_thumbnail" && targetId) {
      // Save to replay thumbnail
      await prisma.replay.update({
        where: { id: targetId },
        data: { thumbnail: dataUrl },
      });
      return NextResponse.json({
        url: dataUrl,
        saved: true,
      });
    } else if (purpose === "profile_photo") {
      // Save to admin profile photo
      const userId = session.userId || session.sub;
      if (userId) {
        await prisma.user.update({
          where: { id: userId },
          data: { profilePhoto: dataUrl },
        });
      }
      return NextResponse.json({
        url: dataUrl,
        saved: true,
      });
    }

    // Default: return data URL (for backward compatibility)
    return NextResponse.json({
      url: dataUrl,
      saved: false,
    });
  } catch (error) {
    console.error("[UPLOAD] Error:", error);
    return NextResponse.json(
      { error: "Gagal memuat naik fail" },
      { status: 500 }
    );
  }
}
