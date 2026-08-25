import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma, withRetry } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const maxDuration = 30; // 30 seconds for file upload processing

// Max file sizes
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      console.error("[UPLOAD] No session - unauthorized");
      return NextResponse.json({ error: "Tidak dibenarkan" }, { status: 401 });
    }

    console.log("[UPLOAD] Authenticated user:", session.userId || session.sub);

    const formData = await request.formData();
    const file = formData.get("file") as File;
    const purpose = formData.get("purpose") as string;
    const targetId = formData.get("targetId") as string;

    console.log("[UPLOAD] Purpose:", purpose, "TargetId:", targetId, "File:", file?.name, "Size:", file?.size, "Type:", file?.type);

    if (!file) {
      return NextResponse.json({ error: "Tiada fail dihantar" }, { status: 400 });
    }

    // Validate file type
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      console.error("[UPLOAD] Invalid file type:", file.type);
      return NextResponse.json(
        { error: "Jenis fail tidak dibenarkan. Gunakan JPG, PNG, atau WebP." },
        { status: 400 }
      );
    }

    // Validate file size
    if (file.size > MAX_IMAGE_SIZE) {
      console.error("[UPLOAD] File too large:", file.size);
      return NextResponse.json({ error: "Saiz fail melebihi 5MB" }, { status: 400 });
    }

    // Convert to base64 data URL
    console.log("[UPLOAD] Converting file to base64...");
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const base64 = buffer.toString("base64");
    const dataUrl = `data:${file.type};base64,${base64}`;
    console.log("[UPLOAD] Base64 length:", base64.length);

    // Save to database based on purpose — with retry logic for Neon cold starts
    if (purpose === "site_logo" || purpose === "hero_image") {
      console.log("[UPLOAD] Saving setting:", purpose);
      await withRetry(() =>
        prisma.setting.upsert({
          where: { key: purpose },
          update: { value: dataUrl },
          create: { key: purpose, value: dataUrl },
        })
      );

      // Verify the save
      const verify = await withRetry(() =>
        prisma.setting.findUnique({
          where: { key: purpose },
          select: { value: true },
        })
      );
      if (!verify || !verify.value || !verify.value.startsWith("data:")) {
        console.error("[UPLOAD] Setting save verification failed for:", purpose);
        return NextResponse.json(
          { error: "Gagal menyimpan gambar ke database" },
          { status: 500 }
        );
      }

      console.log("[UPLOAD] Setting saved and verified:", purpose);
      return NextResponse.json({ url: `/api/images/setting/${purpose}`, saved: true });
    }

    if (purpose === "channel_thumbnail") {
      if (!targetId) {
        console.error("[UPLOAD] channel_thumbnail missing targetId");
        return NextResponse.json({ error: "ID saluran diperlukan" }, { status: 400 });
      }

      console.log("[UPLOAD] Saving channel thumbnail for:", targetId);

      // Verify channel exists
      const channel = await withRetry(() =>
        prisma.channel.findUnique({
          where: { id: targetId },
          select: { id: true },
        })
      );
      if (!channel) {
        console.error("[UPLOAD] Channel not found:", targetId);
        return NextResponse.json({ error: "Saluran tidak dijumpai" }, { status: 404 });
      }

      // Save thumbnail with retry
      await withRetry(() =>
        prisma.channel.update({
          where: { id: targetId },
          data: { thumbnail: dataUrl },
        })
      );

      // Verify the save persisted
      const verify = await withRetry(() =>
        prisma.channel.findUnique({
          where: { id: targetId },
          select: { thumbnail: true },
        })
      );
      if (!verify || !verify.thumbnail || !verify.thumbnail.startsWith("data:")) {
        console.error("[UPLOAD] Channel thumbnail save verification failed for:", targetId, "Got:", verify?.thumbnail?.substring(0, 50));
        return NextResponse.json(
          { error: "Gagal menyimpan gambar saluran ke database" },
          { status: 500 }
        );
      }

      console.log("[UPLOAD] Channel thumbnail saved and verified:", targetId);
      return NextResponse.json({ url: `/api/images/channel/${targetId}`, saved: true });
    }

    if (purpose === "replay_thumbnail") {
      if (!targetId) {
        return NextResponse.json({ error: "ID replay diperlukan" }, { status: 400 });
      }

      console.log("[UPLOAD] Saving replay thumbnail for:", targetId);
      await withRetry(() =>
        prisma.replay.update({
          where: { id: targetId },
          data: { thumbnail: dataUrl },
        })
      );
      return NextResponse.json({ url: `/api/images/channel/${targetId}`, saved: true });
    }

    if (purpose === "profile_photo") {
      const userId = session.userId || session.sub;
      if (userId) {
        console.log("[UPLOAD] Saving profile photo for user:", userId);
        await withRetry(() =>
          prisma.user.update({
            where: { id: userId },
            data: { profilePhoto: dataUrl },
          })
        );
      }
      return NextResponse.json({ url: dataUrl, saved: true });
    }

    // Unknown purpose — still save as a setting fallback
    console.warn("[UPLOAD] Unknown purpose:", purpose, "- returning data URL directly");
    return NextResponse.json({ url: dataUrl, saved: false });
  } catch (error) {
    // Log the ACTUAL error so we can diagnose it
    const msg = error instanceof Error ? error.message : "Unknown error";
    const stack = error instanceof Error ? error.stack : "";
    console.error("[UPLOAD] FATAL ERROR:", msg);
    console.error("[UPLOAD] Stack:", stack?.substring(0, 500));
    return NextResponse.json(
      { error: "Gagal memuat naik fail: " + msg },
      { status: 500 }
    );
  }
}
