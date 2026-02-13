import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";
import { getAuthUserId } from "@/lib/auth";

const WIDGETS_DIR = path.join(process.cwd(), "data", "widgets");

const STORAGE_MODE = process.env.STORAGE_MODE || "local";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const WIDGETS_BUCKET = "widgets";
const WORKSPACE_BUCKET = "workspace";

function useCloud(): boolean {
  return STORAGE_MODE === "cloud" && !!SUPABASE_URL && !!SERVICE_ROLE_KEY;
}

/** Try to fetch a file from a Supabase Storage bucket. Returns the content or null. */
async function tryCloudFetch(bucket: string, storagePath: string): Promise<string | null> {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/storage/v1/object/${bucket}/${storagePath}`,
      {
        headers: {
          apikey: SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        },
      }
    );
    if (res.ok) return await res.text();
  } catch {
    // Not found or network error
  }
  return null;
}

/**
 * Inject a small script into the HTML that exposes the userId to widget JS.
 * This lets widget-exec calls automatically include the userId.
 */
function injectUserId(html: string, userId: string): string {
  const injection = `<script>window.__DYNO_USER_ID=${JSON.stringify(userId)};</script>`;
  // Insert right after <head> if present, otherwise prepend
  if (html.includes("<head>")) {
    return html.replace("<head>", `<head>${injection}`);
  }
  if (html.includes("<head ")) {
    return html.replace(/<head\s[^>]*>/, `$&${injection}`);
  }
  return injection + html;
}

/**
 * GET /api/widget-html/[filename]
 * Serves HTML files for the html widget type.
 *
 * In cloud mode, checks multiple Supabase Storage locations:
 *   1. widgets bucket: {userId}/{filename}  (dedicated widgets bucket)
 *   2. workspace bucket: {userId}/widgets/{filename}  (written via write_file)
 *   3. widgets bucket: public/{filename}  (public fallback)
 *
 * Injects window.__DYNO_USER_ID into served HTML so widget JS can pass it
 * to /api/widget-exec calls automatically.
 *
 * Supports userId via query param (?userId=...) or x-user-id header.
 * Falls back to local filesystem for dev.
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

  const userId =
    getAuthUserId(req) ||
    req.nextUrl.searchParams.get("userId") ||
    req.headers.get("x-user-id") ||
    "";

  const htmlResponse = (content: string) => {
    // Inject userId so widget JS can use it for API calls
    const injected = userId ? injectUserId(content, userId) : content;
    return new NextResponse(injected, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  };

  // Cloud mode: try Supabase Storage locations
  if (useCloud()) {
    if (userId) {
      // 1. Check dedicated widgets bucket: {userId}/{filename}
      const fromWidgets = await tryCloudFetch(WIDGETS_BUCKET, `${userId}/${filename}`);
      if (fromWidgets) return htmlResponse(fromWidgets);

      // 2. Check workspace bucket: {userId}/widgets/{filename}
      //    This is where write_file workspace/widgets/foo.html saves to
      const fromWorkspace = await tryCloudFetch(WORKSPACE_BUCKET, `${userId}/widgets/${filename}`);
      if (fromWorkspace) return htmlResponse(fromWorkspace);
    }

    // 3. Public widgets bucket fallback (no auth needed)
    try {
      const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${WIDGETS_BUCKET}/${filename}`;
      const res = await fetch(publicUrl);
      if (res.ok) {
        const content = await res.text();
        return htmlResponse(content);
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
    return htmlResponse(content);
  } catch {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
}
