import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

const SCREENSHOTS_DIR = path.resolve(process.cwd(), "data", "screenshots");

export async function GET() {
  try {
    await fs.mkdir(SCREENSHOTS_DIR, { recursive: true });
    const files = await fs.readdir(SCREENSHOTS_DIR);
    const pngs = files.filter((f) => f.endsWith(".png"));

    const results = await Promise.all(
      pngs.map(async (filename) => {
        const stat = await fs.stat(path.join(SCREENSHOTS_DIR, filename));
        return {
          filename,
          size: stat.size,
          createdAt: stat.mtimeMs,
        };
      })
    );

    // Sort newest first
    results.sort((a, b) => b.createdAt - a.createdAt);

    return NextResponse.json(results);
  } catch {
    return NextResponse.json([], { status: 200 });
  }
}
