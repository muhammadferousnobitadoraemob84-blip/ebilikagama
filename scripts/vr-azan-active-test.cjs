// Controlled-time test: make an azan ACTIVE right now by temporarily setting
// today's Maghrib to (serverNow − 45s), then verify the PUBLIC now-playing
// endpoint reports azan.active with correct offset math. Restores after.
// Writes ONLY prototype Setting rows; restores both.
const fs = require("fs");
const path = require("path");
const os = require("os");

function resolveDbUrl() {
  const src = fs.readFileSync(path.join(__dirname, "..", "src", "lib", "prisma.ts"), "utf8");
  const m = src.match(/CORRECT_DB_URL = `([^`]+)`/);
  const host = (src.match(/CORRECT_DB_HOST = "([^"]+)"/) || [])[1] ?? "";
  return m[1].replace(/\$\{CORRECT_DB_HOST\}/g, host);
}
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient({ datasources: { db: { url: resolveDbUrl() } } });

const K_TIMES = "virtual_radio_prayer_times";
const BASE = "https://ebilikagamabeta.vercel.app";

(async () => {
  const serverNow = Date.now();
  // Malaysia-local date + HH:MM for (serverNow − 45s).
  const d = new Date(serverNow - 45_000 + 8 * 3600_000);
  const dateKey = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  const hhmm = `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;

  const prev = await prisma.setting.findUnique({ where: { key: K_TIMES } });
  const backupFile = path.join(os.tmpdir(), "vr-azan-times-backup.json");
  fs.writeFileSync(backupFile, JSON.stringify(prev ? prev.value : null));

  const data = prev ? JSON.parse(prev.value) : { zone: "SBH05", source: "jakim_api", updatedAt: new Date().toISOString(), days: {} };
  data.days[dateKey] = {
    imsak: "04:58", subuh: "05:12", syuruk: "06:12", zohor: "12:24",
    asar: "15:45", maghrib: hhmm, isyak: "19:39",
  };
  await prisma.setting.upsert({
    where: { key: K_TIMES },
    update: { value: JSON.stringify(data) },
    create: { key: K_TIMES, value: JSON.stringify(data) },
  });
  console.log(`maghrib set to ${hhmm} MYT (${dateKey}) — azan should be ~45s in, ending in ~${Math.round(283 - 45)}s`);

  // Poll the PUBLIC endpoint.
  const np = await (await fetch(`${BASE}/api/virtual-radio/now-playing`, { redirect: "manual" })).json();
  const a = np.azan && np.azan.active;
  if (!a) {
    console.error("✗ azan.active is NULL — active-azan path FAILED");
    process.exitCode = 1;
  } else {
    console.log(`✓ azan.active: prayer=${a.prayer} file=${a.fileName} offset=${Math.round(a.offset)}s / ${Math.round(a.duration)}s endsAt-in=${Math.round((a.endsAt - np.serverTime) / 1000)}s`);
    const okPrayer = a.prayer === "maghrib";
    const okOffset = a.offset >= 40 && a.offset <= 75; // ~45s + request latency
    console.log(`${okPrayer ? "✓" : "✗"} prayer == maghrib`);
    console.log(`${okOffset ? "✓" : "✗"} offset within [40,75]s window`);
    if (!okPrayer || !okOffset) process.exitCode = 1;
  }

  // Restore.
  const backupVal = JSON.parse(fs.readFileSync(backupFile, "utf8"));
  if (backupVal === null) {
    try { await prisma.setting.delete({ where: { key: K_TIMES } }); } catch {}
  } else {
    await prisma.setting.update({ where: { key: K_TIMES }, data: { value: backupVal } });
  }
  console.log("prayer times restored (real JAKIM data back in place)");
  await prisma.$disconnect();
})().catch((e) => { console.error("crashed:", e.message); process.exit(1); });
