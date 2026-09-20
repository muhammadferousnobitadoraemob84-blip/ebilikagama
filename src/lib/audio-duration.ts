// Read MP3 duration WITHOUT storing or touching audio bytes anywhere.
//
// Strategy per file:
//   1. Xing/Info/VBRI header parse (VBR files carry exact duration there).
//      Needs only the first ~16KB of the file.
//   2. CBR estimate: duration ≈ fileSize / bitrate. Accurate for
//      constant-bitrate MP3s (the common case for prepared radio folders).
//   3. M4A/AAC fallback: parse the `mvhd` box for duration.
//
// Sources, in order: authenticated Drive API (alt=media) → anonymous
// link-shared download. Mirrors the proven quran-audio/stream fallbacks.
// Only small ranged GETs are issued — never full-file downloads — so
// scanning a long playlist costs a few KB per track.

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

/** Fetch the first `bytes` of a Drive file via the authenticated API. */
async function fetchHead(
  accessToken: string | null,
  fileId: string,
  bytes: number
): Promise<ArrayBuffer | null> {
  const headers: Record<string, string> = { Range: `bytes=0-${bytes - 1}` };
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

/** Parse MP3 frame header + Xing/VBRI from a head buffer. */
function parseMp3Head(buf: ArrayBuffer): AudioMeta {
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  const len = Math.min(bytes.length, 65536);

  // Find the first frame sync (0xFF 0xEx/0xFx).
  for (let i = 0; i < len - 4; i++) {
    if (bytes[i] !== 0xff || (bytes[i + 1] & 0xe0) !== 0xe0) continue;

    const versionBits = (bytes[i + 1] >> 3) & 0x03; // 3=MPEG1, 2=MPEG2, 0=MPEG2.5
    const layerBits = (bytes[i + 1] >> 1) & 0x03; // 1 = Layer III
    const bitrateIdx = (bytes[i + 2] >> 4) & 0x0f;
    const srIdx = (bytes[i + 2] >> 2) & 0x03;
    const channelMode = (bytes[i + 3] >> 6) & 0x03;

    if (layerBits !== 0x01) break; // only Layer III supported for timing
    const rates = SAMPLE_RATES[versionBits];
    if (!rates || srIdx === 3) break;
    const sampleRate = rates[srIdx];
    if (!sampleRate) break;

    const bitrateKbps =
      versionBits === 3
        ? MPEG1_L3_BITRATES[bitrateIdx]
        : MPEG2_L3_BITRATES[bitrateIdx];
    if (!bitrateKbps) break;

    // Xing/Info (starts 4 or 32 bytes after the header depending on stereo/mono)
    const sideInfo = channelMode === 3 ? 17 : 32;
    const xingOff = i + 4 + sideInfo;
    if (xingOff + 16 <= bytes.length) {
      const tag = view.getUint32(xingOff);
      if (tag === XING_HEADER || tag === INFO_HEADER) {
        const flags = view.getUint32(xingOff + 4);
        if (flags & 0x01) {
          const frames = view.getUint32(xingOff + 8);
          const samplesPerFrame = versionBits === 3 ? 1152 : 576;
          const duration = (frames * samplesPerFrame) / sampleRate;
          return { duration, bitrate: bitrateKbps, sampleRate, detected: "xing" };
        }
      }
    }

    // VBRI (34 bytes after header)
    const vbriOff = i + 4 + 32;
    if (vbriOff + 26 <= bytes.length) {
      if (view.getUint32(vbriOff) === VBRI_HEADER) {
        const frames = view.getUint32(vbriOff + 14);
        const samplesPerFrame = versionBits === 3 ? 1152 : 576;
        const duration = (frames * samplesPerFrame) / sampleRate;
        return { duration, bitrate: bitrateKbps, sampleRate, detected: "xing" };
      }
    }

    // Plain CBR frame: duration ≈ size / bitrate.
    return { duration: null, bitrate: bitrateKbps, sampleRate, detected: "cbr" };
  }

  return { duration: null, bitrate: null, sampleRate: null, detected: "none" };
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
    const head = await fetchHead(accessToken, file.driveId, 16 * 1024);
    if (!head) return null;
    const meta = parseMp3Head(head);

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
  // contribute unreliable timeline math — excluded by the scanner.
  return null;
}
