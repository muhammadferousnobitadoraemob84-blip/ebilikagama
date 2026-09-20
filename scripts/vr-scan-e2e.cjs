// Production E2E for the scanner fix: login as the disclosed admin fixture,
// rescan the configured radio folder, verify the Selawat MP3 is handled
// correctly, and confirm the misleading error is gone.
//
// Read-only against Drive (listing + small ranged reads); the scan writes
// ONLY radio settings metadata. Deletes nothing, modifies no user data.
const fs = require("fs");
const os = require("os");
const path = require("path");
const CREDS = JSON.parse(
  fs.readFileSync(path.join(os.tmpdir(), "vr-test-creds.json"), "utf8")
);

const BASE = "https://ebilikagamabeta.vercel.app";
const jar = { admin: null };

async function api(name, fetcher) {
  try {
    return await fetcher();
  } catch (e) {
    return { __error: String(e && e.message ? e.message : e) };
  } finally {
    void name;
  }
}

async function login(username, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const setCookie = res.headers.get("set-cookie") || "";
  const token = (setCookie.match(/admin-token=([^;]*)/) || [])[1];
  return { ok: res.ok, status: res.status, cookie: token ? token : null };
}

function authed(cookie) {
  return { Cookie: `admin-token=${cookie}` };
}

(async () => {
  console.log("── login as admin fixture ──");
  const admin = await login(CREDS.username, CREDS.password);
  console.log(`admin login: ${admin.status} ${admin.ok ? "OK" : "FAIL"}`);
  if (!admin.ok) process.exit(1);
  jar.admin = admin.cookie;

  // 1. Rescan
  console.log("\n── POST /api/virtual-radio/scan ──");
  const scan = await api("scan", () =>
    fetch(`${BASE}/api/virtual-radio/scan`, {
      method: "POST",
      headers: authed(jar.admin),
    }).then((r) => r.json())
  );
  console.log(JSON.stringify(scan, null, 2));

  // 2. Current state
  console.log("\n── GET /api/virtual-radio/config ──");
  const state = await api("state", () =>
    fetch(`${BASE}/api/virtual-radio/config`, {
      headers: authed(jar.admin),
    }).then((r) => r.json())
  );
  const selawat = [...(state.tracks || []), ...(state.pending || [])].filter((t) =>
    /selawat/i.test(t.fileName || "")
  );
  console.log(
    `state: playlist=${(state.tracks || []).length} pending=${(state.pending || []).length} ` +
      `totalDuration=${Math.round(state.totalDuration || 0)}s epoch=${state.epoch ? "set" : "none"} enabled=${state.enabled}`
  );
  console.log("Selawat entries:", JSON.stringify(selawat, null, 2));

  // 3. Stream range check for Selawat (or first playlist track as fallback)
  const probeTrack =
    selawat[0] || (state.tracks || [])[0] || (state.pending || [])[0];
  if (probeTrack) {
    console.log(
      `\n── stream range check: ${probeTrack.fileName} ──`
    );
    const sres = await fetch(
      `${BASE}/api/virtual-radio/stream?id=${encodeURIComponent(probeTrack.driveId)}`,
      { headers: { ...authed(jar.admin), Range: "bytes=0-2047" } }
    );
    const ct = sres.headers.get("content-type");
    const cr = sres.headers.get("content-range");
    const via = sres.headers.get("x-served-via");
    const buf = Buffer.from(await sres.arrayBuffer());
    const hasSync =
      buf.length > 4 &&
      [...buf].some((_, i) => buf[i] === 0xff && (buf[i + 1] & 0xe0) === 0xe0);
    console.log(
      `stream: ${sres.status} ct=${ct} range=${cr} via=${via} bytes=${buf.length} mp3sync=${hasSync}`
    );
  }

  // 4. Timeline position sanity
  console.log("\n── timeline position ──");
  const diag = await api("diag", () =>
    fetch(`${BASE}/api/virtual-radio/diagnostic`, {
      headers: authed(jar.admin),
    }).then((r) => r.json())
  );
  if (diag && diag.position) {
    console.log(
      `server position: #${diag.position.index + 1} ${diag.position.fileName} @ ${Math.round(diag.position.offset)}s (cycle ${diag.position.cycle})`
    );
  } else {
    console.log("diagnostic:", JSON.stringify(diag).slice(0, 300));
  }

  console.log("\nE2E complete.");
})().catch((e) => {
  console.error("E2E fatal:", e);
  process.exit(1);
});
