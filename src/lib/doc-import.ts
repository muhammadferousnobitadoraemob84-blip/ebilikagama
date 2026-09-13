/**
 * Zero-dependency XLSX / DOCX table parser for bulk user import.
 *
 * XLSX and DOCX are ZIP archives; we read the central directory, inflate the
 * needed parts with Node's built-in zlib, and extract the user table.
 *
 * XLSX:
 *  - Scans ALL worksheets (via workbook.xml + rels), not just sheet1.
 *  - Never trusts <dimension> metadata — rows/cells are read directly.
 *  - Handles shared strings, inline strings, cached formula values, numbers.
 *  - Places cells by their r="A1" reference so omitted empty cells cannot
 *    shift columns.
 *  - Picks the sheet with the best header match + most data rows (an "IMPORT"
 *    sheet with valid rows is chosen automatically).
 *
 * DOCX:
 *  - Scans ALL tables in the document body, skipping non-user tables and
 *    class headings, and combines rows from tables that share the mapped
 *    column layout.
 *
 * Header detection is case-insensitive, whitespace/punctuation-tolerant.
 * If columns cannot be confidently identified, parse() returns `headers`
 * and `rows` anyway so the admin UI can show a manual column-mapping step.
 */

import { inflateRawSync } from "zlib";

// ─────────────────────────────────────────────────────────────
// Minimal ZIP reader (stored + deflate entries)
// ─────────────────────────────────────────────────────────────

function readZip(buf: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>();

  // Locate End Of Central Directory (EOCD, signature 0x06054b50)
  let eocd = -1;
  const minEocd = Math.max(0, buf.length - 66000);
  for (let i = buf.length - 22; i >= minEocd; i--) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x05 && buf[i + 3] === 0x06) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error("Not a valid XLSX/DOCX file (ZIP header missing).");

  const entryCount = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);

  let p = cdOffset;
  for (let n = 0; n < entryCount && p + 46 <= buf.length; n++) {
    // Central directory header signature 0x02014b50
    if (!(buf[p] === 0x50 && buf[p + 1] === 0x4b && buf[p + 2] === 0x01 && buf[p + 3] === 0x02)) break;

    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString("utf8");
    p += 46 + nameLen + extraLen + commentLen;

    // Local file header
    if (localOffset + 30 > buf.length) continue;
    const lNameLen = buf.readUInt16LE(localOffset + 26);
    const lExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    const comp = buf.slice(dataStart, dataStart + compSize);

    try {
      if (method === 0) {
        entries.set(name, comp);
      } else if (method === 8) {
        entries.set(name, inflateRawSync(comp));
      }
    } catch {
      // Skip entries that fail to inflate
    }
  }

  return entries;
}

// ─────────────────────────────────────────────────────────────
// XML helpers
// ─────────────────────────────────────────────────────────────

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&");
}

function stripTags(xml: string): string {
  return decodeXmlEntities(xml.replace(/<[^>]*>/g, ""));
}

// ─────────────────────────────────────────────────────────────
// Header detection + row extraction (shared)
// ─────────────────────────────────────────────────────────────

export interface ParsedUserRow {
  fullName: string;
  username: string;
  password: string;
  raw: string[]; // original cells for the manual-mapping view
}

export interface ColumnMapping {
  fullName: number | null;
  username: number | null;
  password: number | null;
}

export interface ParsedTable {
  headers: string[]; // detected header labels (may be empty)
  rows: ParsedUserRow[];
  mapping: ColumnMapping;
  headerRowIndex: number; // -1 when no header row was detected
  needsMapping: boolean;
  debug: {
    kind: "xlsx" | "docx";
    sheets: string[]; // sheet/table names or count labels detected
    selected: string; // which sheet/table supplied the data
  };
}

const NAME_PATTERNS = [
  /^(full[\s._-]*)?name$/i,
  /^full[\s._-]*name$/i,
  /^nama(\s*penuh)?$/i,
  /^display[\s._-]*name$/i,
];
// NOTE: a plain "email" column is intentionally NOT treated as username.
const USERNAME_PATTERNS = [
  /^user[\s._-]*name$/i,
  /^username$/i,
  /^user$/i,
  /^user[\s._-]*name\s*\/?\s*email$/i,
  /^username\s*\/?\s*email$/i,
  /^email\s*\/?\s*username$/i,
];
const PASSWORD_PATTERNS = [
  /^pass[\s._-]*word$/i,
  /^password$/i,
  /^pwd$/i,
  /^pass$/i,
  /^kata[\s._-]*laluan$/i,
];

function normalizeHeader(value: string): string {
  return value
    .replace(/\u00a0/g, " ") // nbsp
    .replace(/[*:：]+$/g, "") // trailing markers like "FULL NAME:"
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function matchAny(value: string, patterns: RegExp[]): boolean {
  const v = normalizeHeader(value);
  if (!v) return false;
  return patterns.some((p) => p.test(v));
}

function detectMapping(row: string[]): ColumnMapping {
  const m: ColumnMapping = { fullName: null, username: null, password: null };
  for (let i = 0; i < row.length; i++) {
    const cell = (row[i] || "").trim();
    if (!cell) continue;
    if (m.fullName === null && matchAny(cell, NAME_PATTERNS)) m.fullName = i;
    else if (m.username === null && matchAny(cell, USERNAME_PATTERNS)) m.username = i;
    else if (m.password === null && matchAny(cell, PASSWORD_PATTERNS)) m.password = i;
  }
  return m;
}

function mappingHits(m: ColumnMapping): number {
  return [m.fullName, m.username, m.password].filter((x) => x !== null).length;
}

interface TableAnalysis {
  headerRowIndex: number; // -1 if none
  mapping: ColumnMapping;
  dataRows: string[][]; // rows after the header (or all rows if no header)
  validRowCount: number; // rows with a non-empty username cell (heuristic)
}

/** Detect the header row within the first few rows and slice data rows. */
function analyzeRows(rows: string[][], hasHeaderHint = true): TableAnalysis {
  const nonEmpty = rows.filter((r) => r.some((c) => (c || "").trim().length > 0));
  let headerRowIndex = -1;
  let mapping: ColumnMapping = { fullName: null, username: null, password: null };

  if (hasHeaderHint) {
    const scanLimit = Math.min(nonEmpty.length, 8);
    let bestHits = 0;
    for (let i = 0; i < scanLimit; i++) {
      const m = detectMapping(nonEmpty[i]);
      const hits = mappingHits(m);
      // Require username or fullname to be confidently identified
      if (hits >= 2 && hits > bestHits) {
        bestHits = hits;
        headerRowIndex = i;
        mapping = m;
      }
      if (hits === 3) break;
    }
  }

  const dataRows =
    headerRowIndex >= 0 ? nonEmpty.slice(headerRowIndex + 1) : nonEmpty;

  const validRowCount = dataRows.filter((r) => {
    const u = mapping.username !== null ? (r[mapping.username] || "").trim() : "";
    const n = mapping.fullName !== null ? (r[mapping.fullName] || "").trim() : "";
    return u.length > 0 || n.length > 0;
  }).length;

  return { headerRowIndex, mapping, dataRows, validRowCount };
}

function extractParsedRows(
  dataRows: string[][],
  mapping: ColumnMapping
): ParsedUserRow[] {
  return dataRows
    .filter((r) => r.some((c) => (c || "").trim().length > 0))
    .map((r) => ({
      fullName: mapping.fullName !== null ? (r[mapping.fullName] || "").trim() : "",
      username: mapping.username !== null ? (r[mapping.username] || "").trim() : "",
      password: mapping.password !== null ? (r[mapping.password] || "").trim() : "",
      raw: r,
    }));
}

function buildParsedTable(
  analysis: TableAnalysis,
  allRows: string[][],
  debug: ParsedTable["debug"]
): ParsedTable {
  const parsed = extractParsedRows(analysis.dataRows, analysis.mapping);
  const needsMapping =
    analysis.mapping.fullName === null || analysis.mapping.username === null;
  return {
    headers: analysis.headerRowIndex >= 0 ? allRows[analysis.headerRowIndex] || [] : [],
    rows: parsed,
    mapping: analysis.mapping,
    headerRowIndex: analysis.headerRowIndex,
    needsMapping,
    debug,
  };
}

// ─────────────────────────────────────────────────────────────
// XLSX parsing
// ─────────────────────────────────────────────────────────────

function parseSharedStrings(xml: string | undefined): string[] {
  if (!xml) return [];
  const strings: string[] = [];
  const siRegex = /<si(?:\s[^>]*)?>([\s\S]*?)<\/si>|<si\/>/g;
  let m: RegExpExecArray | null;
  while ((m = siRegex.exec(xml)) !== null) {
    if (!m[1]) {
      strings.push("");
      continue;
    }
    // Concatenate all <t> runs (rich text)
    const texts: string[] = [];
    const tRegex = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g;
    let t: RegExpExecArray | null;
    while ((t = tRegex.exec(m[1])) !== null) {
      texts.push(decodeXmlEntities(t[1]));
    }
    strings.push(texts.join(""));
  }
  return strings;
}

/** Column index from an A1-style cell reference ("B3" → 1). */
function colIndexFromRef(ref: string | undefined): number | null {
  if (!ref) return null;
  const m = ref.match(/^([A-Za-z]+)/);
  if (!m) return null;
  let n = 0;
  for (const ch of m[1].toUpperCase()) {
    n = n * 26 + (ch.charCodeAt(0) - 64);
  }
  return n - 1;
}

/**
 * Parse one worksheet's XML into a string matrix. Reads actual <row>/<c>
 * elements — never the <dimension> metadata — and handles shared strings,
 * inline strings, cached formula results and numbers. Cells are placed by
 * their r="B3" reference when present so omitted empty cells don't shift
 * columns.
 */
function parseXlsxSheet(sheetXml: string, sharedStrings: string[]): string[][] {
  const rows: string[][] = [];
  const rowRegex = /<row\b[^>]*?>([\s\S]*?)<\/row>|<row\b[^>]*?\/>/g;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRegex.exec(sheetXml)) !== null) {
    const rowXml = rowMatch[0];
    const cells: string[] = [];
    let nextFree = 0;
    const cellRegex = /<c\b([^>]*?)\/>|<c\b([^>]*?)>([\s\S]*?)<\/c>/g;
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRegex.exec(rowXml)) !== null) {
      const attrs = cellMatch[1] || cellMatch[2] || "";
      const inner = cellMatch[3] || "";

      // Place by r reference, else sequentially
      const refMatch = attrs.match(/\br="([A-Za-z]+\d+)"/);
      const col = colIndexFromRef(refMatch ? refMatch[1] : undefined);
      const idx = col !== null ? col : nextFree;
      while (cells.length <= idx) cells.push("");

      const typeMatch = attrs.match(/t="([^"]+)"/);
      const type = typeMatch ? typeMatch[1] : "n";

      let text = "";
      if (type === "s") {
        const vMatch = inner.match(/<v>([\s\S]*?)<\/v>/);
        if (vMatch) text = sharedStrings[parseInt(vMatch[1], 10)] ?? "";
      } else if (type === "inlineStr" || /<is[\s>]/.test(inner)) {
        text = stripTags(inner);
      } else {
        // "n" number, "str" cached formula string, "b" boolean, "e" error
        const vMatch = inner.match(/<v>([\s\S]*?)<\/v>/);
        text = vMatch ? decodeXmlEntities(vMatch[1]) : "";
      }

      cells[idx] = text.trim();
      nextFree = idx + 1;
    }
    if (cells.some((c) => c.length > 0)) rows.push(cells);
  }
  return rows;
}

interface SheetRef {
  name: string;
  path: string;
}

/** Resolve sheet names → worksheet paths via workbook.xml + its rels. */
function listXlsxSheets(entries: Map<string, Buffer>): SheetRef[] {
  const wbXml = entries.get("xl/workbook.xml")?.toString("utf8");
  const relsXml = entries.get("xl/_rels/workbook.xml.rels")?.toString("utf8");

  if (wbXml && relsXml) {
    const relMap = new Map<string, string>();
    const relRegex = /<Relationship\b[^>]*?\/?>/g;
    let relMatch: RegExpExecArray | null;
    while ((relMatch = relRegex.exec(relsXml)) !== null) {
      const id = relMatch[0].match(/Id="([^"]+)"/)?.[1];
      const target = relMatch[0].match(/Target="([^"]+)"/)?.[1];
      if (id && target) relMap.set(id, target);
    }

    const sheets: SheetRef[] = [];
    const sheetRegex = /<sheet\b[^>]*?\/?>/g;
    let sheetMatch: RegExpExecArray | null;
    while ((sheetMatch = sheetRegex.exec(wbXml)) !== null) {
      const name = sheetMatch[0].match(/name="([^"]*)"/)?.[1] ?? "";
      const rid = sheetMatch[0].match(/r:id="([^"]+)"/)?.[1];
      let target = rid ? relMap.get(rid) : undefined;
      if (!target) continue;
      target = target.replace(/^\//, "");
      if (!target.startsWith("xl/")) target = "xl/" + target;
      if (entries.has(target)) sheets.push({ name: decodeXmlEntities(name), path: target });
    }
    if (sheets.length > 0) return sheets;
  }

  // Fallback: numeric order of sheetN.xml
  return [...entries.keys()]
    .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .sort((a, b) => {
      const na = parseInt(a.match(/(\d+)/)![1], 10);
      const nb = parseInt(b.match(/(\d+)/)![1], 10);
      return na - nb;
    })
    .map((p) => ({ name: p.replace("xl/worksheets/", ""), path: p }));
}

function parseXlsx(buf: Buffer): ParsedTable {
  const entries = readZip(buf);
  const sharedStrings = parseSharedStrings(
    entries.get("xl/sharedStrings.xml")?.toString("utf8")
  );

  const sheets = listXlsxSheets(entries);
  if (sheets.length === 0) throw new Error("XLSX file contains no worksheet.");

  // Score every sheet: header quality first, then usable data rows.
  let best: { sheet: SheetRef; analysis: TableAnalysis; rows: string[][] } | null = null;
  const sheetNames: string[] = [];

  for (const sheet of sheets) {
    const xml = entries.get(sheet.path)?.toString("utf8");
    if (!xml) continue;
    const rows = parseXlsxSheet(xml, sharedStrings);
    if (rows.length === 0) continue;
    const analysis = analyzeRows(rows);
    sheetNames.push(sheet.name);

    const better =
      !best ||
      mappingHits(analysis.mapping) > mappingHits(best.analysis.mapping) ||
      (mappingHits(analysis.mapping) === mappingHits(best.analysis.mapping) &&
        analysis.validRowCount > best.analysis.validRowCount);
    if (better) best = { sheet, analysis, rows };
  }

  if (!best) {
    throw new Error(
      "The XLSX workbook contains no readable data rows in any worksheet."
    );
  }

  return buildParsedTable(best.analysis, best.rows, {
    kind: "xlsx",
    sheets: sheetNames,
    selected: best.sheet.name,
  });
}

// ─────────────────────────────────────────────────────────────
// DOCX parsing (all tables, combined per class layout)
// ─────────────────────────────────────────────────────────────

function parseDocxTableRows(tbl: string): string[][] {
  const rows: string[][] = [];
  const rowRegex = /<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/g;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRegex.exec(tbl)) !== null) {
    const cells: string[] = [];
    const cellRegex = /<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/g;
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) {
      // Concatenate all text runs in the cell
      const texts: string[] = [];
      const tRegex = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
      let t: RegExpExecArray | null;
      while ((t = tRegex.exec(cellMatch[1])) !== null) {
        texts.push(decodeXmlEntities(t[1]));
      }
      cells.push(texts.join("").trim());
    }
    if (cells.some((c) => c.length > 0)) rows.push(cells);
  }
  return rows;
}

function parseDocx(buf: Buffer): ParsedTable {
  const entries = readZip(buf);
  const docXml = entries.get("word/document.xml")?.toString("utf8");
  if (!docXml) throw new Error("DOCX file contains no document body.");

  // Collect every top-level table (skip nested tables inside cells)
  const tables: string[][][] = [];
  const tblRegex = /<w:tbl\b[^>]*>([\s\S]*?)<\/w:tbl>/g;
  let tblMatch: RegExpExecArray | null;
  while ((tblMatch = tblRegex.exec(docXml)) !== null) {
    const body = tblMatch[1];
    if (/<w:tbl\b/.test(body)) continue; // nested table — handled via outer pass
    const rows = parseDocxTableRows(tblMatch[0]);
    if (rows.length > 0) tables.push(rows);
  }
  if (tables.length === 0) {
    throw new Error(
      "No table found in the DOCX file. Put the user data in a table with columns: Full Name, Username, Password."
    );
  }

  // Analyze each table; keep the one with the best header mapping + rows.
  const analyses = tables.map((rows) => analyzeRows(rows));
  let bestIdx = 0;
  for (let i = 1; i < analyses.length; i++) {
    const a = analyses[i];
    const b = analyses[bestIdx];
    if (
      mappingHits(a.mapping) > mappingHits(b.mapping) ||
      (mappingHits(a.mapping) === mappingHits(b.mapping) &&
        a.validRowCount > b.validRowCount)
    ) {
      bestIdx = i;
    }
  }
  const best = analyses[bestIdx];
  if (mappingHits(best.mapping) < 2) {
    throw new Error(
      "Could not identify the required user columns (Full Name / Username / Password) in any DOCX table."
    );
  }

  // Combine rows from ALL tables that share the same column layout, in
  // document order: tables with their own header contribute the rows after
  // that header; header-less continuation tables ("divided by class")
  // contribute rows that have a value in the mapped username column.
  const colCount = best.headerRowIndex >= 0 ? tables[bestIdx][best.headerRowIndex].length : 0;
  const combined: string[][] = [];
  for (let i = 0; i < tables.length; i++) {
    const rows = tables[i];
    const a = analyses[i];
    const sameLayout = colCount > 0 && rows.every((r) => r.length === colCount);
    if (a.headerRowIndex >= 0 && sameLayout) {
      combined.push(...a.dataRows);
    } else if (a.headerRowIndex === -1 && sameLayout && best.mapping.username !== null) {
      const continuation = rows.filter(
        (r) => (r[best.mapping.username as number] || "").trim().length > 0
      );
      combined.push(...continuation);
    }
  }

  const finalAnalysis: TableAnalysis = { ...best, dataRows: combined };
  return buildParsedTable(finalAnalysis, tables[bestIdx], {
    kind: "docx",
    sheets: tables.map((t, i) => `table ${i + 1} (${t.length} rows)`),
    selected: `table ${bestIdx + 1} (+${combined.length - best.dataRows.length} from other tables)`,
  });
}

// ─────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────

export function parseUserTable(fileName: string, buf: Buffer): ParsedTable {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".xlsx")) {
    return parseXlsx(buf);
  }
  if (lower.endsWith(".docx")) {
    return parseDocx(buf);
  }
  if (lower.endsWith(".xls")) {
    throw new Error(
      "Legacy .xls is not supported. Please save the file as .xlsx and try again."
    );
  }
  throw new Error("Unsupported file type. Use .xlsx, .docx, or .csv.");
}
