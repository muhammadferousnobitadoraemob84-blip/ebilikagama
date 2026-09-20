// Verify the NEW parser (compiled from src/lib/audio-duration.ts) against
// synthetic files reproducing the Selawat failure: big ID3v2 art + false 0xFF
// syncs inside the tag, VBR and CBR variants, plus clean controls.
const fs = require("fs");
const path = require("path");
const { parseMp3HeadFromBuffer } = require(path.join(__dirname, "..", ".test-build", "audio-duration.js"));

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✓ ${name}${detail ? " — " + detail : ""}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? " — " + detail : ""}`); }
}

// ---- synthetic file builders -------------------------------------------
function id3v2Tag(sizeBytes) {
  // "ID3" v2.3, flags 0, syncsafe size, then fake album-art-ish bytes
  const body = Buffer.alloc(sizeBytes);
  for (let i = 0; i < sizeBytes; i++) body[i] = (i * 31 + 7) & 0xff; // pseudo JPEG
  // Inject false syncs INSIDE the tag (like JPEG data can contain)
  for (let off = 64; off + 4 < sizeBytes; off += 512) {
    body[off] = 0xff; body[off + 1] = 0xfb; body[off + 2] = 0x90; body[off + 3] = 0x00;
  }
  const sz = sizeBytes;
  const header = Buffer.from([
    0x49, 0x44, 0x33, 0x03, 0x00, 0x00,
    (sz >> 21) & 0x7f, (sz >> 14) & 0x7f, (sz >> 7) & 0x7f, sz & 0x7f,
  ]);
  return Buffer.concat([header, body]);
}

function mpeg1L3Frame(bitrateKbps, sr, padding, fill) {
  const frameLen = Math.floor((144 * bitrateKbps * 1000) / sr) + padding;
  const b = Buffer.alloc(frameLen, fill === undefined ? 0x00 : fill);
  const bitrateIdx = { 32: 1, 64: 2, 96: 5, 128: 9, 160: 10, 192: 11, 256: 13, 320: 14 }[bitrateKbps];
  const srIdx = { 44100: 0, 48000: 1, 32000: 2 }[sr];
  b[0] = 0xff; b[1] = 0xfb; // MPEG1 Layer III, no CRC
  b[2] = (bitrateIdx << 4) | (srIdx << 2) | (padding << 1);
  b[3] = 0xc0; // stereo
  return b;
}

function xingFrame(bitrateKbps, sr, frames, channels) {
  const frameLen = Math.floor((144 * bitrateKbps * 1000) / sr);
  const sideInfo = channels === 3 ? 17 : 32;
  // Build Xing header at correct offset within a big first frame
  const big = Buffer.alloc(frameLen);
  big[0] = 0xff; big[1] = 0xfb;
  const bitrateIdx = { 128: 9, 160: 10, 192: 11, 256: 13 }[bitrateKbps];
  const srIdx = { 44100: 0, 48000: 1 }[sr];
  big[2] = (bitrateIdx << 4) | (srIdx << 2);
  big[3] = channels === 3 ? 0xc0 : 0x40;
  big.write("Xing", 4 + sideInfo);
  big.writeUInt32BE(0x00000001, 4 + sideInfo + 4); // frames flag
  big.writeUInt32BE(frames, 4 + sideInfo + 8);
  return big;
}

// ---- tests --------------------------------------------------------------
console.log("NEW parser tests:");
const SR = 44100;

// 1. Clean CBR, no tag
{
  const frames = Buffer.concat(Array.from({ length: 200 }, () => mpeg1L3Frame(128, SR, 0)));
  const m = parseMp3HeadFromBuffer(frames.buffer.slice(frames.byteOffset, frames.byteOffset + frames.length));
  check("clean CBR detects 128kbps", m.detected === "cbr" && m.bitrate === 128, JSON.stringify(m));
}
// 2. VBR with Xing, no tag
{
  const f = xingFrame(128, SR, 10000, 0);
  const tail = Buffer.concat(Array.from({ length: 50 }, () => mpeg1L3Frame(128, SR, 0)));
  const buf = Buffer.concat([f, tail]);
  const m = parseMp3HeadFromBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length));
  check("Xing VBR exact duration", m.detected === "xing" && Math.abs(m.duration - (10000 * 1152) / SR) < 0.01,
    m.detected === "xing" ? `${m.duration.toFixed(1)}s` : JSON.stringify(m));
}
// 3. THE SELAWAT CASE: 200KB ID3 art + false syncs + VBR Xing audio
{
  const tag = id3v2Tag(200 * 1024);
  const f = xingFrame(160, SR, 18500, 0);
  const tail = Buffer.concat(Array.from({ length: 50 }, () => mpeg1L3Frame(160, SR, 0)));
  const buf = Buffer.concat([tag, f, tail]);
  const m = parseMp3HeadFromBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length));
  const expected = (18500 * 1152) / SR;
  check("200KB ID3 art + false syncs + Xing → exact duration",
    m.detected === "xing" && Math.abs(m.duration - expected) < 0.01 && m.tagBytes === 200 * 1024 + 10,
    m.detected === "xing" ? `${m.duration.toFixed(1)}s (expect ${expected.toFixed(1)}s), tag=${m.tagBytes}B` : JSON.stringify({ ...m, duration: m.duration && m.duration.toFixed(2) }));
}
// 4. Big ID3 + CBR audio (duration via size/bitrate at caller) — bitrate must be right
{
  const tag = id3v2Tag(120 * 1024);
  const frames = Buffer.concat(Array.from({ length: 300 }, () => mpeg1L3Frame(192, SR, 0)));
  const buf = Buffer.concat([tag, frames]);
  const m = parseMp3HeadFromBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length));
  check("120KB ID3 + CBR 192k → correct bitrate", m.detected === "cbr" && m.bitrate === 192,
    `bitrate=${m.bitrate} tag=${m.tagBytes}B`);
}
// 5. Truncated ID3 header (tag claims 200KB but only 10KB total) — must not hang/return garbage
{
  const tag = id3v2Tag(200 * 1024).subarray(0, 10 * 1024);
  const frames = Buffer.concat(Array.from({ length: 60 }, () => mpeg1L3Frame(128, SR, 0)));
  const buf = Buffer.concat([tag, frames]);
  const m = parseMp3HeadFromBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length));
  check("truncated ID3 tag still finds audio", m.detected === "cbr" && m.bitrate === 128, JSON.stringify({ ...m, duration: m.duration }));
}
// 6. Garbage → none
{
  const junk = Buffer.alloc(64 * 1024, 0x42);
  const m = parseMp3HeadFromBuffer(junk.buffer.slice(junk.byteOffset, junk.byteOffset + junk.length));
  check("non-audio junk → none", m.detected === "none");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
