import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { isAdminRole } from "@/lib/user-management";
import { parseUserTable } from "@/lib/doc-import";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Max import file size: 2MB is plenty for thousands of rows
const MAX_IMPORT_SIZE = 2 * 1024 * 1024;

/**
 * POST /api/users/import/parse
 * Admin-only. Accepts an XLSX/DOCX upload, extracts the user table,
 * and returns rows for preview. Plaintext passwords are returned to the
 * client ONLY in memory for the confirm step — never stored or logged.
 * Creation happens exclusively via POST /api/users/bulk (which hashes).
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session || !isAdminRole(session.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file uploaded." }, { status: 400 });
    }
    if (file.size > MAX_IMPORT_SIZE) {
      return NextResponse.json(
        { error: "File too large (max 2MB)." },
        { status: 400 }
      );
    }

    const buf = Buffer.from(await file.arrayBuffer());

    let parsed;
    try {
      parsed = parseUserTable(file.name, buf);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Could not read the file.";
      return NextResponse.json({ error: msg }, { status: 400 });
    }

    // Dev-mode diagnostic: what the parser found, so empty-extraction bugs
    // are visible in the server logs instead of surfacing as "—" rows.
    const first = parsed.rows[0];
    console.log(
      `[UserImport-PARSE] "${file.name}" sheets=${JSON.stringify(parsed.debug?.sheets)} selected="${parsed.debug?.selected}" headers=${JSON.stringify(parsed.headers.slice(0, 6))} parsedRows=${parsed.rows.length} needsMapping=${parsed.needsMapping}`
    );
    if (first) {
      console.log(
        `[UserImport-PARSE] firstRow: fullName=${JSON.stringify(first.fullName)} username=${JSON.stringify(first.username)} password=${first.password ? "[exists]" : "[empty]"}`
      );
    }

    // Drop any raw cell payloads from the response (row.raw is not serialized
    // unless mapping is needed; passwords stay in the row objects for the
    // confirm step, exactly like the existing CSV staging flow).
    return NextResponse.json({
      headers: parsed.headers,
      headerRowIndex: parsed.headerRowIndex,
      needsMapping: parsed.needsMapping,
      mapping: parsed.mapping,
      rowCount: parsed.rows.length,
      debug: parsed.debug,
      rows: parsed.needsMapping
        ? parsed.rows.map((r) => ({ raw: r.raw })) // mapping mode: cells only
        : parsed.rows.map((r) => ({
            fullName: r.fullName,
            username: r.username,
            password: r.password,
          })),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Import failed.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
