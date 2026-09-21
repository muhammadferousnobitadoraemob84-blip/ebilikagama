// Unit tests for src/lib/azan.ts pure logic:
//   1. isAzanFileName prefix rule (incl. "Nasheed Azan" rejection)
//   2. computeAzanSchedule with controlled times (active window, next event,
//      generic-file reuse across prayers, missing-assignment skipping)
//   3. prayerTimeToMs Malaysia-time conversion edge (Subuh before UTC midnight)
// Run: node scripts/test-azan.cjs (after npx tsc compiles azan.ts — done inline).

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

// Compile just the pure module to a temp dir (local tsc — no npx).
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "azan-test-"));
const src = path.join(__dirname, "..", "src", "lib", "azan.ts");
const tsc = path.join(__dirname, "..", "node_modules", "typescript", "bin", "tsc");
execSync(
  `"${process.execPath}" "${tsc}" "${src}" --outDir "${tmp}" --module commonjs --target es2020 --moduleResolution node --esModuleInterop --skipLibCheck`,
  { cwd: path.join(__dirname, ".."), stdio: "pipe" }
);
const azan = require(path.join(tmp, "azan.js"));

let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

console.log("── isAzanFileName ──");
check("Azan Subuh.mp3 → true", azan.isAzanFileName("Azan Subuh.mp3") === true);
check("Azan.mp3 → true", azan.isAzanFileName("Azan.mp3") === true);
check("azan maghrib.mp3 (lower) → true", azan.isAzanFileName("azan maghrib.mp3") === true);
check(" AZAN Zohor.mp3 (leading space) → true", azan.isAzanFileName(" AZAN Zohor.mp3") === true);
check("Azan.MP3 → true", azan.isAzanFileName("Azan.MP3") === true);
check("Nasheed Azan.mp3 → false", azan.isAzanFileName("Nasheed Azan.mp3") === false);
check("Lagu Azan.mp3 → false", azan.isAzanFileName("Lagu Azan.mp3") === false);
check("Selawat.mp3 → false", azan.isAzanFileName("Selawat.mp3") === false);
check("01. Dato' Sri Siti Nurhaliza - Selawat.mp3 → false", azan.isAzanFileName("01. Dato' Sri Siti Nurhaliza - Selawat.mp3") === false);
check("Quran.mp3 → false", azan.isAzanFileName("Quran.mp3") === false);
check("Azanku.mp3 → true (starts with Azan)", azan.isAzanFileName("Azanku.mp3") === true);

console.log("── prayerTimeToMs (MYT = UTC+8) ──");
// Subuh 05:12 MYT on 2026-09-20 = 2026-09-19T21:12Z
const subuhMs = azan.prayerTimeToMs("2026-09-20", "05:12");
check("05:12 MYT → 21:12Z prev day", subuhMs === Date.UTC(2026, 8, 19, 21, 12, 0));
const isyakMs = azan.prayerTimeToMs("2026-09-20", "19:39");
check("19:39 MYT → 11:39Z same day", isyakMs === Date.UTC(2026, 8, 20, 11, 39, 0));
check("garbage → null", azan.prayerTimeToMs("2026-09-20", "99:99") === null);

console.log("── computeAzanSchedule (controlled times) ──");
const files = [
  { driveId: "f_subuh", fileName: "Azan Subuh.mp3", mimeType: "audio/mpeg", size: 100, duration: 240, durationPending: false, unavailable: false, addedAt: "2026-01-01T00:00:00Z", lastSeenAt: null },
  { driveId: "f_gen", fileName: "Azan.mp3", mimeType: "audio/mpeg", size: 100, duration: 300, durationPending: false, unavailable: false, addedAt: "2026-01-01T00:00:00Z", lastSeenAt: null },
  { driveId: "f_dead", fileName: "Azan Terpadam.mp3", mimeType: "audio/mpeg", size: 100, duration: 300, durationPending: false, unavailable: true, addedAt: "2026-01-01T00:00:00Z", lastSeenAt: null },
];
const assignments = {
  subuh: "f_subuh",
  zohor: "f_gen",
  asar: "f_gen", // generic file reused for 4 prayers
  maghrib: "f_gen",
  isyak: "f_gen",
};
const DAY = "2026-09-20";
const times = {
  zone: "SBH05",
  source: "jakim_api",
  updatedAt: "2026-09-20T00:00:00Z",
  days: {
    [DAY]: { imsak: "04:58", subuh: "05:12", syuruk: "06:12", zohor: "12:24", asar: "15:45", maghrib: "18:28", isyak: "19:39" },
  },
};

// Controlled "now": 12:25:10 MYT on 2026-09-20 → 04:25:10Z. Zohor (12:24 MYT =
// 04:24Z) started 70s ago; generic file 300s → azan ACTIVE, offset 70.
const zohorStartMs = azan.prayerTimeToMs(DAY, "12:24"); // 04:24Z
const nowActive = zohorStartMs + 70_000;
const s1 = azan.computeAzanSchedule(nowActive, times, assignments, files);
check("active azan detected", s1.active !== null);
check("active prayer = zohor", s1.active && s1.active.prayer === "zohor");
check("active uses generic Azan.mp3", s1.active && s1.active.driveId === "f_gen");
check("active offset = 70s", s1.active && s1.active.offset === 70);
check("active endsAt = start + 300s", s1.active && s1.active.endsAt === zohorStartMs + 300_000);
check("no next while active (same-day asar later exists)", s1.next && s1.next.prayer === "asar");

// Mid-way between prayers: 14:00 MYT = 06:00Z → next = asar 15:45.
const nowBetween = azan.prayerTimeToMs(DAY, "14:00");
const s2 = azan.computeAzanSchedule(nowBetween, times, assignments, files);
check("no active between prayers", s2.active === null);
check("next = asar", s2.next && s2.next.prayer === "asar");
check("next.startsAt matches 15:45 MYT", s2.next && s2.next.startsAt === azan.prayerTimeToMs(DAY, "15:45"));

// Unassigned prayer is skipped, not crashed: clear all assignments.
const s3 = azan.computeAzanSchedule(nowBetween, times, { subuh: null, zohor: null, asar: null, maghrib: null, isyak: null }, files);
check("empty assignments → no schedule", s3.active === null && s3.next === null);

// Unavailable file is not scheduled.
const s4 = azan.computeAzanSchedule(nowBetween, times, { subuh: "f_dead", zohor: null, asar: null, maghrib: null, isyak: null }, files);
check("unavailable file → no schedule", s4.active === null && s4.next === null);

// Missing day data → no schedule, no crash.
const s5 = azan.computeAzanSchedule(nowBetween, { ...times, days: {} }, assignments, files);
check("missing day → no schedule", s5.active === null && s5.next === null);

// Yesterday rollover: "today" 00:30 MYT, yesterday's isyak 19:39 is long past;
// today's subuh 05:12 is next. Controlled now = 2026-09-21T00:30 MYT = 2026-09-20T16:30Z,
// with only 2026-09-20 data + 2026-09-21 data present.
const times2 = {
  ...times,
  days: {
    ...times.days,
    "2026-09-21": { imsak: "04:58", subuh: "05:13", syuruk: "06:12", zohor: "12:24", asar: "15:45", maghrib: "18:27", isyak: "19:38" },
  },
};
const nowEarly = azan.prayerTimeToMs("2026-09-21", "00:30");
const s6 = azan.computeAzanSchedule(nowEarly, times2, assignments, files);
check("early-morning next = subuh (today)", s6.next && s6.next.prayer === "subuh" && s6.next.startsAt === azan.prayerTimeToMs("2026-09-21", "05:13"));

// Azan just ended (offset window exclusive): now = start + 301s → inactive.
const s7 = azan.computeAzanSchedule(zohorStartMs + 301_000, times, assignments, files);
check("azan ends exactly after duration", s7.active === null);

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
