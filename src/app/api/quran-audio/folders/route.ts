import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getValidDriveToken } from "@/lib/google-drive";

export const dynamic = "force-dynamic";

interface DriveFolder {
  id: string;
  name: string;
  parents?: string[];
}

interface FolderItem {
  id: string;
  name: string;
  path: string;
}

// GET — List folders from the connected Google Drive account
// GET /api/quran-audio/folders?parentId=<id>&search=<query>&pageToken=<token>
export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const token = await getValidDriveToken();
    if (!token) {
      return NextResponse.json(
        { error: "Google Drive is not connected. Please connect it first." },
        { status: 400 }
      );
    }

    const { searchParams } = new URL(request.url);
    const parentId = searchParams.get("parentId") || "root";
    const searchQuery = searchParams.get("search") || "";
    const pageToken = searchParams.get("pageToken") || "";
    const pageSize = 50;

    // Build query
    let q = "";
    if (searchQuery) {
      // Search mode: search across all folders matching the query
      q = `mimeType='application/vnd.google-apps.folder' and name contains '${searchQuery.replace(/'/g, "\\'")}' and trashed=false`;
    } else {
      // Browse mode: list folders inside parentId
      q = `mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`;
    }

    // Build URL
    const params = new URLSearchParams({
      q,
      fields: "nextPageToken,files(id,name,parents)",
      orderBy: "name",
      pageSize: String(pageSize),
    });
    if (pageToken) {
      params.set("pageToken", pageToken);
    }

    const response = await fetch(
      `https://www.googleapis.com/drive/v3/files?${params.toString()}`,
      {
        headers: {
          Authorization: `Bearer ${token.accessToken}`,
        },
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      console.error("[QURAN-FOLDERS] Google Drive API error:", response.status, errText);
      return NextResponse.json(
        { error: "Failed to list folders from Google Drive" },
        { status: 502 }
      );
    }

    const data = await response.json();
    const files: DriveFolder[] = data.files || [];

    // Build folder items with path info
    const folders: FolderItem[] = files.map((f) => ({
      id: f.id,
      name: f.name,
      path: "", // Will be resolved client-side if needed
    }));

    // Build breadcrumb path for the current parent
    let breadcrumbPath = "";
    if (parentId !== "root") {
      try {
        // Get folder name and parent chain
        const folderInfo = await fetch(
          `https://www.googleapis.com/drive/v3/files/${parentId}?fields=name,parents`,
          {
            headers: {
              Authorization: `Bearer ${token.accessToken}`,
            },
          }
        );
        if (folderInfo.ok) {
          const folderData = await folderInfo.json();
          breadcrumbPath = folderData.name || "";
          // Try to build full path by traversing parents
          let currentParentId = folderData.parents?.[0];
          const pathParts = [breadcrumbPath];
          let depth = 0;
          while (currentParentId && currentParentId !== "root" && depth < 5) {
            const parentInfo = await fetch(
              `https://www.googleapis.com/drive/v3/files/${currentParentId}?fields=name,parents`,
              {
                headers: {
                  Authorization: `Bearer ${token.accessToken}`,
                },
              }
            );
            if (parentInfo.ok) {
              const parentData = await parentInfo.json();
              pathParts.unshift(parentData.name || "");
              currentParentId = parentData.parents?.[0];
            } else {
              break;
            }
            depth++;
          }
          breadcrumbPath = pathParts.join(" / ");
        }
      } catch {
        // Ignore path resolution errors
      }
    }

    return NextResponse.json({
      folders,
      nextPageToken: data.nextPageToken || null,
      parentId,
      parentPath: breadcrumbPath || (parentId === "root" ? "My Drive" : ""),
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[QURAN-FOLDERS] Error:", msg);
    return NextResponse.json({ error: "Failed to list folders" }, { status: 500 });
  }
}
