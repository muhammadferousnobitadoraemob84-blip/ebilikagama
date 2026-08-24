import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureDatabase } from "@/lib/db-init";
import crypto from "crypto";

export const dynamic = "force-dynamic";

// Generate anonymous ID from browser fingerprint + salt
function generateAnonymousId(request: NextRequest): string {
  // Use a combination of user agent and a unique salt stored in cookie
  // This creates a device-specific anonymous ID
  const userAgent = request.headers.get("user-agent") || "";
  const acceptLang = request.headers.get("accept-language") || "";
  
  // Get or create device ID from cookie
  const deviceId = request.cookies.get("ebilik_device_id")?.value || 
    crypto.randomBytes(16).toString("hex");
  
  // Create hash from device-specific info
  const hash = crypto.createHash("sha256")
    .update(`${deviceId}-${userAgent.substring(0, 100)}-${acceptLang.substring(0, 50)}`)
    .digest("hex");
  
  return hash;
}

// GET - Get subscriber count and check if this device is subscribed
export async function GET(request: NextRequest) {
  try {
    await ensureDatabase();

    const anonymousId = generateAnonymousId(request);

    // Get total active subscriber count
    const count = await prisma.subscriber.count({
      where: { active: true },
    });

    // Check if this anonymous ID is already subscribed
    const subscriber = await prisma.subscriber.findUnique({
      where: { anonymousId },
    });

    const isSubscribed = subscriber?.active ?? false;

    const response = NextResponse.json({
      count,
      isSubscribed,
    });

    // Set device ID cookie if not present
    if (!request.cookies.get("ebilik_device_id")) {
      const deviceId = crypto.randomBytes(16).toString("hex");
      response.cookies.set("ebilik_device_id", deviceId, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 60 * 60 * 24 * 365 * 2, // 2 years
        path: "/",
      });
    }

    return response;
  } catch (error) {
    console.error("[SUBSCRIBE] GET error:", error);
    return NextResponse.json({ count: 0, isSubscribed: false }, { status: 500 });
  }
}

// POST - Subscribe (one-click, no email required)
export async function POST(request: NextRequest) {
  try {
    await ensureDatabase();

    const anonymousId = generateAnonymousId(request);

    // Check if already subscribed
    const existing = await prisma.subscriber.findUnique({
      where: { anonymousId },
    });

    if (existing && existing.active) {
      return NextResponse.json({
        message: "Anda telah melanggan",
        alreadySubscribed: true,
      });
    }

    if (existing && !existing.active) {
      // Reactivate if previously unsubscribed
      await prisma.subscriber.update({
        where: { anonymousId },
        data: { active: true },
      });
    } else {
      // Create new subscriber
      await prisma.subscriber.create({
        data: {
          anonymousId,
        },
      });
    }

    // Get updated count
    const count = await prisma.subscriber.count({
      where: { active: true },
    });

    const response = NextResponse.json({
      success: true,
      message: "Berjaya melanggan!",
      count,
    });

    // Set device ID cookie if not present
    if (!request.cookies.get("ebilik_device_id")) {
      const deviceId = crypto.randomBytes(16).toString("hex");
      response.cookies.set("ebilik_device_id", deviceId, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 60 * 60 * 24 * 365 * 2, // 2 years
        path: "/",
      });
    }

    return response;
  } catch (error) {
    console.error("[SUBSCRIBE] POST error:", error);
    return NextResponse.json(
      { error: "Ralat pelayan. Sila cuba lagi." },
      { status: 500 }
    );
  }
}
