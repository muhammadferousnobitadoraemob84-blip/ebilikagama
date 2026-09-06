/**
 * Smart filename parser for Quran audio files.
 * Detects Surah number, Surah name, and Ayah number from common filename patterns.
 */

export interface ParsedQuranFile {
  fileName: string;
  surahNumber: number | null;
  surahName: string | null;
  ayahNumber: number | null;
  audioType: "ayah" | "full_surah";
  confidence: "high" | "medium" | "low";
  status: "detected" | "needs_review";
}

// Official 114 Surahs — the source of truth
const SURAHS: { number: number; name: string; aliases: string[] }[] = [
  { number: 1, name: "Al-Fatihah", aliases: ["fatihah", "al-fatihah", "alfatihah", "the opener"] },
  { number: 2, name: "Al-Baqarah", aliases: ["baqarah", "al-baqarah", "albaqarah", "the cow"] },
  { number: 3, name: "Ali 'Imran", aliases: ["ali imran", "ali'iman", "ali-imran", "family of imran", "aliimran"] },
  { number: 4, name: "An-Nisa", aliases: ["nisa", "an-nisa", "an-nisaa", "the women", "anisaa"] },
  { number: 5, name: "Al-Ma'idah", aliases: ["maidah", "al-maidah", "al-ma'idah", "the table spread", "almaidah"] },
  { number: 6, name: "Al-An'am", aliases: ["anam", "al-anam", "al-an'am", "the cattle", "alanam"] },
  { number: 7, name: "Al-A'raf", aliases: ["araf", "al-araf", "al-a'raf", "the heights", "alaaraf"] },
  { number: 8, name: "Al-Anfal", aliases: ["anfal", "al-anfal", "the spoils of war", "alanfal"] },
  { number: 9, name: "At-Tawbah", aliases: ["tawbah", "at-tawbah", "the repentance", "at-tawba"] },
  { number: 10, name: "Yunus", aliases: ["yunus", "jonah"] },
  { number: 11, name: "Hud", aliases: ["hud"] },
  { number: 12, name: "Yusuf", aliases: ["yusuf", "joseph"] },
  { number: 13, name: "Ar-Ra'd", aliases: ["rad", "ar-rad", "ar-ra'd", "the thunder"] },
  { number: 14, name: "Ibrahim", aliases: ["ibrahim", "abraham"] },
  { number: 15, name: "Al-Hijr", aliases: ["hijr", "al-hijr", "the rocky tract"] },
  { number: 16, name: "An-Nahl", aliases: ["nahl", "an-nahl", "the bee"] },
  { number: 17, name: "Al-Isra", aliases: ["isra", "al-isra", "the night journey"] },
  { number: 18, name: "Al-Kahf", aliases: ["kahf", "al-kahf", "the cave"] },
  { number: 19, name: "Maryam", aliases: ["maryam", "mary"] },
  { number: 20, name: "Taha", aliases: ["taha", "ta-ha", "ta ha"] },
  { number: 21, name: "Al-Anbiya", aliases: ["anbiya", "al-anbiya", "the prophets"] },
  { number: 22, name: "Al-Hajj", aliases: ["hajj", "al-hajj", "the pilgrimage"] },
  { number: 23, name: "Al-Mu'minun", aliases: ["muminun", "al-muminun", "al-mu'minun", "the believers"] },
  { number: 24, name: "An-Nur", aliases: ["nur", "an-nur", "the light"] },
  { number: 25, name: "Al-Furqan", aliases: ["furqan", "al-furqan", "the criterion"] },
  { number: 26, name: "Ash-Shu'ara", aliases: ["shuara", "ash-shuara", "ash-shu'ara", "the poets"] },
  { number: 27, name: "An-Naml", aliases: ["naml", "an-naml", "the ant"] },
  { number: 28, name: "Al-Qasas", aliases: ["qasas", "al-qasas", "the stories"] },
  { number: 29, name: "Al-Ankabut", aliases: ["ankabut", "al-ankabut", "the spider"] },
  { number: 30, name: "Ar-Rum", aliases: ["rum", "ar-rum", "the romans"] },
  { number: 31, name: "Luqman", aliases: ["luqman", "luqmaan"] },
  { number: 32, name: "As-Sajdah", aliases: ["sajdah", "as-sajdah", "as-sajda", "the prostration"] },
  { number: 33, name: "Al-Ahzab", aliases: ["ahzab", "al-ahzab", "the combined forces"] },
  { number: 34, name: "Saba", aliases: ["saba", "sheba"] },
  { number: 35, name: "Fatir", aliases: ["fatir", "fatir", "originator"] },
  { number: 36, name: "Ya-Sin", aliases: ["yasin", "ya-sin", "ya sin"] },
  { number: 37, name: "As-Saffat", aliases: ["saffat", "as-saffat", "those who set the ranks"] },
  { number: 38, name: "Sad", aliases: ["sad", "saad"] },
  { number: 39, name: "Az-Zumar", aliases: ["zumar", "az-zumar", "the troops"] },
  { number: 40, name: "Ghafir", aliases: ["ghafir", "the forgiver"] },
  { number: 41, name: "Fussilat", aliases: ["fussilat", "fussilat", "explained in detail"] },
  { number: 42, name: "Ash-Shura", aliases: ["shura", "ash-shura", "the consultation"] },
  { number: 43, name: "Az-Zukhruf", aliases: ["zukhruf", "az-zukhruf", "the ornaments of gold"] },
  { number: 44, name: "Ad-Dukhan", aliases: ["dukhan", "ad-dukhan", "the smoke"] },
  { number: 45, name: "Al-Jathiyah", aliases: ["jathiyah", "al-jathiyah", "the crouching"] },
  { number: 46, name: "Al-Ahqaf", aliases: ["ahqaf", "al-ahqaf", "the wind-curved sandhills"] },
  { number: 47, name: "Muhammad", aliases: ["muhammad", "muhammed"] },
  { number: 48, name: "Al-Fath", aliases: ["fath", "al-fath", "the victory"] },
  { number: 49, name: "Al-Hujurat", aliases: ["hujurat", "al-hujurat", "the rooms"] },
  { number: 50, name: "Qaf", aliases: ["qaf"] },
  { number: 51, name: "Adh-Dhariyat", aliases: ["dhariyat", "adh-dhariyat", "the winnowing winds"] },
  { number: 52, name: "At-Tur", aliases: ["tur", "at-tur", "the mount"] },
  { number: 53, name: "An-Najm", aliases: ["najm", "an-najm", "the star"] },
  { number: 54, name: "Al-Qamar", aliases: ["qamar", "al-qamar", "the moon"] },
  { number: 55, name: "Ar-Rahman", aliases: ["rahman", "ar-rahman", "the beneficent"] },
  { number: 56, name: "Al-Waqi'ah", aliases: ["waqiah", "al-waqiah", "al-waqi'ah", "the inevitable"] },
  { number: 57, name: "Al-Hadid", aliases: ["hadid", "al-hadid", "the iron"] },
  { number: 58, name: "Al-Mujadilah", aliases: ["mujadilah", "al-mujadilah", "the pleading woman"] },
  { number: 59, name: "Al-Hashr", aliases: ["hashr", "al-hashr", "the exile"] },
  { number: 60, name: "Al-Mumtahanah", aliases: ["mumtahanah", "al-mumtahanah", "she that is to be examined"] },
  { number: 61, name: "As-Saf", aliases: ["saf", "as-saf", "the rank"] },
  { number: 62, name: "Al-Jumu'ah", aliases: ["jumua", "al-jumua", "al-jumu'ah", "friday"] },
  { number: 63, name: "Al-Munafiqun", aliases: ["munafiqun", "al-munafiqun", "the hypocrites"] },
  { number: 64, name: "At-Taghabun", aliases: ["taghabun", "at-taghabun", "mutual disillusion"] },
  { number: 65, name: "At-Talaq", aliases: ["talaq", "at-talaq", "divorce"] },
  { number: 66, name: "At-Tahrim", aliases: ["tahrim", "at-tahrim", "the prohibition"] },
  { number: 67, name: "Al-Mulk", aliases: ["mulk", "al-mulk", "the sovereignty"] },
  { number: 68, name: "Al-Qalam", aliases: ["qalam", "al-qalam", "the pen"] },
  { number: 69, name: "Al-Haqqah", aliases: ["haqqah", "al-haqqah", "the reality"] },
  { number: 70, name: "Al-Ma'arij", aliases: ["maarij", "al-maarij", "al-ma'arij", "the ascension"] },
  { number: 71, name: "Nuh", aliases: ["nuh", "noah"] },
  { number: 72, name: "Al-Jinn", aliases: ["jinn", "al-jinn", "the jinn"] },
  { number: 73, name: "Al-Muzzammil", aliases: ["muzzammil", "al-muzzammil", "the enshrouded one"] },
  { number: 74, name: "Al-Muddaththir", aliases: ["muddaththir", "al-muddaththir", "the cloaked one"] },
  { number: 75, name: "Al-Qiyamah", aliases: ["qiyamah", "al-qiyamah", "the resurrection"] },
  { number: 76, name: "Al-Insan", aliases: ["insan", "al-insan", "the man"] },
  { number: 77, name: "Al-Mursalat", aliases: ["mursalat", "al-mursalat", "the emissaries"] },
  { number: 78, name: "An-Naba", aliases: ["naba", "an-naba", "the tiding"] },
  { number: 79, name: "An-Nazi'at", aliases: ["naziat", "an-naziat", "an-nazi'at", "those who drag forth"] },
  { number: 80, name: "Abasa", aliases: ["abasa", "he frowned"] },
  { number: 81, name: "At-Takwir", aliases: ["takwir", "at-takwir", "the overthrowing"] },
  { number: 82, name: "Al-Infitar", aliases: ["infitar", "al-infitar", "the cleaving"] },
  { number: 83, name: "Al-Mutaffifin", aliases: ["mutaffifin", "al-mutaffifin", "the defrauding"] },
  { number: 84, name: "Al-Inshiqaq", aliases: ["inshiqaq", "al-inshiqaq", "the splitting open"] },
  { number: 85, name: "Al-Buruj", aliases: ["buruj", "al-buruj", "the mansions of the stars"] },
  { number: 86, name: "At-Tariq", aliases: ["tariq", "at-tariq", "the nightcomer"] },
  { number: 87, name: "Al-A'la", aliases: ["ala", "al-ala", "al-a'la", "the most high"] },
  { number: 88, name: "Al-Ghashiyah", aliases: ["ghashiyah", "al-ghashiyah", "the overwhelming"] },
  { number: 89, name: "Al-Fajr", aliases: ["fajr", "al-fajr", "the dawn"] },
  { number: 90, name: "Al-Balad", aliases: ["balad", "al-balad", "the city"] },
  { number: 91, name: "Ash-Shams", aliases: ["shams", "ash-shams", "the sun"] },
  { number: 92, name: "Al-Layl", aliases: ["layl", "al-layl", "the night"] },
  { number: 93, name: "Ad-Duhaa", aliases: ["duhaa", "ad-duhaa", "the morning hours"] },
  { number: 94, name: "Ash-Sharh", aliases: ["sharh", "ash-sharh", "the relief"] },
  { number: 95, name: "At-Tin", aliases: ["tin", "at-tin", "the fig"] },
  { number: 96, name: "Al-Alaq", aliases: ["alaq", "al-alaq", "the clot"] },
  { number: 97, name: "Al-Qadr", aliases: ["qadr", "al-qadr", "the power"] },
  { number: 98, name: "Al-Bayyinah", aliases: ["bayyinah", "al-bayyinah", "the clear proof"] },
  { number: 99, name: "Az-Zalzalah", aliases: ["zalzalah", "az-zalzalah", "the earthquake"] },
  { number: 100, name: "Al-Adiyat", aliases: ["adiyat", "al-adiyat", "the courser"] },
  { number: 101, name: "Al-Qari'ah", aliases: ["qariah", "al-qariah", "al-qari'ah", "the calamity"] },
  { number: 102, name: "At-Takathur", aliases: ["takathur", "at-takathur", "the rivalry in world increase"] },
  { number: 103, name: "Al-Asr", aliases: ["asr", "al-asr", "the decline of time"] },
  { number: 104, name: "Al-Humazah", aliases: ["humazah", "al-humazah", "the traducer"] },
  { number: 105, name: "Al-Fil", aliases: ["fil", "al-fil", "the elephant"] },
  { number: 106, name: "Quraysh", aliases: ["quraysh", "quraish", "qurays"] },
  { number: 107, name: "Al-Ma'un", aliases: ["maun", "al-maun", "the small kindnesses"] },
  { number: 108, name: "Al-Kawthar", aliases: ["kawthar", "al-kawthar", "abundance"] },
  { number: 109, name: "Al-Kafirun", aliases: ["kafirun", "al-kafirun", "the disbelievers"] },
  { number: 110, name: "An-Nasr", aliases: ["nasr", "an-nasr", "the divine support"] },
  { number: 111, name: "Al-Masad", aliases: ["masad", "al-masad", "the palm fiber"] },
  { number: 112, name: "Al-Ikhlas", aliases: ["ikhlas", "al-ikhlas", "the sincerity"] },
  { number: 113, name: "Al-Falaq", aliases: ["falaq", "al-falaq", "the daybreak"] },
  { number: 114, name: "An-Nas", aliases: ["nas", "an-nas", "mankind"] },
];

/**
 * Normalize a string for comparison: lowercase, remove accents, trim
 */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[''`]/g, "'")
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extract a number from the beginning of a string
 */
function extractLeadingNumber(s: string): number | null {
  const match = s.match(/^(\d{1,3})/);
  if (match) {
    const n = parseInt(match[1], 10);
    return n >= 1 && n <= 114 ? n : null;
  }
  return null;
}

/**
 * Try to match a surah name from a string
 */
function matchSurahName(s: string): { number: number; name: string } | null {
  const normalized = normalize(s);

  for (const surah of SURAHS) {
    // Check exact name match
    if (normalize(surah.name) === normalized) {
      return { number: surah.number, name: surah.name };
    }
    // Check aliases
    for (const alias of surah.aliases) {
      if (normalize(alias) === normalized) {
        return { number: surah.number, name: surah.name };
      }
    }
  }

  // Partial match — check if any surah name is contained in the string
  for (const surah of SURAHS) {
    const normalizedName = normalize(surah.name);
    if (normalized.includes(normalizedName)) {
      return { number: surah.number, name: surah.name };
    }
    for (const alias of surah.aliases) {
      if (normalized.includes(normalize(alias))) {
        return { number: surah.number, name: surah.name };
      }
    }
  }

  return null;
}

/**
 * Parse a Quran audio filename and detect surah/ayah info.
 *
 * Supports patterns like:
 * - 001-Al-Fatihah.mp3
 * - Al-Fatihah.mp3
 * - 001_001.mp3 (surah_ayah)
 * - 02 Al Baqarah.mp3
 * - 002-255.mp3 (surah-ayah)
 */
export function parseQuranFilename(fileName: string): ParsedQuranFile {
  const baseName = fileName.replace(/\.[^.]+$/, ""); // Remove extension
  const parts = baseName.split(/[\s_\-]+/).filter(Boolean);

  let surahNumber: number | null = null;
  let surahName: string | null = null;
  let ayahNumber: number | null = null;
  let audioType: "ayah" | "full_surah" = "full_surah";

  // Strategy 1: Try "NNN-Name" or "NNN_Name" or "NNN Name" pattern
  // e.g., "001-Al-Fatihah", "02_Al-Baqarah", "3 Ali Imran"
  if (parts.length >= 2) {
    const leadingNum = extractLeadingNumber(parts[0]);
    if (leadingNum !== null) {
      // Check if second part is a surah name
      const nameMatch = matchSurahName(parts.slice(1).join(" "));
      if (nameMatch) {
        surahNumber = nameMatch.number;
        surahName = nameMatch.name;
      } else {
        // Maybe the number is the surah number
        surahNumber = leadingNum;
        surahName = SURAHS.find((s) => s.number === leadingNum)?.name || null;
      }
    } else {
      // No leading number — try matching the whole name
      const nameMatch = matchSurahName(baseName);
      if (nameMatch) {
        surahNumber = nameMatch.number;
        surahName = nameMatch.name;
      }
    }
  } else {
    // Single part — try as surah name
    const nameMatch = matchSurahName(baseName);
    if (nameMatch) {
      surahNumber = nameMatch.number;
      surahName = nameMatch.name;
    }
  }

  // Strategy 2: Try to detect ayah number from patterns like "001_001", "002-255"
  // Pattern: leading number is surah, second number is ayah
  if (parts.length >= 2 && surahNumber !== null) {
    const secondNum = parts.find((p, i) => i > 0 && /^\d+$/.test(p));
    if (secondNum) {
      const ayah = parseInt(secondNum, 10);
      if (ayah >= 1 && ayah <= 300) {
        ayahNumber = ayah;
        audioType = "ayah";
      }
    }
  }

  // Strategy 3: If we only have a number (like "001") and no name, it's probably full surah
  if (surahNumber !== null && ayahNumber === null) {
    // Check if ALL parts are numbers
    const allNumeric = parts.every((p) => /^\d+$/.test(p));
    if (allNumeric && parts.length === 1) {
      audioType = "full_surah";
    }
  }

  // Strategy 4: Detect ayah from combined number pattern like "001001" or "2255"
  if (surahNumber !== null && ayahNumber === null && parts.length === 1) {
    const combined = parts[0];
    if (combined.length === 6 && /^\d{6}$/.test(combined)) {
      const sn = parseInt(combined.slice(0, 3), 10);
      const ay = parseInt(combined.slice(3), 10);
      if (sn >= 1 && sn <= 114 && ay >= 1) {
        surahNumber = sn;
        surahName = SURAHS.find((s) => s.number === sn)?.name || null;
        ayahNumber = ay;
        audioType = "ayah";
      }
    }
  }

  // Determine confidence
  let confidence: "high" | "medium" | "low" = "low";
  let status: "detected" | "needs_review" = "needs_review";

  if (surahNumber !== null && surahName !== null && ayahNumber !== null) {
    confidence = "high";
    status = "detected";
  } else if (surahNumber !== null && surahName !== null) {
    confidence = "medium";
    status = "detected";
  } else if (surahNumber !== null) {
    confidence = "low";
    status = "needs_review";
  }

  return {
    fileName,
    surahNumber,
    surahName,
    ayahNumber,
    audioType,
    confidence,
    status,
  };
}

/**
 * Parse multiple filenames at once
 */
export function parseQuranFilenames(fileNames: string[]): ParsedQuranFile[] {
  return fileNames.map(parseQuranFilename);
}

/**
 * Get the official Surah list (for UI dropdowns)
 */
export function getSurahList() {
  return SURAHS.map((s) => ({ number: s.number, name: s.name }));
}

/**
 * Look up a Surah by number
 */
export function getSurahByNumber(number: number) {
  return SURAHS.find((s) => s.number === number) || null;
}
