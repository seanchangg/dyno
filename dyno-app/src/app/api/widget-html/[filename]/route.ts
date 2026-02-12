import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";

const WIDGETS_DIR = path.join(process.cwd(), "data", "widgets");

/**
 * GET /api/widget-html/[filename]
 * Serves HTML files from data/widgets/ for the html widget type.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  const { filename } = await params;

  // Validate filename: must end in .html, no path traversal
  if (!filename.endsWith(".html") || filename.includes("..") || filename.includes("/")) {
    return NextResponse.json({ error: "Invalid filename" }, { status: 400 });
  }

  const filePath = path.join(WIDGETS_DIR, filename);

  // Ensure resolved path is still within WIDGETS_DIR
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
