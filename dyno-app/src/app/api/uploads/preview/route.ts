import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { getAuthUserId } from "@/lib/auth";

const UPLOADS_DIR = path.resolve(process.cwd(), "data", "uploads");
const MAX_PREVIEW_BYTES = 50 * 1024; // 50KB preview limit

const STORAGE_MODE = process.env.STORAGE_MODE || "local";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const UPLOADS_BUCKET = "uploads";

const isCloudMode = STORAGE_MODE === "cloud" && !!SUPABASE_URL && !!SERVICE_ROLE_KEY;

export async function GET(request: NextRequest) {
  const filename = request.nextUrl.searchParams.get("filename");
  const userId = getAuthUserId(request);

  if (!filename || typeof filename !== "string") {
    return NextResponse.json({ error: "filename required" }, { status: 400 });
  }

  // Path traversal protection
  if (filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
    return NextResponse.json({ error: "Invalid filename" }, { status: 400 });
  }

  if (isCloudMode && userId) {
    try {
      const storagePath = `${userId}/${filename}`;
      const res = await fetch(
        `${SUPABASE_URL}/storage/v1/object/${UPLOADS_BUCKET}/${storagePath}`,
        {
          headers: {
            apikey: SERVICE_ROLE_KEY,
            Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
          },
        },
      );

      if (!res.ok) {
        return NextResponse.json({ error: "File not found" }, { status: 404 });
      }

      const buffer = Buffer.from(await res.arrayBuffer());
      let text: string;
      try {
        text = buffer.toString("utf-8");
      } catch {
        return NextResponse.json({ error: "Binary file, preview not available" }, { status: 400 });
      }

      if (text.length > MAX_PREVIEW_BYTES) {
        text = text.slice(0, MAX_PREVIEW_BYTES) + `\n\n... (truncated, showing first 50KB)`;
      }

      return new NextResponse(text, {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    } catch {
      return NextResponse.json({ error: "Preview failed" }, { status: 500 });
    }
  }

  // Local mode
  try {
    const filePath = path.join(UPLOADS_DIR, filename);
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(path.resolve(UPLOADS_DIR))) {
      return NextResponse.json({ error: "Invalid path" }, { status: 400 });
    }

    const stat = await fs.stat(resolved);
    const bytesToRead = Math.min(stat.size, MAX_PREVIEW_BYTES);

    const fileHandle = await fs.open(resolved, "r");
    const buffer = Buffer.alloc(bytesToRead);
    await fileHandle.read(buffer, 0, bytesToRead, 0);
    await fileHandle.close();

    let text: string;
    try {
      text = buffer.toString("utf-8");
    } catch {
      return NextResponse.json({ error: "Binary file, preview not available" }, { status: 400 });
    }

    if (stat.size > MAX_PREVIEW_BYTES) {
      text += `\n\n... (truncated, showing first 50KB of ${(stat.size / 1024).toFixed(1)}KB)`;
    }

    return new NextResponse(text, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
}
