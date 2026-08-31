import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { ensureDatabase } from "@/lib/db-init";

export const dynamic = "force-dynamic";

// Keys that may contain base64 image data
const IMAGE_KEYS = new Set(["site_logo", "hero_image"]);

// All known settings keys — used to backfill missing keys on GET
const ALL_SETTINGS_KEYS = [
  "site_name", "site_logo", "hero_title", "hero_description", "hero_image",
  "saluran_tv_title", "saluran_khas_title",
  "footer_text", "contact_email",
  "social_facebook", "social_twitter", "social_youtube", "social_instagram", "social_tiktok",
];

let _backfilled = false;

// GET all settings (public)
export async function GET() {
  try {
    await ensureDatabase();
    const settings = await prisma.setting.findMany({
      select: { key: true, value: true },
    });
    const settingsMap: Record<string, string> = {};
    settings.forEach((s) => {
      // Replace base64 image data with API URLs to avoid huge responses
      if (IMAGE_KEYS.has(s.key) && s.value.startsWith("data:")) {
        settingsMap[s.key] = `/api/images/setting/${s.key}`;
      } else {
        settingsMap[s.key] = s.value;
      }
    });

    // Backfill missing settings keys (runs once per server instance)
    if (!_backfilled) {
      _backfilled = true;
      const existingKeys = new Set(settings.map((s) => s.key));
      const missing = ALL_SETTINGS_KEYS.filter((k) => !existingKeys.has(k));
      if (missing.length > 0) {
        await Promise.all(
          missing.map((key) =>
            prisma.setting.upsert({
              where: { key },
              update: {},
              create: { key, value: "" },
            })
          )
        );
        // Add to the response map
        missing.forEach((key) => {
          settingsMap[key] = "";
        });
      }
    }

    return NextResponse.json(settingsMap);
  } catch {
    return NextResponse.json(
      { error: "Gagal memuatkan tetapan" },
      { status: 500 }
    );
  }
}

// PUT update settings (admin only)
export async function PUT(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Tidak dibenarkan" }, { status: 401 });
    }

    const body = await request.json();
    const updates = Object.entries(body);

    for (const [key, value] of updates) {
      await prisma.setting.upsert({
        where: { key },
        update: { value: String(value) },
        create: { key, value: String(value) },
      });
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { error: "Gagal mengemas kini tetapan" },
      { status: 500 }
    );
  }
}
