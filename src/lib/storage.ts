import crypto from "crypto";

// Storage configuration
// For production, configure these environment variables:
// - STORAGE_TYPE: "local" | "s3" | "r2" | "gcs"
// - STORAGE_BUCKET: bucket name
// - STORAGE_REGION: region (for S3-compatible)
// - STORAGE_ACCESS_KEY: access key
// - STORAGE_SECRET_KEY: secret key
// - STORAGE_ENDPOINT: custom endpoint (for R2, etc.)

export interface UploadAuth {
  uploadUrl: string;
  fileKey: string;
  expiresAt: number;
}

export interface StorageConfig {
  type: string;
  bucket: string;
  region: string;
  accessKey: string;
  secretKey: string;
  endpoint: string;
  publicBaseUrl: string;
}

function getConfig(): StorageConfig {
  return {
    type: process.env.STORAGE_TYPE || "local",
    bucket: process.env.STORAGE_BUCKET || "ebilikagama-replays",
    region: process.env.STORAGE_REGION || "auto",
    accessKey: process.env.STORAGE_ACCESS_KEY || "",
    secretKey: process.env.STORAGE_SECRET_KEY || "",
    endpoint: process.env.STORAGE_ENDPOINT || "",
    publicBaseUrl: process.env.STORAGE_PUBLIC_URL || "",
  };
}

// Generate a unique file key
export function generateFileKey(filename: string): string {
  const timestamp = Date.now();
  const random = crypto.randomBytes(8).toString("hex");
  const ext = filename.split(".").pop() || "mp4";
  return `replays/${timestamp}-${random}.${ext}`;
}

// Get presigned upload URL
export async function getUploadUrl(
  fileKey: string,
  contentType: string,
  expiresIn: number = 3600
): Promise<UploadAuth> {
  const config = getConfig();

  // For local development or when no storage is configured,
  // use our own API endpoint
  if (config.type === "local" || !config.accessKey) {
    const uploadUrl = `/api/upload/video?key=${encodeURIComponent(fileKey)}&type=${encodeURIComponent(contentType)}`;
    return {
      uploadUrl,
      fileKey,
      expiresAt: Date.now() + expiresIn * 1000,
    };
  }

  // For S3-compatible storage (AWS S3, Cloudflare R2, etc.)
  // This would use AWS SDK or similar
  // For now, return a placeholder that would need to be implemented
  // based on your chosen storage provider

  throw new Error("Cloud storage not configured. Set STORAGE_TYPE and related environment variables.");
}

// Get public URL for a file
export function getPublicUrl(fileKey: string): string {
  const config = getConfig();

  if (config.type === "local" || !config.publicBaseUrl) {
    return `/api/upload/video?key=${encodeURIComponent(fileKey)}`;
  }

  return `${config.publicBaseUrl}/${fileKey}`;
}

// Delete a file from storage
export async function deleteFile(fileKey: string): Promise<boolean> {
  const config = getConfig();

  if (config.type === "local" || !config.accessKey) {
    // For local storage, files are managed by our API
    // Deletion would need to be implemented in the upload API
    return true;
  }

  // For cloud storage, implement deletion here
  // This would use AWS SDK or similar

  return true;
}

// Validate file type
export function isAllowedVideoType(filename: string, mimeType?: string): boolean {
  const allowedExtensions = [".mp4", ".mov", ".webm", ".mkv", ".avi"];
  const allowedMimeTypes = [
    "video/mp4",
    "video/quicktime",
    "video/webm",
    "video/x-matroska",
    "video/avi",
  ];

  const ext = "." + filename.split(".").pop()?.toLowerCase();
  if (!allowedExtensions.includes(ext)) {
    return false;
  }

  if (mimeType && !allowedMimeTypes.includes(mimeType)) {
    return false;
  }

  return true;
}

// Max file size: 20GB
export const MAX_FILE_SIZE = 20 * 1024 * 1024 * 1024;
