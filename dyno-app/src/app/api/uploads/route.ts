import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

const UPLOADS_DIR = path.resolve(process.cwd(), "data", "uploads");
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export async function POST(request: NextRequest) {
  try {
    await fs.mkdir(UPLOADS_DIR, { recursive: true });

    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "File too large (max 10MB)" },
        { status: 400 }
      );
    }

    // Sanitize filename
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    if (!safeName || safeName.startsWith(".")) {
      return NextResponse.json(
        { error: "Invalid filename" },
        { status: 400 }
      );
    }

    const filePath = path.join(UPLOADS_DIR, safeName);
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(path.resolve(UPLOADS_DIR))) {
      return NextResponse.json({ error: "Invalid path" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(filePath, buffer);

    return NextResponse.json({
      filename: safeName,
      size: file.size,
      uploaded: true,
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Upload failed: ${err}` },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    await fs.mkdir(UPLOADS_DIR, { recursive: true });
    const files = await fs.readdir(UPLOADS_DIR);

    const results = await Promise.all(
      files.map(async (filename) => {
        const stat = await fs.stat(path.join(UPLOADS_DIR, filename));
        return {
          filename,
          size: stat.size,
          createdAt: stat.mtimeMs,
        };
      })
    );

    results.sort((a, b) => b.createdAt - a.createdAt);
    return NextResponse.json(results);
  } catch {
    return NextResponse.json([], { status: 200 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { filename } = await request.json();

    if (!filename || typeof filename !== "string") {
      return NextResponse.json(
        { error: "filename required" },
        { status: 400 }
      );
    }

    // Path traversal protection
    if (filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
      return NextResponse.json({ error: "Invalid filename" }, { status: 400 });
    }

    const filePath = path.join(UPLOADS_DIR, filename);
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(path.resolve(UPLOADS_DIR))) {
      return NextResponse.json({ error: "Invalid path" }, { status: 400 });
    }

    await fs.unlink(filePath);
    return NextResponse.json({ deleted: true });
  } catch {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
}
