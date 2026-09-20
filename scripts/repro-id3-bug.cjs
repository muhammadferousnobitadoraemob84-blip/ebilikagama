// Repro: MP3 with a large ID3v2 tag (album art) + false sync bytes inside the
// tag → current parser returns detected:"none"; fixed parser must return the
// exact Xing duration. Also synthesizes a clean CBR file as a control.
//
// Run: node scripts/repro-id3-bug.cjs
"use strict";

// ── Synthesize test MP3s ──────────────────────────────────────────────
function syncsafe(n) {
  return [(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f];
}

// ID3v2.4 tag: header (10B) + fake JPEG-ish body containing 0xFF 0xE? pairs
function makeId3v2Tag(bodyLen) {
  const body = Buffer.alloc(bodyLen);
  for (let i = 0; i < bodyLen; i++) body[i] = (i * 31 + 7) & 0xff;
  // Sprinkle realistic JPEG markers + false frame syncs throughout the "art"
  for (let i = 2; i < bodyLen - 2; i += 97) {
    body[i] = 0xff;
    body[i + 1] = 0xe0 | (i % 8); // false sync candidates of every version/layer
  }
  const header = Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, ...syncsafe(bodyLen)]);
  return Buffer.concat([header, body]);
}

// MPEG1 Layer III 128kbps 44100Hz frame: 144*128000/44100 ≈ 417 bytes (+padding)
function makeFrame(frameIndex, { padding = 0, mpeg1 = true, bitrateIdx = 9 } = {}) {
  const b = Buffer.alloc(mpeg1 ? 417 + padding : 208 + padding);
  b[0] = 0xff;
  b[1] = mpeg1 ? 0xfb : 0xf3; // MPEG1/MPEG2, Layer III, no CRC
  b[2] = mpeg1 ? (bitrateIdx << 4) | (0x00 << 2) | padding : (bitrateIdx << 4) | (0x00 << 2) | padding;
  b[3] = 0xc0; // stereo
  for (let i = 4; i < b.length; i++) b[i] = (i + frameIndex) & 0x7f; // audio-ish data
  return b;
}

function makeXingHeader(numFrames) {
  // Xing tag at offset 4+32 (stereo): "Xing" + flags(frames) + 32-bit count
  const b = Buffer.alloc(16);
  b.write("Xing", 0, "ascii");
  b.writeUInt32BE(0x01, 4); // frames field present
  b.writeUInt32BE(numFrames, 8);
  return b;
}

function buildTestFile({ tagLen, numFrames, xing = true, padding = 0 }) {
  const parts = [];
  if (tagLen) parts.push(makeId3v2Tag(tagLen));
  const frames = [];
  for (let f = 0; f < numFrames; f++) frames.push(makeFrame(f, { padding }));
  const frameLen = 417 + padding;
  if (xing) {
    // splice Xing into first frame
    const first = Buffer.concat([frames[0].subarray(0, 36), makeXingHeader(numFrames), frames[0].subarray(36 + 16)]);
    frames[0] = first;
  }
  const audio = Buffer.concat(frames);
  return { file: Buffer.concat([...parts, audio]), frameLen, numFrames };
}

// ── THE CURRENT (buggy) parser — copied verbatim from src/lib/audio-duration.ts ──
function parseMp3HeadCurrent(buf) {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const bytes = buf;
  const len = Math.min(bytes.length, 65536);
  for (let i = 0; i < len - 4; i++) {
    if (bytes[i] !== 0xff || (bytes[i + 1] & 0xe0) !== 0xe0) continue;
    const versionBits = (bytes[i + 1] >> 3) & 0x03;
    const layerBits = (bytes[i + 1] >> 1) & 0x03;
    const bitrateIdx = (bytes[i + 2] >> 4) & 0x0f;
    const srIdx = (bytes[i + 2] >> 2) & 0x03;
    const channelMode = (bytes[i + 3] >> 6) & 0x03;
    if (layerBits !== 0x01) break; // ← THE BUG: aborts on false sync inside ID3
    const rates = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] }[versionBits];
    if (!rates || srIdx === 3) break;
    const sampleRate = rates[srIdx];
    const bitrateKbps = versionBits === 3 ? [0,32,40,48,56,64,80,96,112,128,160,192,224,256,320][bitrateIdx] : [0,8,16,24,32,40,48,56,64,80,96,112,128,144,160][bitrateIdx];
    if (!bitrateKbps) break;
    const sideInfo = channelMode === 3 ? 17 : 32;
    const xingOff = i + 4 + sideInfo;
    if (xingOff + 16 <= bytes.length) {
      const tag = view.getUint32(xingOff);
      if (tag === 0x58696e67 || tag === 0x496e666f) {
        const flags = view.getUint32(xingOff + 4);
        if (flags & 0x01) {
          const frames = view.getUint32(xingOff + 8);
          const spf = versionBits === 3 ? 1152 : 576;
          return { duration: (frames * spf) / sampleRate, detected: "xing", syncAt: i };
        }
      }
    }
    return { duration: null, bitrate: bitrateKbps, detected: "cbr", syncAt: i };
  }
  return { duration: null, bitrate: null, sampleRate: null, detected: "none", syncAt: -1 };
}

// ── Run ──
const SAMPLE_RATE = 44100;
function report(name, file, expectedDuration) {
  const r = parseMp3HeadCurrent(file);
  const ok = r.detected === "xing" && Math.abs((r.duration ?? 0) - expectedDuration) < 0.1;
  console.log(`${ok ? "✓" : "✗"} ${name}: detected=${r.detected} duration=${r.duration?.toFixed(2) ?? "null"} (expected ${expectedDuration.toFixed(2)}s, false-sync at byte ${r.syncAt})`);
  return ok;
}

const TAG_LEN = 200 * 1024; // 200KB album art → way beyond the 16KB probe window
const NUM_FRAMES = 10000;   // 10000 × 1152 / 44100 ≈ 261.22s

const withXing = buildTestFile({ tagLen: TAG_LEN, numFrames: NUM_FRAMES, xing: true });
const expectedXing = (NUM_FRAMES * 1152) / SAMPLE_RATE;
const t1 = report("VBR+ID3 200KB art (Selawat-like)", withXing.file, expectedXing);

const cbrOnly = buildTestFile({ tagLen: 0, numFrames: NUM_FRAMES, xing: false });
const r2 = parseMp3HeadCurrent(cbrOnly.file);
const cbrOk = r2.detected === "cbr" && r2.bitrate === 128;
console.log(`${cbrOk ? "✓" : "✗"} Clean CBR control: detected=${r2.detected} bitrate=${r2.bitrate}kbps`);
const t2 = cbrOk;

// Xing inside 16KB window but ID3 200KB → current fetchHead(16KB) never sees a frame:
console.log(`\nCurrent scanner fetches only 16KB; ID3 tag is ${TAG_LEN}B → the 16KB window contains ZERO audio frames.`);
console.log(`→ two failure modes: (1) false sync inside tag bytes hits 'break'; (2) even a clean tag window has no frame at all.\n`);

if (!t1 || !t2) {
  console.log("REPRODUCED: parser fails on ID3-tagged file. Proceeding with fix.\n");
  process.exit(0);
} else {
  console.log("Unexpected: current parser handled it — investigate further.");
  process.exit(1);
}
