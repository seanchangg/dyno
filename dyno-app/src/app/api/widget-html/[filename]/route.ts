import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";

const WIDGETS_DIR = path.join(process.cwd(), "data", "widgets");

const STORAGE_MODE = process.env.STORAGE_MODE || "local";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const WIDGETS_BUCKET = "widgets";

function useCloud(): boolean {
  return STORAGE_MODE === "cloud" && !!SUPABASE_URL && !!SERVICE_ROLE_KEY;
}

/**
 * GET /api/widget-html/[filename]
 * Serves HTML files for the html widget type.
 *
 * In cloud mode, reads from Supabase Storage widgets bucket.
 * Falls back to local filesystem for dev.
 *
 * Supports userId query param for user-scoped cloud storage.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  const { filename } = await params;

  // Validate filename: must end in .html, no path traversal
  if (!filename.endsWith(".html") || filename.includes("..") || filename.includes("/")) {
    return NextResponse.json({ error: "Invalid filename" }, { status: 400 });
  }

  // Cloud mode: try Supabase Storage first
  if (useCloud()) {
    const userId = req.nextUrl.searchParams.get("userId");
    if (userId) {
      try {
        const storagePath = `${userId}/${filename}`;
        const res = await fetch(
          `${SUPABASE_URL}/storage/v1/object/${WIDGETS_BUCKET}/${storagePath}`,
          {
            headers: {
              apikey: SERVICE_ROLE_KEY,
              Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
            },
          }
        );

        if (res.ok) {
          const content = await res.text();
          return new NextResponse(content, {
            status: 200,
            headers: { "Content-Type": "text/html; charset=utf-8" },
          });
        }
      } catch {
        // Fall through to local
      }
    }

    // For public widgets bucket, try without userId
    try {
      const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${WIDGETS_BUCKET}/${filename}`;
      const res = await fetch(publicUrl);
      if (res.ok) {
        const content = await res.text();
        return new NextResponse(content, {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }
    } catch {
      // Fall through to local
    }
  }

  // Local mode fallback
  const filePath = path.join(WIDGETS_DIR, filename);
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(path.resolve(WIDGETS_DIR))) {
    return NextResponse.json({ error: "Invalid filename" }, { status: 400 });
  }

  try {
    const content = await readFile(resolved, "utf-8");
    return new NextResponse(content, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  } catch {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
}
