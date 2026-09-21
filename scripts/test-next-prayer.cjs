// Unit tests for computeNextPrayerFromTimes (homepage card helper).
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pt-test-"));
const tsc = path.join(__dirname, "..", "node_modules", "typescript", "bin", "tsc");
execSync(
  `"${process.execPath}" "${tsc}" src/lib/azan.ts --outDir "${tmp}" --module commonjs --target es2020 --moduleResolution node --esModuleInterop --skipLibCheck`,
  { cwd: path.join(__dirname, ".."), stdio: "pipe" }
);
const azan = require(path.join(tmp, "azan.js"));

let passed = 0, failed = 0;
const check = (n, c) => { if (c) { passed++; console.log(`  ✓ ${n}`); } else { failed++; console.error(`  ✗ ${n}`); } };

const DAY0 = "2026-09-21";
const DAY1 = "2026-09-22";
const times = {
  zone: "SBH07", source: "jakim_api", updatedAt: "2026-09-21T00:00:00Z",
  days: {
    [DAY0]: { imsak: "04:45", subuh: "04:55", syuruk: "06:05", zohor: "12:10", asar: "15:35", maghrib: "18:15", isyak: "19:30" },
    [DAY1]: { imsak: "04:45", subuh: "04:55", syuruk: "06:05", zohor: "12:10", asar: "15:35", maghrib: "18:14", isyak: "19:29" },
  },
};

// 10:00 MYT = 02:00Z → next = zohor 12:10 today.
const now1 = azan.prayerTimeToMs(DAY0, "10:00");
const r1 = azan.computeNextPrayerFromTimes(now1, times);
check("mid-morning → zohor today", r1 && r1.prayer === "zohor" && r1.startsAt === azan.prayerTimeToMs(DAY0, "12:10"));
check("timeLabel is HH:MM", r1 && r1.timeLabel === "12:10");

// Exactly AT a prayer time → next is the FOLLOWING prayer (strictly after).
const now2 = azan.prayerTimeToMs(DAY0, "12:10");
const r2 = azan.computeNextPrayerFromTimes(now2, times);
check("at zohor → asar (strictly after)", r2 && r2.prayer === "asar");

// 20:00 MYT (after isyak 19:30) → next is subuh TOMORROW.
const now3 = azan.prayerTimeToMs(DAY0, "20:00");
const r3 = azan.computeNextPrayerFromTimes(now3, times);
check("late night → subuh tomorrow", r3 && r3.prayer === "subuh" && r3.startsAt === azan.prayerTimeToMs(DAY1, "04:55"));

// 00:30 MYT → subuh today.
const now4 = azan.prayerTimeToMs(DAY1, "00:30");
const r4 = azan.computeNextPrayerFromTimes(now4, times);
check("just after midnight → subuh today", r4 && r4.prayer === "subuh");

// Only yesterday's data → null (no coverage for today/tomorrow).
const past = { ...times, days: { "2026-09-20": times.days[DAY0] } };
const r5 = azan.computeNextPrayerFromTimes(now1, past);
check("no data coverage → null", r5 === null);

// Null data → null.
check("null times → null", azan.computeNextPrayerFromTimes(now1, null) === null);

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
