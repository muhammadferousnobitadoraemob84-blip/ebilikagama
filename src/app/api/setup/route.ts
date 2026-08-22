import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function POST() {
  const results: { step: string; status: string; detail?: string }[] = [];

  // Step 1: Check DATABASE_URL
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({
      status: "error",
      message: "DATABASE_URL is not set in Vercel environment variables.",
      instructions: "Go to Vercel → Settings → Environment Variables → Add DATABASE_URL",
    });
  }

  results.push({
    step: "DATABASE_URL",
    status: "configured",
    detail: `Provider: ${process.env.DATABASE_URL.split(":")[0]}`,
  });

  // Step 2: Push schema
  try {
    const { execSync } = await import("child_process");
    execSync("npx prisma db push --skip-generate --accept-data-loss", {
      timeout: 60000,
      stdio: "pipe",
      cwd: process.cwd(),
    });
    results.push({ step: "prisma db push", status: "success" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    results.push({ step: "prisma db push", status: "failed", detail: msg });
    return NextResponse.json({ status: "partial", results });
  }

  // Step 3: Seed
  try {
    const { execSync } = await import("child_process");
    execSync("npx tsx prisma/seed.ts", {
      timeout: 60000,
      stdio: "pipe",
      cwd: process.cwd(),
    });
    results.push({ step: "seed", status: "success" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    results.push({ step: "seed", status: "failed", detail: msg });
    return NextResponse.json({ status: "partial", results });
  }

  // Step 4: Verify
  try {
    const userCount = await prisma.user.count();
    const channelCount = await prisma.channel.count();
    const owner = await prisma.user.findFirst({ where: { role: "owner" } });
    results.push({
      step: "verify",
      status: "success",
      detail: `${userCount} users, ${channelCount} channels, owner: ${owner?.username || "MISSING"}`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    results.push({ step: "verify", status: "failed", detail: msg });
  }

  return NextResponse.json({
    status: "success",
    message: "Database initialized successfully. You can now login.",
    results,
  });
}
