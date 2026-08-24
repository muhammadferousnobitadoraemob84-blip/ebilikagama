// Google Drive integration using direct HTTP calls
// No external npm package required

// Google Drive configuration from environment variables
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || "";

// Scopes needed for Google Drive
const SCOPES = "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.metadata.readonly";

// User's Google Drive folder for Live Replays
// https://drive.google.com/drive/folders/1YRUK9XzaE53553_nOltMw66HWK8j5-Z_
export const REPLAY_FOLDER_ID = "1YRUK9XzaE53553_nOltMw66HWK8j5-Z_";

/**
 * Get authorization URL for Google Drive connection
 */
export function getAuthUrl(state?: string): string {
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: GOOGLE_REDIRECT_URI,
    response_type: "code",
    scope: SCOPES,
    access_type: "offline",
    prompt: "consent",
    state: state || "",
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangeCodeForTokens(code: string) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: GOOGLE_REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });

  if (!response.ok) {
    throw new Error("Failed to exchange code for tokens");
  }

  return response.json();
}

/**
 * Refresh access token
 */
export async function refreshAccessToken(refreshToken: string) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!response.ok) {
    throw new Error("Failed to refresh access token");
  }

  return response.json();
}

/**
 * Verify Google Drive connection and get user email
 */
export async function verifyGoogleDriveConnection(
  accessToken: string
): Promise<{ connected: boolean; email?: string }> {
  try {
    const response = await fetch(
      "https://www.googleapis.com/drive/v3/about?fields=user(displayName,emailAddress)",
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (!response.ok) {
      return { connected: false };
    }

    const data = await response.json();
    return {
      connected: true,
      email: data.user?.emailAddress,
    };
  } catch (error) {
    console.error("[GOOGLE-DRIVE] Connection verification failed:", error);
    return { connected: false };
  }
}

/**
 * Get the Live Replay folder ID
 * Uses the user's pre-configured folder
 */
export async function getReplayFolderId(): Promise<string> {
  // Use the user's configured folder ID
  return REPLAY_FOLDER_ID;
}

/**
 * Upload file to Google Drive using resumable upload
 */
export async function uploadToGoogleDrive(
  accessToken: string,
  fileName: string,
  mimeType: string,
  fileSize: number,
  fileBuffer: Buffer,
  folderId: string
): Promise<{ fileId: string; webViewLink: string }> {
  // Step 1: Initialize resumable upload
  const initResponse = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: fileName,
        parents: [folderId],
      }),
    }
  );

  if (!initResponse.ok) {
    throw new Error("Failed to initialize upload");
  }

  const uploadUrl = initResponse.headers.get("Location");
  if (!uploadUrl) {
    throw new Error("No upload URL returned");
  }

  // Step 2: Upload the file in chunks
  const CHUNK_SIZE = 10 * 1024 * 1024; // 10MB chunks
  let offset = 0;

  while (offset < fileSize) {
    const end = Math.min(offset + CHUNK_SIZE, fileSize);
    const chunk = fileBuffer.slice(offset, end);

    const chunkResponse = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Range": `bytes ${offset}-${end - 1}/${fileSize}`,
      },
      body: chunk,
    });

    // 308 Resume Incomplete is expected for chunks
    if (chunkResponse.status !== 308 && chunkResponse.status !== 200) {
      throw new Error(`Upload failed at offset ${offset}`);
    }

    offset = end;
  }

  // Step 3: Get the file ID from the final response
  const finalResponse = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Range": `bytes ${fileSize - 1}-${fileSize - 1}/${fileSize}`,
    },
  });

  // Get file ID from response
  const fileData = await finalResponse.json();
  const fileId = fileData.id;

  if (!fileId) {
    throw new Error("No file ID returned");
  }

  // Step 4: Set file permissions to public
  await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}/permissions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        role: "reader",
        type: "anyone",
      }),
    }
  );

  return {
    fileId,
    webViewLink: `https://drive.google.com/file/d/${fileId}/preview`,
  };
}

/**
 * Delete file from Google Drive
 */
export async function deleteFromGoogleDrive(
  accessToken: string,
  fileId: string
): Promise<boolean> {
  try {
    const response = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    return response.ok;
  } catch (error) {
    console.error("[GOOGLE-DRIVE] Delete error:", error);
    return false;
  }
}

/**
 * Get file info from Google Drive
 */
export async function getGoogleDriveFileInfo(
  accessToken: string,
  fileId: string
) {
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,mimeType,size,createdTime,webViewLink,webContentLink`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  if (!response.ok) {
    throw new Error("Failed to get file info");
  }

  return response.json();
}
