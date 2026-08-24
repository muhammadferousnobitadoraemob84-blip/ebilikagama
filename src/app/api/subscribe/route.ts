import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureDatabase } from "@/lib/db-init";

export const dynamic = "force-dynamic";

// GET - Get subscriber count and check if email is subscribed
export async function GET(request: NextRequest) {
  try {
    await ensureDatabase();

    const { searchParams } = new URL(request.url);
    const email = searchParams.get("email");

    // Get total active subscriber count
    const count = await prisma.subscriber.count({
      where: { active: true },
    });

    // If email provided, check if already subscribed
    let isSubscribed = false;
    if (email) {
      const subscriber = await prisma.subscriber.findUnique({
        where: { email },
      });
      isSubscribed = subscriber?.active ?? false;
    }

    return NextResponse.json({
      count,
      isSubscribed,
    });
  } catch (error) {
    console.error("[SUBSCRIBE] GET error:", error);
    return NextResponse.json({ count: 0, isSubscribed: false }, { status: 500 });
  }
}

// POST - Subscribe
export async function POST(request: NextRequest) {
  try {
    await ensureDatabase();

    const { email, name } = await request.json();

    if (!email || typeof email !== "string") {
      return NextResponse.json(
        { error: "Email diperlukan" },
        { status: 400 }
      );
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { error: "Format email tidak sah" },
        { status: 400 }
      );
    }

    // Check if already subscribed
    const existing = await prisma.subscriber.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (existing) {
      if (existing.active) {
        return NextResponse.json(
          { message: "Anda telah melanggan", alreadySubscribed: true },
          { status: 200 }
        );
      }
      // Reactivate if previously unsubscribed
      await prisma.subscriber.update({
        where: { email: email.toLowerCase() },
        data: { active: true },
      });
    } else {
      // Create new subscriber
      await prisma.subscriber.create({
        data: {
          email: email.toLowerCase(),
          name: name || null,
        },
      });
    }

    // Get updated count
    const count = await prisma.subscriber.count({
      where: { active: true },
    });

    return NextResponse.json({
      success: true,
      message: "Berjaya melanggan!",
      count,
    });
  } catch (error) {
    console.error("[SUBSCRIBE] POST error:", error);
    return NextResponse.json(
      { error: "Ralat pelayan. Sila cuba lagi." },
      { status: 500 }
    );
  }
}

// DELETE - Unsubscribe
export async function DELETE(request: NextRequest) {
  try {
    await ensureDatabase();

    const { email } = await request.json();

    if (!email || typeof email !== "string") {
      return NextResponse.json(
        { error: "Email diperlukan" },
        { status: 400 }
      );
    }

    const existing = await prisma.subscriber.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (!existing || !existing.active) {
      return NextResponse.json(
        { error: "Anda belum melanggan" },
        { status: 404 }
      );
    }

    // Soft delete - mark as inactive
    await prisma.subscriber.update({
      where: { email: email.toLowerCase() },
      data: { active: false },
    });

    const count = await prisma.subscriber.count({
      where: { active: true },
    });

    return NextResponse.json({
      success: true,
      message: "Berjaya berhenti melanggan",
      count,
    });
  } catch (error) {
    console.error("[SUBSCRIBE] DELETE error:", error);
    return NextResponse.json(
      { error: "Ralat pelayan. Sila cuba lagi." },
      { status: 500 }
    );
  }
}
