// Production E2E part 2 — run AFTER vr-azan-inject.cjs up (which stores a
// temporary azan record + assignments). Verifies scheduler math against the
// real stored prayer times, TEST AZAN audio streaming, and the public
// now-playing azan fields. Read-only assertions; restores via inject down.
const fs = require("fs");
const os = require("os");
const path = require("path");

const CREDS = JSON.parse(fs.readFileSync(path.join(os.tmpdir(), "vr-test-creds.json"), "utf8"));
const BASE = "https://ebilikagamabeta.vercel.app";
const COOKIE = () => `admin-token=${CREDS._token}`;

let passed = 0, failed = 0;
function check(name, cond, extra = "") {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name} ${extra}`); }
}

(async () => {
  // login
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: CREDS.username, password: CREDS.password }),
    redirect: "manual",
  });
  const m = (res.headers.get("set-cookie") || "").match(/admin-token=([^;]+)/);
  if (!m) throw new Error("login failed");
  CREDS._token = m[1];
  console.log("logged in\n");

  // ── Re-sync JAKIM with the fixed parser ──
  console.log("── JAKIM RE-SYNC (fixed Malay-month parser) ──");
  const syncRes = await fetch(`${BASE}/api/virtual-radio/prayer-times/jakim-sync`, {
    method: "POST",
    headers: { Cookie: COOKIE(), "Content-Type": "application/json" },
    body: JSON.stringify({ zone: "SBH05", period: "year" }),
    redirect: "manual",
  });
  const sync = await syncRes.json();
  check("sync 200", syncRes.status === 200 && sync.success === true, JSON.stringify(sync).slice(0, 120));
  check("365/365 days parsed, 0 skipped", sync.dayCount === 365 && sync.rowsSkipped === 0,
    `got ${sync.dayCount}/${sync.rowsSkipped}`);
  console.log(`  days: ${sync.dayCount} (${sync.from} → ${sync.to})`);

  // ── Snapshot: injected file + assignments present ──
  console.log("\n── SNAPSHOT ──");
  const snap = await (await fetch(`${BASE}/api/virtual-radio/azan`, { headers: { Cookie: COOKIE() }, redirect: "manual" })).json();
  const ready = snap.files.filter(f => !f.unavailable && f.duration > 0);
  check("injected azan file present & ready", ready.length === 1 && ready[0].fileName === "Azan Test Injected.mp3",
    JSON.stringify(snap.files.map(f => ({ n: f.fileName, u: f.unavailable, d: f.duration }))));
  check("assignments cover all 5 prayers", ["subuh","zohor","asar","maghrib","isyak"].every(p => snap.assignments[p] === ready[0]?.driveId));
  check("zone stored", snap.prayerZone === "SBH05");
  check("prayerTimes metadata", snap.prayerTimes && snap.prayerTimes.source === "jakim_api" && snap.prayerTimes.dayCount === 365);

  // ── Scheduler: verify the next event matches stored prayer times ──
  console.log("\n── SCHEDULER ──");
  const sched = snap.schedule;
  check("schedule has next event", !!sched.next, JSON.stringify(sched));
  if (sched.next) {
    const n = sched.next;
    // The next event's start must equal one of today's/tomorrow's prayer times.
    const pt = snap.prayerTimes;
    const startsAtMYT = new Date(n.startsAt + 8 * 3600_000).toISOString().slice(11, 16);
    const dayKey = new Date(n.startsAt + 8 * 3600_000).toISOString().slice(0, 10);
    // Fetch that day's times from the stored map via the admin snapshot's today is insufficient;
    // instead verify consistency: startsAt mod nothing — compare against a fresh sync? Keep it
    // simple: the time-of-day must match one of the 5 prayers for that Malaysia-local date.
    const candidates = ["subuh", "zohor", "asar", "maghrib", "isyak"];
    // We only have 'today' in the snapshot; for the correct day we rely on the JAKIM raw data.
    const jakim = require("C:/Users/muham/AppData/Local/Temp/jakim.json");
    const row = jakim.prayerTime.find(r => {
      const mm = { Jan:"01",Feb:"02",Mac:"03",Mar:"03",Apr:"04",Mei:"05",May:"05",Jun:"06",Jul:"07",Ogos:"08",Aug:"08",Sep:"09",Okt:"10",Oct:"10",Nov:"11",Dis:"12",Dec:"12" }[r.date.split("-")[1]];
      const dd = r.date.split("-")[0].padStart(2, "0");
      return `${r.date.split("-")[2]}-${mm}-${dd}` === dayKey;
    });
    const prayerField = { subuh: "fajr", zohor: "dhuhr", asar: "asr", maghrib: "maghrib", isyak: "isha" }[n.prayer];
    const expectMYT = row ? row[prayerField].slice(0, 5) : null;
    check(`next=${n.prayer} at ${startsAtMYT} MYT matches JAKIM ${prayerField}=${expectMYT}`, expectMYT === startsAtMYT,
      `expected ${expectMYT}`);
    console.log(`  next azan: ${n.prayer} ${startsAtMYT} MYT — ${n.fileName}`);
  }
  check("no azan active right now", sched.active === null);

  // ── TEST AZAN: stream URL + real audio bytes ──
  console.log("\n── TEST AZAN ──");
  const testRes = await fetch(`${BASE}/api/virtual-radio/azan/test`, {
    method: "POST",
    headers: { Cookie: COOKIE(), "Content-Type": "application/json" },
    body: JSON.stringify({ prayer: "maghrib" }),
    redirect: "manual",
  });
  const test = await testRes.json();
  check("test-azan 200 + streamUrl", testRes.status === 200 && typeof test.streamUrl === "string", JSON.stringify(test).slice(0, 120));
  if (test.streamUrl) {
    const audio = await fetch(`${BASE}${test.streamUrl}`, {
      headers: { Cookie: COOKIE(), Range: "bytes=0-4095" }, redirect: "manual",
    });
    check("azan stream 206 + audio/mpeg", audio.status === 206 && (audio.headers.get("content-type") || "").includes("audio"),
      `${audio.status} ${audio.headers.get("content-type")}`);
    const buf = Buffer.from(await audio.arrayBuffer());
    const hasSync = buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33; // "ID3"
    check("bytes look like MP3 (ID3 or frame sync)", hasSync || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0));
  }

  // ── Public now-playing reflects azan fields (no IDs leaked) ──
  console.log("\n── PUBLIC NOW-PLAYING ──");
  const np = await (await fetch(`${BASE}/api/virtual-radio/now-playing`, { redirect: "manual" })).json();
  check("azan.active null when nothing live", np.azan && np.azan.active === null);
  check("azan.next present for logged-out visitors too", np.azan && np.azan.next && typeof np.azan.next.prayer === "string");
  check("no Drive IDs / file IDs in payload", !JSON.stringify(np).includes("driveId"));

  // ── Controlled-time schedule check is covered by unit tests (28/28) ──
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => { console.error("E2E crashed:", e.message); process.exit(1); });
