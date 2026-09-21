// Temporarily injects an azan record (real Drive file ID so streaming works,
// synthetic filename) + assignments so the scheduler can be E2E-tested, then
// restores the previous settings. Writes ONLY prototype Setting rows.
// Usage: node vr-azan-inject.cjs up|down
const fs = require("fs");
const path = require("path");

// Resolve the DB URL exactly like src/lib/prisma.ts (single source of truth).
function resolveDbUrl() {
  const prismaPath = path.join(__dirname, "..", "src", "lib", "prisma.ts");
  const src = fs.readFileSync(prismaPath, "utf8");
  const m = src.match(/CORRECT_DB_URL = `([^`]+)`/);
  if (m) {
    // Interpolate the host constant the template references.
    const host = (src.match(/CORRECT_DB_HOST = "([^"]+)"/) || [])[1] ?? "";
    return m[1].replace(/\$\{CORRECT_DB_HOST\}/g, host);
  }
  throw new Error("Could not resolve CORRECT_DB_URL from src/lib/prisma.ts");
}

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient({ datasources: { db: { url: resolveDbUrl() } } });

const K_FILES = "virtual_radio_azan_files";
const K_ASSIGN = "virtual_radio_azan_assignments";
const BACKUP = path.join(require("os").tmpdir(), "vr-azan-inject-backup.json");

const mode = process.argv[2];

(async () => {
  if (mode === "up") {
    // Find a real file ID from the current radio playlist (streams validly).
    const playlistRaw = await prisma.setting.findUnique({ where: { key: "virtual_radio_playlist" } });
    if (!playlistRaw) throw new Error("radio playlist not found");
    const playlist = JSON.parse(playlistRaw.value);
    if (!playlist.length) throw new Error("radio playlist empty");
    const donor = playlist[0];

    const prevFiles = await prisma.setting.findUnique({ where: { key: K_FILES } });
    const prevAssign = await prisma.setting.findUnique({ where: { key: K_ASSIGN } });
    fs.writeFileSync(BACKUP, JSON.stringify({
      files: prevFiles ? JSON.parse(prevFiles.value) : null,
      assign: prevAssign ? JSON.parse(prevAssign.value) : null,
    }));

    const injected = [{
      driveId: donor.driveId, // REAL id → stream proxy + Drive fetch work
      fileName: "Azan Test Injected.mp3",
      mimeType: "audio/mpeg",
      size: donor.size ?? null,
      duration: donor.duration,
      durationPending: false,
      unavailable: false,
    }];
    await prisma.setting.upsert({
      where: { key: K_FILES },
      update: { value: JSON.stringify(injected) },
      create: { key: K_FILES, value: JSON.stringify(injected) },
    });
    await prisma.setting.upsert({
      where: { key: K_ASSIGN },
      update: { value: JSON.stringify({ subuh: donor.driveId, zohor: donor.driveId, asar: donor.driveId, maghrib: donor.driveId, isyak: donor.driveId }) },
      create: { key: K_ASSIGN, value: JSON.stringify({ subuh: donor.driveId, zohor: donor.driveId, asar: donor.driveId, maghrib: donor.driveId, isyak: donor.driveId }) },
    });
    console.log(`injected azan record (donor: "${donor.fileName}", ${Math.round(donor.duration)}s) + assignments for all 5 prayers`);
  } else if (mode === "down") {
    const backup = JSON.parse(fs.readFileSync(BACKUP, "utf8"));
    const restore = async (key, val) => {
      if (val === null) {
        try { await prisma.setting.delete({ where: { key } }); } catch {}
      } else {
        await prisma.setting.upsert({ where: { key }, update: { value: JSON.stringify(val) }, create: { key, value: JSON.stringify(val) } });
      }
    };
    await restore(K_FILES, backup.files);
    await restore(K_ASSIGN, backup.assign);
    console.log("azan settings restored to pre-injection state");
  } else {
    console.error("usage: node vr-azan-inject.cjs up|down");
    process.exit(1);
  }
  await prisma.$disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
