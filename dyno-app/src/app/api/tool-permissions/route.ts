import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

const PERMISSIONS_PATH = path.resolve(
  process.cwd(),
  "data",
  "config",
  "tool-permissions.json"
);

async function ensureDir() {
  await fs.mkdir(path.dirname(PERMISSIONS_PATH), { recursive: true });
}

async function readOverrides(): Promise<Record<string, string>> {
  try {
    const raw = await fs.readFile(PERMISSIONS_PATH, "utf-8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function writeOverrides(overrides: Record<string, string>) {
  await ensureDir();
  await fs.writeFile(PERMISSIONS_PATH, JSON.stringify(overrides, null, 2), "utf-8");
}

/** GET /api/tool-permissions — return current overrides */
export async function GET() {
  const overrides = await readOverrides();
  return NextResponse.json({ overrides });
}

/** POST /api/tool-permissions — set a single tool's mode or bulk update */
export async function POST(req: NextRequest) {
  const body = await req.json();

  // Bulk update: { overrides: { tool: mode, ... } }
  if (body.overrides && typeof body.overrides === "object") {
    await writeOverrides(body.overrides);
    return NextResponse.json({ ok: true, overrides: body.overrides });
  }

  // Single update: { tool: "name", mode: "auto" | "manual" }
  const { tool, mode } = body;
  if (!tool || !mode || !["auto", "manual"].includes(mode)) {
    return NextResponse.json(
      { error: "tool and mode (auto|manual) are required" },
      { status: 400 }
    );
  }

  const overrides = await readOverrides();

  if (mode === "__delete") {
    delete overrides[tool];
  } else {
    overrides[tool] = mode;
  }

  await writeOverrides(overrides);
  return NextResponse.json({ ok: true, overrides });
}

/** DELETE /api/tool-permissions — reset all overrides */
export async function DELETE() {
  await writeOverrides({});
  return NextResponse.json({ ok: true });
}
