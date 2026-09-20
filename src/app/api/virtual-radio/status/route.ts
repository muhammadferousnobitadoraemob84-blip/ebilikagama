import { NextResponse } from "next/server";
import { getVirtualRadioState } from "@/lib/virtual-radio-store";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// GET — current virtual radio state for players.
// Authenticated-only (not in PUBLIC_PATHS): the radio page sits behind the
// sign-in gate, so its data endpoint does too.
export async function GET() {
  const state = await getVirtualRadioState();

  return NextResponse.json(state, {
    headers: { "Cache-Control": "no-store, must-revalidate" },
  });
}
