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
    const purpose = formData.get("purpose") as string;
    const targetId = formData.get("targetId") as string;

    if (!file) {
      return NextResponse.json({ error: "Tiada fail dihantar" }, { status: 400 });
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
      return NextResponse.json({ error: "Saiz fail melebihi 5MB" }, { status: 400 });
    }

    // Convert to base64 data URL
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const base64 = buffer.toString("base64");
    const dataUrl = `data:${file.type};base64,${base64}`;

    // Ensure database is ready
    await ensureDatabase();

    // Save to database based on purpose
    if (purpose === "site_logo" || purpose === "hero_image") {
      await prisma.setting.upsert({
        where: { key: purpose },
        update: { value: dataUrl },
        create: { key: purpose, value: dataUrl },
      });

      // Verify the save actually worked
      const verify = await prisma.setting.findUnique({
        where: { key: purpose },
        select: { value: true },
      });
      if (!verify || !verify.value.startsWith("data:")) {
        return NextResponse.json(
          { error: "Gagal menyimpan gambar ke database" },
          { status: 500 }
        );
      }

      return NextResponse.json({ url: `/api/images/setting/${purpose}`, saved: true });
    }

    if (purpose === "channel_thumbnail" && targetId) {
      // Verify channel exists first
      const channel = await prisma.channel.findUnique({
        where: { id: targetId },
        select: { id: true },
      });
      if (!channel) {
        return NextResponse.json({ error: "Saluran tidak dijumpai" }, { status: 404 });
      }

      await prisma.channel.update({
        where: { id: targetId },
        data: { thumbnail: dataUrl },
      });

      // Verify the save actually worked
      const verify = await prisma.channel.findUnique({
        where: { id: targetId },
        select: { thumbnail: true },
      });
      if (!verify || !verify.thumbnail || !verify.thumbnail.startsWith("data:")) {
        return NextResponse.json(
          { error: "Gagal menyimpan gambar saluran ke database" },
          { status: 500 }
        );
      }

      return NextResponse.json({ url: `/api/images/channel/${targetId}`, saved: true });
    }

    if (purpose === "replay_thumbnail" && targetId) {
      await prisma.replay.update({
        where: { id: targetId },
        data: { thumbnail: dataUrl },
      });
      return NextResponse.json({ url: dataUrl, saved: true });
    }

    if (purpose === "profile_photo") {
      const userId = session.userId || session.sub;
      if (userId) {
        await prisma.user.update({
          where: { id: userId },
          data: { profilePhoto: dataUrl },
        });
      }
      return NextResponse.json({ url: dataUrl, saved: true });
    }

    // Default fallback
    return NextResponse.json({ url: dataUrl, saved: false });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[UPLOAD] Error:", msg);
    return NextResponse.json(
      { error: "Gagal memuat naik fail: " + msg },
      { status: 500 }
    );
  }
}
