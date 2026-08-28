import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma, withRetry } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const maxDuration = 30; // 30 seconds for file upload processing

// Max file sizes — Vercel Blob handles large files (up to 20MB).
// Legacy route stays as fallback; Vercel serverless limit is ~4.5MB.
const MAX_IMAGE_SIZE = 4 * 1024 * 1024; // 4MB (safe under Vercel 4.5MB limit for legacy fallback)
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

// Extract image dimensions from buffer without any dependencies
function getImageDimensions(buffer: Buffer): { width: number; height: number } | null {
  try {
    // PNG: signature(8) + IHDR chunk length(4) + 'IHDR'(4) + width(4) + height(4)
    if (buffer.length > 24 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
      const width = buffer.readUInt32BE(16);
      const height = buffer.readUInt32BE(20);
      return { width, height };
    }
    // JPEG: find SOF marker
    let i = 2;
    while (i < buffer.length - 9) {
      if (buffer[i] === 0xFF) {
        const marker = buffer[i + 1];
        if (marker === 0xC0 || marker === 0xC1 || marker === 0xC2) {
          const height = buffer.readUInt16BE(i + 5);
          const width = buffer.readUInt16BE(i + 7);
          return { width, height };
        }
        const segmentLength = buffer.readUInt16BE(i + 2);
        i += 2 + segmentLength;
      } else {
        i++;
      }
    }
    return null;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      console.error("[UPLOAD] No session - unauthorized");
      return NextResponse.json({ error: "Tidak dibenarkan" }, { status: 401 });
    }

    console.log("[UPLOAD] Authenticated user:", session.userId);

    const formData = await request.formData();
    const file = formData.get("file") as File;
    const purpose = formData.get("purpose") as string;
    const targetId = (formData.get("targetId") as string) || "";

    console.log("[UPLOAD v2] Purpose:", purpose, "TargetId:", targetId || "(empty)", "File:", file?.name, "Size:", file?.size, "Type:", file?.type);

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

    // Validate minimum image dimensions to prevent corrupted/tiny images
    const dims = getImageDimensions(buffer);
    if (dims) {
      const MIN_DIMENSION = 50;
      if (dims.width < MIN_DIMENSION || dims.height < MIN_DIMENSION) {
        console.error("[UPLOAD] Image too small:", dims.width, "x", dims.height);
        return NextResponse.json(
          { error: `Gambar terlalu kecil (${dims.width}x${dims.height}px). Saiz minimum ialah ${MIN_DIMENSION}x${MIN_DIMENSION}px.` },
          { status: 400 }
        );
      }
      console.log("[UPLOAD] Image dimensions:", dims.width, "x", dims.height);
    }

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
      return NextResponse.json({ url: `/api/images/replay/${targetId}`, saved: true });
    }

    if (purpose === "radio_thumbnail") {
      if (!targetId) {
        return NextResponse.json({ error: "ID radio diperlukan" }, { status: 400 });
      }

      console.log("[UPLOAD] Saving radio thumbnail for:", targetId);

      const radio = await withRetry(() =>
        prisma.radio.findUnique({ where: { id: targetId }, select: { id: true } })
      );
      if (!radio) {
        return NextResponse.json({ error: "Radio tidak dijumpai" }, { status: 404 });
      }

      await withRetry(() =>
        prisma.radio.update({ where: { id: targetId }, data: { thumbnail: dataUrl } })
      );

      const verify = await withRetry(() =>
        prisma.radio.findUnique({ where: { id: targetId }, select: { thumbnail: true } })
      );
      if (!verify || !verify.thumbnail || !verify.thumbnail.startsWith("data:")) {
        console.error("[UPLOAD] Radio thumbnail save verification failed for:", targetId);
        return NextResponse.json(
          { error: "Gagal menyimpan gambar radio ke database" },
          { status: 500 }
        );
      }

      console.log("[UPLOAD] Radio thumbnail saved and verified:", targetId);
      return NextResponse.json({ url: `/api/images/radio/${targetId}`, saved: true });
    }

    if (purpose === "profile_photo") {
      const userId = session.userId;
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
