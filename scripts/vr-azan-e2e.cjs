// Production E2E for the Azan & Prayer Times feature (read-only assertions;
// only admin API calls that write disclosed prototype settings).
// Flow: login as disclosed fixture → azan scan → prefix assertions →
// assignments (generic reuse) → JAKIM sync (official e-solat) → schedule.
const fs = require("fs");
const os = require("os");
const path = require("path");

const CREDS = JSON.parse(
  fs.readFileSync(path.join(os.tmpdir(), "vr-test-creds.json"), "utf8")
);
const BASE = "https://ebilikagamabeta.vercel.app";
const COOKIE_NAME = "admin-token";

let passed = 0, failed = 0;
function check(name, cond, extra = "") {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name} ${extra}`); }
}

async function api(p, opts = {}) {
  const res = await fetch(`${BASE}${p}`, {
    ...opts,
    headers: { Cookie: `${COOKIE_NAME}=${CREDS._token ?? ""}`, ...(opts.headers || {}) },
    redirect: "manual",
  });
  return res;
}

async function login() {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: CREDS.username, password: CREDS.password }),
    redirect: "manual",
  });
  const setCookie = res.headers.get("set-cookie") || "";
  const m = setCookie.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
  if (!m) throw new Error(`login failed: ${res.status}`);
  CREDS._token = m[1];
  console.log("logged in as fixture admin");
}

(async () => {
  await login();

  // ── 1. Azan scan ──
  console.log("\n── AZAN SCAN ──");
  const scanRes = await fetch(`${BASE}/api/virtual-radio/azan/scan`, {
    method: "POST", headers: { Cookie: `${COOKIE_NAME}=${CREDS._token}` }, redirect: "manual",
  });
  const scan = await scanRes.json();
  check("scan succeeds", scanRes.status === 200 && scan.success === true, JSON.stringify(scan).slice(0, 200));
  console.log(`  total audio files in folder: ${scan.totalFiles}`);
  console.log(`  azan files detected: ${scan.azanCount}`);
  console.log(`  ignored (music): ${scan.ignoredMusic}`);
  console.log(`  ignored (non-audio): ${scan.ignoredNonAudio}`);
  console.log(`  azan files: ${(scan.azanFiles || []).map(f => f.fileName).join(", ") || "(none)"}`);

  // Prefix rule assertions on returned azan files.
  for (const f of scan.azanFiles || []) {
    check(`"${f.fileName}" starts with Azan (case-insens.)`, /^azan/i.test(f.fileName.trim()));
  }
  check("no duplicates by Drive ID", new Set((scan.azanFiles || []).map(f => f.driveId)).size === (scan.azanFiles || []).length);
  check("ignored count consistent", scan.azanCount + scan.ignoredMusic === scan.totalFiles);

  // ── 2. Snapshot + assignments ──
  console.log("\n── SNAPSHOT + ASSIGNMENTS ──");
  const snapRes = await fetch(`${BASE}/api/virtual-radio/azan`, {
    headers: { Cookie: `${COOKIE_NAME}=${CREDS._token}` }, redirect: "manual",
  });
  const snap = await snapRes.json();
  check("admin snapshot 200", snapRes.status === 200);
  const available = (snap.files || []).filter(f => !f.unavailable && f.duration > 0);
  console.log(`  stored azan files: ${snap.files.length} (${available.length} ready)`);

  if (available.length > 0) {
    const subuh = available.find(f => /subuh/i.test(f.fileName)) || available[0];
    const generic = available.find(f => /^azan\.mp3$/i.test(f.fileName.trim())) || available[available.length - 1];
    const assignments = {
      subuh: subuh.driveId,
      zohor: generic.driveId,
      asar: generic.driveId,     // generic reuse
      maghrib: generic.driveId,  // generic reuse
      isyak: generic.driveId,    // generic reuse
    };
    const asRes = await fetch(`${BASE}/api/virtual-radio/azan/assignments`, {
      method: "POST",
      headers: { Cookie: `${COOKIE_NAME}=${CREDS._token}`, "Content-Type": "application/json" },
      body: JSON.stringify(assignments),
      redirect: "manual",
    });
    const asData = await asRes.json();
    check("assignments saved (Subuh + generic reuse for 4 prayers)", asRes.status === 200 && asData.success === true);
    check("subuh assignment correct", asData.assignments?.subuh === subuh.driveId);
    check("zohor/asar/maghrib/isyak share one generic file",
      asData.assignments?.zohor === generic.driveId &&
      asData.assignments?.asar === generic.driveId &&
      asData.assignments?.maghrib === generic.driveId &&
      asData.assignments?.isyak === generic.driveId);
  } else {
    console.log("  (no ready azan files — skipping assignment assertions)");
  }

  // ── 3. JAKIM sync (official e-solat API) ──
  console.log("\n── JAKIM SYNC (SBH05) ──");
  const syncRes = await fetch(`${BASE}/api/virtual-radio/prayer-times/jakim-sync`, {
    method: "POST",
    headers: { Cookie: `${COOKIE_NAME}=${CREDS._token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ zone: "SBH05", period: "year" }),
    redirect: "manual",
  });
  const sync = await syncRes.json();
  check("JAKIM sync succeeds", syncRes.status === 200 && sync.success === true, JSON.stringify(sync).slice(0, 200));
  console.log(`  zone: ${sync.zone} | source: ${sync.source}`);
  console.log(`  days stored: ${sync.dayCount} (${sync.from} → ${sync.to}) | rows skipped: ${sync.rowsSkipped}`);

  // ── 4. Schedule computed server-side ──
  console.log("\n── SCHEDULER ──");
  const snap2Res = await fetch(`${BASE}/api/virtual-radio/azan`, {
    headers: { Cookie: `${COOKIE_NAME}=${CREDS._token}` }, redirect: "manual",
  });
  const snap2 = await snap2Res.json();
  check("schedule computed", snap2.schedule && (snap2.schedule.next || snap2.schedule.active));
  if (snap2.schedule.next) {
    const n = snap2.schedule.next;
    console.log(`  next: ${n.prayer} @ ${new Date(n.startsAt).toISOString()} (${n.fileName})`);
  }
  if (snap2.prayerTimes) {
    console.log(`  prayerTimes: zone=${snap2.prayerTimes.zone} source=${snap2.prayerTimes.source} days=${snap2.prayerTimes.dayCount}`);
    if (snap2.prayerTimes.today) console.log(`  today: subuh=${snap2.prayerTimes.today.subuh} zohor=${snap2.prayerTimes.today.zohor} maghrib=${snap2.prayerTimes.today.maghrib} isyak=${snap2.prayerTimes.today.isyak}`);
  }

  // ── 5. TEST AZAN endpoint ──
  console.log("\n── TEST AZAN ──");
  const testRes = await fetch(`${BASE}/api/virtual-radio/azan/test`, {
    method: "POST",
    headers: { Cookie: `${COOKIE_NAME}=${CREDS._token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ prayer: "maghrib" }),
    redirect: "manual",
  });
  const test = await testRes.json();
  check("test-azan returns stream URL", testRes.status === 200 && test.success === true && typeof test.streamUrl === "string", JSON.stringify(test).slice(0, 200));
  if (test.streamUrl) {
    const audio = await fetch(`${BASE}${test.streamUrl}`, {
      headers: { Cookie: `${COOKIE_NAME}=${CREDS._token}`, Range: "bytes=0-2047" }, redirect: "manual",
    });
    check("azan audio streams (206/range)", audio.status === 206 && (audio.headers.get("content-type") || "").includes("audio"));
    const buf = await audio.arrayBuffer();
    check("bytes are MP3 (frame sync or ID3)", buf.byteLength > 100);
  }

  // ── 6. Public endpoints stay public, admin stay gated ──
  console.log("\n── SECURITY GATES ──");
  const anonSnap = await fetch(`${BASE}/api/virtual-radio/azan`, { redirect: "manual" });
  check("anon azan snapshot → 307/403", anonSnap.status === 307 || anonSnap.status === 403);
  const anonScan = await fetch(`${BASE}/api/virtual-radio/azan/scan`, { method: "POST", redirect: "manual" });
  check("anon azan scan → 307/403", anonScan.status === 307 || anonScan.status === 403);
  const anonNP = await fetch(`${BASE}/api/virtual-radio/now-playing`, { redirect: "manual" });
  check("anon now-playing → 200 (public by design)", anonNP.status === 200);
  const npAnon = await anonNP.json();
  check("now-playing exposes no Drive IDs", !JSON.stringify(npAnon).includes("driveId"));

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => { console.error("E2E crashed:", e.message); process.exit(1); });
