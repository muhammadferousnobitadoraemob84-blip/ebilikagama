/**
 * Zero-dependency XLSX / DOCX table parser for bulk user import.
 *
 * XLSX and DOCX are ZIP archives; we read the central directory, inflate the
 * needed parts with Node's built-in zlib, and extract the user table.
 *
 * Supported:
 *  - .xlsx: first worksheet, shared-strings + inline strings, header row
 *    detection by known column names (name / username / email / password)
 *  - .docx: first table in the document body (w:tbl), same header detection
 *  - .csv: passthrough handled client-side (existing flow)
 *
 * If columns cannot be confidently identified, parse() returns `headers`
 * and `rows` anyway so the admin UI can show a manual column-mapping step.
 */

import { inflateRawSync } from "zlib";

// ─────────────────────────────────────────────────────────────
// Minimal ZIP reader (stored + deflate entries)
// ─────────────────────────────────────────────────────────────

interface ZipEntry {
  name: string;
  data: Buffer;
}

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
// XLSX parsing
// ─────────────────────────────────────────────────────────────

interface Cell {
  text: string;
}

function parseXlsxSheet(
  sheetXml: string,
  sharedStrings: string[]
): Cell[][] {
  const rows: Cell[][] = [];

  // Iterate <row ...>...</row>
  const rowRegex = /<row[^>]*>([\s\S]*?)<\/row>|<row[^>]*\/>/g;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRegex.exec(sheetXml)) !== null) {
    const rowXml = rowMatch[0];
    const cells: Cell[] = [];
    const cellRegex = /<c\b([^>]*?)\/>|<c\b([^>]*?)>([\s\S]*?)<\/c>/g;
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRegex.exec(rowXml)) !== null) {
      const attrs = cellMatch[1] || cellMatch[2] || "";
      const inner = cellMatch[3] || "";
      const typeMatch = attrs.match(/t="([^"]+)"/);
      const type = typeMatch ? typeMatch[1] : "n";

      let text = "";
      if (type === "s") {
        // Shared string index
        const vMatch = inner.match(/<v>([\s\S]*?)<\/v>/);
        if (vMatch) {
          const idx = parseInt(vMatch[1], 10);
          text = sharedStrings[idx] ?? "";
        }
      } else if (type === "inlineStr") {
        text = stripTags(inner);
      } else {
        const vMatch = inner.match(/<v>([\s\S]*?)<\/v>/);
        text = vMatch ? vMatch[1] : "";
      }
      cells.push({ text: text.trim() });
    }
    rows.push(cells);
  }

  return rows;
}

function parseSharedStrings(xml: string | undefined): string[] {
  if (!xml) return [];
  const strings: string[] = [];
  const siRegex = /<si>([\s\S]*?)<\/si>/g;
  let m: RegExpExecArray | null;
  while ((m = siRegex.exec(xml)) !== null) {
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

function parseXlsx(buf: Buffer): ParsedTable {
  const entries = readZip(buf);

  const sharedStrings = parseSharedStrings(
    entries.get("xl/sharedStrings.xml")?.toString("utf8")
  );

  // First worksheet: try workbook.xml rels order, else sheet1.xml
  let sheetXml: string | undefined =
    entries.get("xl/worksheets/sheet1.xml")?.toString("utf8");

  if (!sheetXml) {
    // Fall back to the first xl/worksheets/*.xml entry
    for (const [name, data] of entries) {
      if (/^xl\/worksheets\/sheet\d+\.xml$/.test(name)) {
        sheetXml = data.toString("utf8");
        break;
      }
    }
  }
  if (!sheetXml) {
    throw new Error("XLSX file contains no worksheet.");
  }

  const rows = parseXlsxSheet(sheetXml, sharedStrings)
    // Drop completely empty rows
    .filter((r) => r.some((c) => c.text.length > 0))
    .map((r) => r.map((c) => c.text));

  return finish(rows);
}

// ─────────────────────────────────────────────────────────────
// DOCX parsing (first table in the document)
// ─────────────────────────────────────────────────────────────

function parseDocx(buf: Buffer): ParsedTable {
  const entries = readZip(buf);
  const docXml = entries.get("word/document.xml")?.toString("utf8");
  if (!docXml) throw new Error("DOCX file contains no document body.");

  // Find the first <w:tbl>
  const tblStart = docXml.indexOf("<w:tbl>");
  if (tblStart === -1) {
    throw new Error(
      "No table found in the DOCX file. Put the user data in a table with columns: Full Name, Username, Password."
    );
  }
  const tblEnd = docXml.indexOf("</w:tbl>", tblStart);
  const tbl = docXml.slice(tblStart, tblEnd === -1 ? docXml.length : tblEnd + 8);

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
    rows.push(cells);
  }

  if (rows.length === 0) {
    throw new Error("The table in the DOCX file is empty.");
  }

  return finish(rows);
}

// ─────────────────────────────────────────────────────────────
// Header detection + row extraction
// ─────────────────────────────────────────────────────────────

export interface ParsedUserRow {
  fullName: string;
  username: string;
  password: string;
  raw: string[]; // original cells for the manual-mapping view
}

export interface ParsedTable {
  headers: string[]; // detected header labels (may be empty)
  rows: ParsedUserRow[];
  mapping: {
    fullName: number | null;
    username: number | null;
    password: number | null;
  };
  headerRowIndex: number; // -1 when no header row was detected
  needsMapping: boolean;
}

const NAME_PATTERNS = [/^(full\s*)?name$/i, /^nama$/i, /^full[_ -]?name$/i, /^display\s*name$/i];
const USERNAME_PATTERNS = [
  /^user(name)?$/i,
  /^(user(name)?|email)\s*\/?\s*(email)?$/i,
  /^email/i,
  /^user(name)?\s*\/\s*email$/i,
  /^username\s*\/?\s*email$/i,
  /^emel$/i,
];
const PASSWORD_PATTERNS = [/^pass(word)?$/i, /^kata\s*laluan$/i, /^pass(word)?\s*\/?\s*(kata\s*laluan)?$/i];

function matchAny(value: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(value.trim()));
}

function finish(rows: string[][]): ParsedTable {
  if (rows.length === 0) {
    const noMapping: { fullName: number | null; username: number | null; password: number | null } = {
      fullName: null,
      username: null,
      password: null,
    };
    return { headers: [], rows: [], mapping: noMapping, headerRowIndex: -1, needsMapping: true };
  }

  // Detect a header row within the first 5 rows: the first row where
  // at least two of the three required columns match known labels.
  let headerRowIndex = -1;
  let mapping: { fullName: number | null; username: number | null; password: number | null } = {
    fullName: null,
    username: null,
    password: null,
  };

  const scanLimit = Math.min(rows.length, 5);
  for (let i = 0; i < scanLimit; i++) {
    const candidate = rows[i];
    const m = detectMapping(candidate);
    const hits = [m.fullName, m.username, m.password].filter((x) => x !== null).length;
    if (hits >= 2) {
      headerRowIndex = i;
      mapping = m;
      break;
    }
  }

  const headers = headerRowIndex >= 0 ? rows[headerRowIndex] : [];
  const dataRows = rows.slice(headerRowIndex >= 0 ? headerRowIndex + 1 : 0);

  const parsed: ParsedUserRow[] = dataRows
    .filter((r) => r.some((c) => c.trim().length > 0))
    .map((r) => ({
      fullName: mapping.fullName !== null ? (r[mapping.fullName] || "").trim() : "",
      username: mapping.username !== null ? (r[mapping.username] || "").trim() : "",
      password: mapping.password !== null ? (r[mapping.password] || "").trim() : "",
      raw: r,
    }));

  const needsMapping = mapping.fullName === null || mapping.username === null;
  return { headers, rows: parsed, mapping, headerRowIndex, needsMapping };
}

function detectMapping(row: string[]): { fullName: number | null; username: number | null; password: number | null } {
  const m: { fullName: number | null; username: number | null; password: number | null } = {
    fullName: null,
    username: null,
    password: null,
  };
  for (let i = 0; i < row.length; i++) {
    const cell = (row[i] || "").trim();
    if (!cell) continue;
    if (m.fullName === null && matchAny(cell, NAME_PATTERNS)) m.fullName = i;
    else if (m.username === null && matchAny(cell, USERNAME_PATTERNS)) m.username = i;
    else if (m.password === null && matchAny(cell, PASSWORD_PATTERNS)) m.password = i;
  }
  return m;
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
