import { NextRequest, NextResponse } from "next/server";
import { prisma, withRetry } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { ensureDatabase } from "@/lib/db-init";
import bcrypt from "bcryptjs";
import { isAdminRole, normalizeUsername, validateUsername, validatePassword, serializeUser } from "@/lib/user-management";
import { parseUserTable } from "@/lib/doc-import";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Max import file size: 2MB is plenty for hundreds of rows
const MAX_IMPORT_SIZE = 2 * 1024 * 1024;

interface ImportResultRow {
  fullName: string;
  username: string;
  status: "created" | "skipped" | "failed";
  reason?: string;
}

/**
 * POST /api/users/import — direct file-to-users import (admin only).
 *
 * multipart/form-data with a single "file" field (XLSX / DOCX / CSV).
 *
 * Flow: parse file → locate FULL NAME / USERNAME / PASSWORD columns →
 * validate rows → create users (bcrypt-hashed) → return a per-row result
 * summary. There is no mapping step: when the columns cannot be confidently
 * identified the request fails with a clear error instead.
 *
 * Plaintext passwords exist only in memory for the duration of this request
 * (read from the file, hashed immediately, never stored/logged/returned).
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session || !isAdminRole(session.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const dbReady = await ensureDatabase();
    if (!dbReady) {
      return NextResponse.json({ error: "Database unavailable" }, { status: 500 });
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

    // ── 1. Parse the file into a table ──
    const buf = Buffer.from(await file.arrayBuffer());
    const isCsv = file.name.toLowerCase().endsWith(".csv");
    let headers: string[] = [];
    let rawRows: string[][] = [];
    let mapping: { fullName: number | null; username: number | null; password: number | null } = {
      fullName: null,
      username: null,
      password: null,
    };

    if (isCsv) {
      // CSV: reuse the client parser's rules server-side (quoted fields,
      // delimiter auto-detection, UTF-8 BOM).
      let text = buf.toString("utf8");
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
      const parseCsvRows = (raw: string, delim: string): string[][] => {
        const out: string[][] = [];
        let row: string[] = [];
        let field = "";
        let inQuotes = false;
        for (let i = 0; i < raw.length; i++) {
          const ch = raw[i];
          if (inQuotes) {
            if (ch === '"') {
              if (raw[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
            } else field += ch;
          } else if (ch === '"') {
            inQuotes = true;
          } else if (ch === delim) {
            row.push(field); field = "";
          } else if (ch === "\n" || ch === "\r") {
            if (ch === "\r" && raw[i + 1] === "\n") i++;
            row.push(field); field = "";
            out.push(row); row = [];
          } else field += ch;
        }
        if (field.length > 0 || row.length > 0) { row.push(field); out.push(row); }
        return out;
      };
      const firstLine = text.split(/\r?\n/).find((l) => l.trim()) || "";
      const counts: Record<string, number> = {
        ",": (firstLine.match(/,/g) || []).length,
        ";": (firstLine.match(/;/g) || []).length,
        "\t": (firstLine.match(/\t/g) || []).length,
      };
      const delim =
        Object.entries(counts).sort((a, b) => b[1] - a[1])[0][1] > 0
          ? Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]
          : ",";
      rawRows = parseCsvRows(text, delim).filter((r) => r.some((c) => c.trim()));
      if (rawRows.length > 0) {
        const nameRe = /^(full[\s._-]*)?name$/i;
        const userRe = /^(user(name)?)(\s*\/?\s*(email))?$/i;
        const passRe = /^(pass(word)?|pwd|kata[\s._-]*laluan)$/i;
        for (let i = 0; i < Math.min(rawRows.length, 8); i++) {
          const m = { fullName: -1, username: -1, password: -1 };
          for (let c = 0; c < rawRows[i].length; c++) {
            const v = rawRows[i][c].trim().toLowerCase().replace(/[*:]+$/, "").trim();
            if (m.fullName === -1 && nameRe.test(v)) m.fullName = c;
            else if (m.username === -1 && userRe.test(v)) m.username = c;
            else if (m.password === -1 && passRe.test(v)) m.password = c;
          }
          const hits = Object.values(m).filter((x) => x !== -1).length;
          if (hits >= 2) {
            mapping = {
              fullName: m.fullName !== -1 ? m.fullName : 0,
              username: m.username !== -1 ? m.username : 1,
              password: m.password !== -1 ? m.password : 2,
            };
            headers = rawRows[i];
            rawRows = rawRows.slice(i + 1);
            break;
          }
        }
        if (mapping.username === null && mapping.fullName === null) {
          // Headerless CSV: positional columns
          mapping = { fullName: 0, username: 1, password: 2 };
        }
      }
    } else {
      const parsed = parseUserTable(file.name, buf);
      if (parsed.needsMapping) {
        return NextResponse.json(
          {
            error:
              "Could not identify the required user columns. Expected columns: Full Name, Username, Password.",
          },
          { status: 422 }
        );
      }
      headers = parsed.headers;
      mapping = parsed.mapping;
      rawRows = parsed.rows.map((r) => r.raw);
    }

    if (mapping.fullName === null || mapping.username === null || mapping.password === null) {
      return NextResponse.json(
        {
          error:
            "Could not identify the required user columns. Expected columns: Full Name, Username, Password.",
        },
        { status: 422 }
      );
    }

    // ── 2. Extract + validate rows (no manual step in between) ──
    interface ValidRow { fullName: string; username: string; password: string }
    const valid: ValidRow[] = [];
    const results: ImportResultRow[] = [];
    const preFail = (fullName: string, username: string, reason: string) => {
      results.push({ fullName, username, status: "failed", reason });
    };

    for (const r of rawRows) {
      const fullName = (mapping.fullName !== null ? r[mapping.fullName] || "" : "").trim();
      const usernameRaw = (mapping.username !== null ? r[mapping.username] || "" : "").trim();
      const password = mapping.password !== null ? r[mapping.password] || "" : "";
      if (!fullName && !usernameRaw && !password.trim()) continue; // fully blank row
      const username = normalizeUsername(usernameRaw);

      if (!fullName) { preFail(fullName, username, "Full name is required"); continue; }
      const uErr = validateUsername(usernameRaw);
      if (uErr) { preFail(fullName, username || usernameRaw, uErr); continue; }
      const pErr = validatePassword(password);
      if (pErr) { preFail(fullName, username, pErr); continue; }
      valid.push({ fullName, username, password });
    }

    if (valid.length === 0) {
      return NextResponse.json(
        {
          error: "File detected, but no valid user rows were found. Expected columns: Full Name, Username, Password.",
          results,
          detected: 0,
        },
        { status: 422 }
      );
    }

    // ── 3. Create users directly ──
    const existingUsers = await withRetry(() =>
      prisma.user.findMany({ select: { username: true } })
    );
    const existingSet = new Set(existingUsers.map((u) => u.username.toLowerCase()));

    let createdCount = 0;
    let skippedCount = 0;
    const created: ReturnType<typeof serializeUser>[] = [];

    for (const row of valid) {
      if (existingSet.has(row.username)) {
        skippedCount++;
        results.push({ fullName: row.fullName, username: row.username, status: "skipped", reason: "Username already exists" });
        continue;
      }
      if (results.some((r) => r.username === row.username && r.status !== "failed")) {
        skippedCount++;
        results.push({ fullName: row.fullName, username: row.username, status: "skipped", reason: "Duplicate in file" });
        continue;
      }
      try {
        const passwordHash = await bcrypt.hash(row.password, 10);
        const user = await withRetry(() =>
          prisma.user.create({
            data: { username: row.username, fullName: row.fullName, passwordHash, role: "user", active: true },
          })
        );
        existingSet.add(row.username);
        createdCount++;
        results.push({ fullName: row.fullName, username: row.username, status: "created" });
        created.push(
          serializeUser({
            id: user.id,
            username: user.username,
            fullName: user.fullName,
            role: user.role,
            active: user.active,
            lastLogin: user.lastLogin,
            createdAt: user.createdAt,
          })
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        if (msg.includes("Unique constraint")) {
          skippedCount++;
          results.push({ fullName: row.fullName, username: row.username, status: "skipped", reason: "Username already exists" });
        } else {
          results.push({ fullName: row.fullName, username: row.username, status: "failed", reason: "Database error" });
        }
      }
    }

    const failedCount = results.filter((r) => r.status === "failed").length;
    console.log(
      `[USERS-IMPORT] "${file.name}": detected=${valid.length + results.filter((r) => r.status === "failed").length} created=${createdCount} skipped=${skippedCount} failed=${failedCount}`
    );

    return NextResponse.json({
      success: true,
      detected: valid.length + results.filter((r) => r.status === "failed").length,
      createdCount,
      skippedCount,
      failedCount,
      results,
      created,
      headers,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Import failed.";
    console.error("[USERS-IMPORT] Error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
