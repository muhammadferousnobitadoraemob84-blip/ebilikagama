// Read MP3 duration WITHOUT storing or touching audio bytes anywhere.
//
// Strategy per file:
//   1. Parse & SKIP any ID3v2 tag (album art can be hundreds of KB; the old
//      parser scanned from byte 0 and false-matched 0xFF bytes inside the
//      art data → "Duration could not be detected" on perfectly good files).
//   2. Locate the first MPEG audio frame using a strict validator, then read
//      the Xing/Info/VBRI header (VBR files carry exact duration there).
//   3. CBR estimate: duration ≈ fileSize / median bitrate of sampled frames.
//      A single frame is noisy (side-info / ancillary bytes can mimic
//      headers); sampling several real, correctly-sized frames fixes that.
//   4. M4A/AAC fallback: parse the `mvhd` box for duration.
//
// Sources, in order: authenticated Drive API (alt=media) → anonymous
// link-shared download. Mirrors the proven quran-audio/stream fallbacks.
// Only small ranged GETs are issued — never full-file downloads — so
// scanning a long playlist costs a few tens of KB per track.

const XING_HEADER = 0x58_69_6e_67; // "Xing"
const INFO_HEADER = 0x49_6e_66_6f; // "Info"
const VBRI_HEADER = 0x56_42_52_49; // "VBRI"

// MPEG-1 Layer III bitrate table (kbps), indexed by the 4-bit field.
const MPEG1_L3_BITRATES = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
// MPEG-2/2.5 Layer III (lower bitrates)
const MPEG2_L3_BITRATES = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
// Sample rates per MPEG version (bits: 00=v1 01=v2 10=v2.5, index by 2-bit field)
const SAMPLE_RATES: Record<number, number[]> = {
  3: [44100, 48000, 32000], // MPEG1
  2: [22050, 24000, 16000], // MPEG2
  0: [11025, 12000, 8000], // MPEG2.5
};

const AUDIO_EXTENSIONS = /\.(mp3|m4a|ogg|wav|webm|flac|aac|opus)$/i;

export interface AudioMeta {
  duration: number | null; // seconds
  bitrate: number | null; // kbps
  sampleRate: number | null;
  detected: "xing" | "cbr" | "mvhd" | "none";
  /** Size in bytes of the tag prefix before the first audio frame (0 if none). */
  tagBytes?: number;
}

function isAudioFile(file: { name: string; mimeType?: string }): boolean {
  if (file.mimeType?.startsWith("audio/")) return true;
  if (
    file.mimeType === "application/octet-stream" ||
    file.mimeType === "application/binary" ||
    !file.mimeType
  ) {
    return AUDIO_EXTENSIONS.test(file.name);
  }
  return AUDIO_EXTENSIONS.test(file.name);
}

/** Fetch a byte range of a Drive file via the authenticated API. */
async function fetchRange(
  accessToken: string | null,
  fileId: string,
  start: number,
  end: number
): Promise<ArrayBuffer | null> {
  const headers: Record<string, string> = { Range: `bytes=${start}-${end}` };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const url = accessToken
    ? `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`
    : `https://drive.google.com/uc?export=download&id=${fileId}`;

  try {
    const res = await fetch(url, { headers, redirect: "follow" });
    if (!res.ok) return null;
    const ct = res.headers.get("Content-Type") || "";
    // Virus-scan interstitial / sign-in pages come back as HTML — not audio.
    if (ct.includes("text/html")) return null;
    return await res.arrayBuffer();
  } catch {
    return null;
  }
}

/** Fetch the first `bytes` of a Drive file. */
async function fetchHead(
  accessToken: string | null,
  fileId: string,
  bytes: number
): Promise<ArrayBuffer | null> {
  return fetchRange(accessToken, fileId, 0, bytes - 1);
}

interface ParsedFrame {
  offset: number;
  frameLength: number;
  bitrateKbps: number;
  sampleRate: number;
  versionBits: number;
  channelMode: number;
}

/** Parse a strict MPEG audio frame header at a known offset. */
function parseFrameHeader(
  bytes: Uint8Array,
  i: number
): ParsedFrame | null {
  if (i + 4 > bytes.length) return null;
  if (bytes[i] !== 0xff || (bytes[i + 1] & 0xe0) !== 0xe0) return null;

  const versionBits = (bytes[i + 1] >> 3) & 0x03; // 3=MPEG1, 2=MPEG2, 0=MPEG2.5
  const layerBits = (bytes[i + 1] >> 1) & 0x03; // 1 = Layer III
  const protectionBit = bytes[i + 1] & 0x01;
  const bitrateIdx = (bytes[i + 2] >> 4) & 0x0f;
  const srIdx = (bytes[i + 2] >> 2) & 0x03;
  const paddingBit = (bytes[i + 2] >> 1) & 0x01;
  const channelMode = (bytes[i + 3] >> 6) & 0x03;

  if (versionBits === 1) return null; // reserved
  if (layerBits === 0x00 || layerBits === 0x02) return null; // reserved / Layer II — we time Layer III
  if (bitrateIdx === 0x00 || bitrateIdx === 0x0f) return null; // free / invalid
  if (srIdx === 0x03) return null; // reserved

  const rates = SAMPLE_RATES[versionBits];
  if (!rates) return null;
  const sampleRate = rates[srIdx];
  if (!sampleRate) return null;

  const bitrateKbps =
    versionBits === 3 ? MPEG1_L3_BITRATES[bitrateIdx] : MPEG2_L3_BITRATES[bitrateIdx];
  if (!bitrateKbps) return null;

  // Frame length (Layer III): MPEG1 = 144*bitrate/samplerate, MPEG2/2.5 = 72*...
  const coef = versionBits === 3 ? 144 : 72;
  const frameLength =
    Math.floor((coef * bitrateKbps * 1000) / sampleRate) + paddingBit;

  if (frameLength < 24 || frameLength > 2048) return null;

  return { offset: i, frameLength, bitrateKbps, sampleRate, versionBits, channelMode };
}

/**
 * Validate that a candidate really is a frame: the NEXT frame header must
 * appear exactly `frameLength` bytes later with consistent parameters.
 * This is what kills false positives inside ID3 album art.
 */
function confirmFrame(bytes: Uint8Array, f: ParsedFrame): boolean {
  const next = f.offset + f.frameLength;
  if (next + 4 > bytes.length) return false;
  const n = parseFrameHeader(bytes, next);
  if (!n) return false;
  // Real consecutive frames keep bitrate/samplerate stable in CBR audio.
  return (
    n.bitrateKbps === f.bitrateKbps &&
    n.sampleRate === f.sampleRate &&
    n.versionBits === f.versionBits
  );
}

/** Size in bytes of a leading ID3v2 tag, or 0. */
function id3v2Size(bytes: Uint8Array): number {
  if (
    bytes.length < 10 ||
    bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33 // "ID3"
  ) {
    return 0;
  }
  // Syncsafe 28-bit integer.
  const size =
    ((bytes[6] & 0x7f) << 21) |
    ((bytes[7] & 0x7f) << 14) |
    ((bytes[8] & 0x7f) << 7) |
    (bytes[9] & 0x7f);
  return size + 10;
}

/**
 * Parse an MP3 head buffer: skip ID3, find the first CONFIRMED frame,
 * read Xing/Info/VBRI if present, else sample frames for a stable CBR bitrate.
 */
export function parseMp3HeadFromBuffer(buf: ArrayBuffer): AudioMeta {
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  const len = bytes.length;

  const tagBytes = id3v2Size(bytes);
  // If the declared tag is bigger than the buffer, it's truncated or the
  // size is bogus — scan the whole buffer instead of starting past the audio.
  const scanStart = tagBytes >= len ? 0 : tagBytes;
  for (let i = scanStart; i < len - 4; i++) {
    if (bytes[i] !== 0xff || (bytes[i + 1] & 0xe0) !== 0xe0) continue;
    const f = parseFrameHeader(bytes, i);
    if (!f) continue;

    if (!confirmFrame(bytes, f)) continue; // false positive (e.g. inside art)

    // Xing/Info (starts 4 or 32 bytes after the header depending on mono/stereo)
    const sideInfo = f.channelMode === 3 ? 17 : 32;
    const xingOff = i + 4 + sideInfo;
    if (xingOff + 16 <= len) {
      const tag = view.getUint32(xingOff);
      if (tag === XING_HEADER || tag === INFO_HEADER) {
        const flags = view.getUint32(xingOff + 4);
        if (flags & 0x01) {
          const frames = view.getUint32(xingOff + 8);
          const samplesPerFrame = f.versionBits === 3 ? 1152 : 576;
          const duration = (frames * samplesPerFrame) / f.sampleRate;
          return { duration, bitrate: f.bitrateKbps, sampleRate: f.sampleRate, detected: "xing", tagBytes };
        }
      }
    }

    // VBRI (34 bytes after header)
    const vbriOff = i + 4 + 32;
    if (vbriOff + 26 <= len) {
      if (view.getUint32(vbriOff) === VBRI_HEADER) {
        const frames = view.getUint32(vbriOff + 14);
        const samplesPerFrame = f.versionBits === 3 ? 1152 : 576;
        const duration = (frames * samplesPerFrame) / f.sampleRate;
        return { duration, bitrate: f.bitrateKbps, sampleRate: f.sampleRate, detected: "xing", tagBytes };
      }
    }

    // Plain CBR frame: sample a handful of real consecutive frames to get a
    // stable bitrate (a lone frame can be misread; the median of N real
    // correctly-sized frames is solid).
    const samples: number[] = [];
    let pos = i;
    let guard = 0;
    while (pos + 4 <= len && samples.length < 8 && guard < 64) {
      const pf = parseFrameHeader(bytes, pos);
      if (!pf) break;
      if (confirmFrame(bytes, pf)) samples.push(pf.frameLength);
      pos += pf.frameLength;
      guard++;
    }
    if (samples.length >= 3) {
      samples.sort((a, b) => a - b);
      const medianLen = samples[Math.floor(samples.length / 2)];
      const bytesPerSec = (medianLen * f.sampleRate) / (f.versionBits === 3 ? 1152 : 576);
      const bitrateKbps = Math.round((bytesPerSec * 8) / 1000);
      return { duration: null, bitrate: bitrateKbps, sampleRate: f.sampleRate, detected: "cbr", tagBytes };
    }

    // Confirmed single frame but not enough for sampling — still better than
    // nothing: fall through with the header's own bitrate.
    return { duration: null, bitrate: f.bitrateKbps, sampleRate: f.sampleRate, detected: "cbr", tagBytes };
  }

  return { duration: null, bitrate: null, sampleRate: null, detected: "none", tagBytes };
}

function parseMp3Head(buf: ArrayBuffer): AudioMeta {
  return parseMp3HeadFromBuffer(buf);
}

/** M4A/AAC: find `mvhd` box for timescale + duration. */
function parseM4aHead(buf: ArrayBuffer): AudioMeta {
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  // mvhd usually sits within the first few hundred bytes (ftyp + moov start).
  const limit = Math.min(bytes.length - 8, 65536);
  for (let i = 0; i < limit; i++) {
    if (
      bytes[i] === 0x6d && bytes[i + 1] === 0x76 &&
      bytes[i + 2] === 0x68 && bytes[i + 3] === 0x64
    ) {
      try {
        const version = view.getUint8(i + 4);
        if (version === 0) {
          const timescale = view.getUint32(i + 20);
          const dur = view.getUint32(i + 24);
          if (timescale > 0) return { duration: dur / timescale, bitrate: null, sampleRate: null, detected: "mvhd" };
        } else if (version === 1) {
          const timescale = view.getUint32(i + 28);
          const dv = new DataView(buf, i + 32, 8);
          const dur = Number(dv.getBigUint64(0));
          if (timescale > 0) return { duration: dur / timescale, bitrate: null, sampleRate: null, detected: "mvhd" };
        }
      } catch {
        // truncated head — give up
      }
      break;
    }
  }
  return { duration: null, bitrate: null, sampleRate: null, detected: "none" };
}

export interface DurationProbeTarget {
  driveId: string;
  fileName: string;
  mimeType?: string;
  size?: string | number | null;
}

/**
 * Probe one Drive file for its duration.
 * Returns null when the file isn't audio or its timing can't be determined.
 */
export async function probeAudioDuration(
  accessToken: string | null,
  file: DurationProbeTarget
): Promise<AudioMeta | null> {
  if (!isAudioFile({ name: file.fileName, mimeType: file.mimeType })) return null;

  const name = file.fileName.toLowerCase();
  if (name.endsWith(".m4a") || name.endsWith(".aac")) {
    const head = await fetchHead(accessToken, file.driveId, 64 * 1024);
    if (!head) return null;
    const meta = parseM4aHead(head);
    if (meta.duration) return meta;
    return null;
  }
  if (name.endsWith(".mp3")) {
    // 64KB head covers any reasonable ID3 tag plus dozens of audio frames.
    let buf = await fetchHead(accessToken, file.driveId, 64 * 1024);
    if (!buf) return null;
    let meta = parseMp3Head(buf);
    let frameOffset: number | null = null;
    {
      const bytes = new Uint8Array(buf);
      const tagBytes = id3v2Size(bytes);
      // Re-find the first confirmed frame offset to know where audio starts.
      for (let i = tagBytes; i < bytes.length - 4; i++) {
        if (bytes[i] !== 0xff || (bytes[i + 1] & 0xe0) !== 0xe0) continue;
        const f = parseFrameHeader(bytes, i);
        if (f && confirmFrame(bytes, f)) {
          frameOffset = f.offset;
          break;
        }
      }
    }

    // No confirmed audio frame in the head (huge ID3 art, JPEGs > 64KB):
    // the first fetch starts at the tag size, so audio follows immediately.
    if (meta.detected === "none" || frameOffset === null) {
      if (meta.tagBytes && meta.tagBytes > 0) {
        const second = await fetchRange(
          accessToken,
          file.driveId,
          meta.tagBytes,
          meta.tagBytes + 48 * 1024 - 1
        );
        if (second) {
          const secondMeta = parseMp3Head(second);
          if (secondMeta.detected === "xing" && secondMeta.duration) return secondMeta;
          if (secondMeta.detected === "cbr" && secondMeta.bitrate) meta = secondMeta;
        }
      }
    }

    if (meta.detected === "xing") return meta;

    if (meta.detected === "cbr" && meta.bitrate) {
      const sizeNum = Number(file.size ?? 0);
      if (sizeNum > 0) {
        // duration = bits / bitrate
        const duration = (sizeNum * 8) / (meta.bitrate * 1000);
        return { ...meta, duration };
      }
    }
    return meta.duration ? meta : null;
  }

  // Other formats (ogg/flac/wav/opus): no parser in this prototype.
  // They still PLAY (the stream proxy passes any bytes through), they just
  // contribute unreliable timeline math — handled as duration-pending by the
  // scanner, not as unplayable.
  return null;
}
