import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureDatabase } from "@/lib/db-init";
import crypto from "crypto";

export const dynamic = "force-dynamic";

// GET - Get subscriber count and check if this device is subscribed
export async function GET(request: NextRequest) {
  try {
    await ensureDatabase();

    // Get device ID from cookie or create new one
    let deviceId = request.cookies.get("ebilik_device_id")?.value;
    
    // Get total active subscriber count
    const count = await prisma.subscriber.count({
      where: { active: true },
    });

    let isSubscribed = false;

    // If we have a device ID, check if subscribed
    if (deviceId) {
      const subscriber = await prisma.subscriber.findUnique({
        where: { anonymousId: deviceId },
      });
      isSubscribed = subscriber?.active ?? false;
    }

    const response = NextResponse.json({
      count,
      isSubscribed,
    });

    // Set device ID cookie if not present
    if (!deviceId) {
      const newDeviceId = crypto.randomUUID();
      response.cookies.set("ebilik_device_id", newDeviceId, {
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
    // Return count 0 on error so page still renders
    return NextResponse.json({ count: 0, isSubscribed: false }, { status: 200 });
  }
}

// POST - Subscribe (one-click, no email required)
export async function POST(request: NextRequest) {
  try {
    await ensureDatabase();

    // Get or create device ID
    let deviceId = request.cookies.get("ebilik_device_id")?.value;
    
    if (!deviceId) {
      // Create new device ID
      deviceId = crypto.randomUUID();
    }

    console.log("[SUBSCRIBE] Attempting subscription for device:", deviceId);

    // Check if already subscribed
    let existing;
    try {
      existing = await prisma.subscriber.findUnique({
        where: { anonymousId: deviceId },
      });
    } catch (findErr) {
      console.error("[SUBSCRIBE] Find error:", findErr);
      // If find fails, table might not exist properly, try to continue
      existing = null;
    }

    if (existing && existing.active) {
      console.log("[SUBSCRIBE] Already subscribed");
      const count = await prisma.subscriber.count({ where: { active: true } });
      return NextResponse.json({
        success: true,
        message: "Anda telah melanggan",
        alreadySubscribed: true,
        count,
      });
    }

    // Create or reactivate subscription
    try {
      if (existing && !existing.active) {
        // Reactivate if previously unsubscribed
        await prisma.subscriber.update({
          where: { anonymousId: deviceId },
          data: { active: true },
        });
        console.log("[SUBSCRIBE] Reactivated subscription");
      } else {
        // Create new subscriber
        await prisma.subscriber.create({
          data: {
            anonymousId: deviceId,
          },
        });
        console.log("[SUBSCRIBE] Created new subscription");
      }
    } catch (createErr) {
      console.error("[SUBSCRIBE] Create/update error:", createErr);
      return NextResponse.json(
        { error: "Gagal menyimpan langganan. Sila cuba lagi." },
        { status: 500 }
      );
    }

    // Get updated count
    const count = await prisma.subscriber.count({
      where: { active: true },
    });

    console.log("[SUBSCRIBE] Success! New count:", count);

    const response = NextResponse.json({
      success: true,
      message: "Berjaya melanggan!",
      count,
    });

    // Set device ID cookie if not present
    if (!request.cookies.get("ebilik_device_id")) {
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
