/**
 * Shared upload helper.
 * Uses the legacy base64 upload via /api/upload API route.
 * Vercel serverless body size limit is ~4.5MB, so effective max is ~4MB after multipart overhead.
 * For larger files, persistent storage (Vercel Blob / Cloudinary / S3) would need to be configured.
 */

interface UploadResult {
  url: string;
  saved: boolean;
  method: "legacy";
}

/**
 * Upload a file using the legacy /api/upload endpoint.
 */
export async function uploadImage(
  file: File,
  purpose: string,
  targetId?: string
): Promise<UploadResult> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("purpose", purpose);
  if (targetId) formData.append("targetId", targetId);

  const res = await fetch("/api/upload", { method: "POST", body: formData });

  // Safely parse JSON — server may return non-JSON on error (e.g. Vercel 413)
  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    if (res.status === 413) {
      throw new Error("Fail terlalu besar. Saiz maksimum ialah 4MB. Sila kecilkan imej dan cuba lagi.");
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error("Anda tidak dibenarkan memuat naik gambar. Sila log masuk semula.");
    }
    throw new Error("Pelayan mengembalikan ralat (HTTP " + res.status + ").");
  }

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || "Gagal memuat naik gambar");
  }
  if (!data.saved) {
    throw new Error("Gagal menyimpan gambar ke database.");
  }

  return { url: data.url, saved: data.saved, method: "legacy" };
}

/**
 * Validate file before upload.
 * Returns null if valid, or an error message string.
 */
export function validateImageFile(file: File, maxSizeMB: number = 4): string | null {
  const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
  if (!allowedTypes.includes(file.type)) {
    return "Jenis fail tidak dibenarkan. Gunakan JPG, PNG, atau WebP.";
  }
  const maxSize = maxSizeMB * 1024 * 1024;
  if (file.size > maxSize) {
    return `Fail terlalu besar. Saiz maksimum ialah ${maxSizeMB}MB. Sila kecilkan imej dan cuba lagi.`;
  }
  return null;
}
