// Shared Google Drive helpers for the virtual radio + azan scanners.
// Server-only: reads use the authenticated Drive API with small ranged
// requests — never full downloads, never bytes stored.

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
}

/** List all (non-trashed) files directly inside a Drive folder. */
export async function listFolderFiles(accessToken: string, folderId: string): Promise<DriveFile[]> {
  const files: DriveFile[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({
      q: `'${folderId}' in parents and trashed=false`,
      fields: "nextPageToken,files(id,name,mimeType,size)",
      orderBy: "name",
      pageSize: "1000",
    });
    if (pageToken) params.set("pageToken", pageToken);

    const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      const reason = errText.match(/"reason"\s*:\s*"([^"]+)"/)?.[1] || `HTTP ${res.status}`;
      throw new Error(`Drive listing failed (${reason})`);
    }

    const data = await res.json();
    files.push(...(data.files || []));
    pageToken = data.nextPageToken;
  } while (pageToken);

  return files;
}

/**
 * Lightweight accessibility check: can the file actually be served as audio?
 * This is the "playable" leg of the playable-vs-duration distinction.
 * Reuses the same sources as the stream proxy (authed API → anonymous).
 */
export async function checkFileAccessible(
  accessToken: string,
  driveId: string
): Promise<{ playable: boolean; error?: string }> {
  try {
    // Ranged read of the very first bytes through the authed API.
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(driveId)}?alt=media`,
      { headers: { Authorization: `Bearer ${accessToken}`, Range: "bytes=0-1023" } }
    );
    if (res.ok || res.status === 206) {
      const ct = (res.headers.get("Content-Type") || "").toLowerCase();
      if (ct.includes("text/html")) {
        return { playable: false, error: "Drive returned an HTML page instead of audio (permission/interstitial)" };
      }
      const buf = await res.arrayBuffer();
      if (buf.byteLength === 0) {
        return { playable: false, error: "File content is empty" };
      }
      return { playable: true };
    }
    if (res.status === 404) return { playable: false, error: "File not found on Drive (deleted or moved)" };
    if (res.status === 401 || res.status === 403) {
      return { playable: false, error: "Access denied by Drive (file permissions)" };
    }
    return { playable: false, error: `Drive returned HTTP ${res.status}` };
  } catch (err) {
    return {
      playable: false,
      error: `Network error reaching Drive: ${err instanceof Error ? err.message : "unknown"}`,
    };
  }
}
