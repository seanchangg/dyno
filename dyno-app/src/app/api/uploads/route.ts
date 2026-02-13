import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { getAuthUserId } from "@/lib/auth";

const UPLOADS_DIR = path.resolve(process.cwd(), "data", "uploads");
const MAX_FILE_SIZE = 200 * 1024 * 1024; // 200MB

const STORAGE_MODE = process.env.STORAGE_MODE || "local";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const UPLOADS_BUCKET = "uploads";

function useCloud(): boolean {
  return STORAGE_MODE === "cloud" && !!SUPABASE_URL && !!SERVICE_ROLE_KEY;
}

function supabaseHeaders(contentType?: string): Record<string, string> {
  const h: Record<string, string> = {
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
  };
  if (contentType) h["Content-Type"] = contentType;
  return h;
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const userId = getAuthUserId(request) || (formData.get("userId") as string | null);

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "File too large (max 200MB)" },
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

    if (useCloud() && userId) {
      // Upload to Supabase Storage
      const storagePath = `${userId}/${safeName}`;
      const buffer = Buffer.from(await file.arrayBuffer());

      const res = await fetch(
        `${SUPABASE_URL}/storage/v1/object/${UPLOADS_BUCKET}/${storagePath}`,
        {
          method: "POST",
          headers: {
            ...supabaseHeaders(file.type || "application/octet-stream"),
            "x-upsert": "true",
          },
          body: buffer,
        }
      );

      if (!res.ok) {
        const errBody = await res.text();
        return NextResponse.json(
          { error: `Storage upload failed: ${errBody}` },
          { status: 500 }
        );
      }

      return NextResponse.json({
        filename: safeName,
        size: file.size,
        uploaded: true,
        storage: "cloud",
      });
    }

    // Local mode
    await fs.mkdir(UPLOADS_DIR, { recursive: true });

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

export async function GET(request: NextRequest) {
  const userId = getAuthUserId(request);

  if (useCloud() && userId) {
    try {
      const res = await fetch(
        `${SUPABASE_URL}/storage/v1/object/list/${UPLOADS_BUCKET}`,
        {
          method: "POST",
          headers: supabaseHeaders("application/json"),
          body: JSON.stringify({
            prefix: `${userId}/`,
            limit: 1000,
            offset: 0,
            sortBy: { column: "created_at", order: "desc" },
          }),
        }
      );

      if (!res.ok) {
        return NextResponse.json([], { status: 200 });
      }

      const files = (await res.json()) as Array<{
        name: string;
        metadata?: { size?: number };
        created_at?: string;
      }>;

      const results = files
        .filter((f) => f.name && !f.name.endsWith("/"))
        .map((f) => ({
          filename: f.name,
          size: f.metadata?.size || 0,
          createdAt: f.created_at ? new Date(f.created_at).getTime() : 0,
        }));

      return NextResponse.json(results);
    } catch {
      return NextResponse.json([], { status: 200 });
    }
  }

  // Local mode
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
    const body = await request.json();
    const filename = body.filename;
    const userId = getAuthUserId(request) || body.userId;

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

    if (useCloud() && userId) {
      const storagePath = `${userId}/${filename}`;
      const res = await fetch(
        `${SUPABASE_URL}/storage/v1/object/${UPLOADS_BUCKET}`,
        {
          method: "DELETE",
          headers: supabaseHeaders("application/json"),
          body: JSON.stringify({ prefixes: [storagePath] }),
        }
      );

      if (!res.ok) {
        const errBody = await res.text();
        return NextResponse.json(
          { error: `Delete failed: ${errBody}` },
          { status: 500 }
        );
      }

      return NextResponse.json({ deleted: true });
    }

    // Local mode
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
