import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureDatabase } from "@/lib/db-init";

export const dynamic = "force-dynamic";

// POST - Upload a chunk
export async function POST(request: NextRequest) {
  try {
    await ensureDatabase();

    const formData = await request.formData();
    const chunk = formData.get("chunk") as File;
    const uploadSessionId = formData.get("uploadSessionId") as string;
    const chunkIndex = parseInt(formData.get("chunkIndex") as string);
    const totalChunks = parseInt(formData.get("totalChunks") as string);

    if (!chunk || !uploadSessionId) {
      return NextResponse.json(
        { error: "Data tidak lengkap" },
        { status: 400 }
      );
    }

    // Get upload session
    const sessionRecord = await prisma.setting.findUnique({
      where: { key: `upload_session_${uploadSessionId}` },
    });

    if (!sessionRecord) {
      return NextResponse.json(
        { error: "Sesi muat naik tidak ditemui" },
        { status: 404 }
      );
    }

    const session = JSON.parse(sessionRecord.value);

    // Convert chunk to buffer
    const chunkBuffer = Buffer.from(await chunk.arrayBuffer());
    const chunkSize = chunkBuffer.length;

    // Calculate byte range
    const bytesPerChunk = Math.ceil(session.fileSize / totalChunks);
    const startByte = chunkIndex * bytesPerChunk;
    const endByte = Math.min(startByte + chunkSize - 1, session.fileSize - 1);

    // Upload chunk to Google Drive
    const contentRange = `bytes ${startByte}-${endByte}/${session.fileSize}`;

    const chunkResponse = await fetch(session.uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Range": contentRange,
      },
      body: chunkBuffer,
    });

    // 308 Resume Incomplete is expected for intermediate chunks
    // 200 OK is returned for the final chunk
    if (chunkResponse.status !== 308 && chunkResponse.status !== 200) {
      const error = await chunkResponse.text();
      console.error(`[UPLOAD-CHUNK] Failed at chunk ${chunkIndex}:`, error);
      return NextResponse.json(
        { error: `Gagal memuat naik bahagian ${chunkIndex + 1}` },
        { status: 500 }
      );
    }

    // Update session with chunk received
    session.chunksReceived.push(chunkIndex);
    await prisma.setting.update({
      where: { key: `upload_session_${uploadSessionId}` },
      data: { value: JSON.stringify(session) },
    });

    return NextResponse.json({
      success: true,
      chunkIndex,
      bytesUploaded: endByte + 1,
    });
  } catch (error) {
    console.error("[UPLOAD-CHUNK] Error:", error);
    return NextResponse.json(
      { error: "Gagal memuat naik bahagian" },
      { status: 500 }
    );
  }
}
