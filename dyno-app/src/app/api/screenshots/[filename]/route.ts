import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

const SCREENSHOTS_DIR = path.resolve(process.cwd(), "data", "screenshots");

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  const { filename } = await params;

  // Path traversal protection
  if (filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
    return NextResponse.json({ error: "Invalid filename" }, { status: 400 });
  }

  if (!filename.endsWith(".png")) {
    return NextResponse.json({ error: "Only PNG files served" }, { status: 400 });
  }

  const filePath = path.join(SCREENSHOTS_DIR, filename);
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(path.resolve(SCREENSHOTS_DIR))) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  try {
    const data = await fs.readFile(filePath);
    return new NextResponse(data, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
}
