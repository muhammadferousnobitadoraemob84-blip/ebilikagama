import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/auth";
import { parseJakimPdfText } from "@/lib/azan";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/virtual-radio/prayer-times/pdf — ADMIN. multipart/form-data: file=<pdf>
//
// STEP 1 of the PDF import: extract text, detect the month/year, and return
// the parsed day rows for ADMIN REVIEW. Nothing is saved here — saving only
// happens via /pdf-confirm after the admin checks the table. The PDF binary
// is parsed in memory and NEVER stored in Neon.
export async function POST(request: NextRequest) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "Attach a PDF file in the 'file' field" }, { status: 400 });
    }
    if (file.size > 15 * 1024 * 1024) {
      return NextResponse.json({ error: "PDF is too large (max 15 MB)" }, { status: 413 });
    }

    // Dynamic import of the CJS submodule (avoids pdf-parse's debug-mode main).
    const pdfParse = (await import("pdf-parse/lib/pdf-parse.js")).default;
    const buf = Buffer.from(await file.arrayBuffer());
    const parsed = await pdfParse(buf);

    const result = parseJakimPdfText(parsed.text || "");
    return NextResponse.json({
      success: true,
      fileName: file.name,
      pages: parsed.numpages,
      ...result,
    });
  } catch (err) {
    console.error("[PDF-IMPORT] error:", err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: "Could not read the PDF — it may be corrupted, password-protected, or a scan without a text layer." },
      { status: 422 }
    );
  }
}
