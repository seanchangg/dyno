import { NextRequest, NextResponse } from "next/server";
import { getAuthUserId } from "@/lib/auth";
import {
  listContextFiles,
  readContextFile,
  writeContextFile,
  initializeDefaultContext,
  listUserContextFiles,
  readUserContextFile,
  writeUserContextFile,
  initializeUserContext,
} from "@/lib/dyno-fs";

export async function GET(req: NextRequest) {
  const userId = getAuthUserId(req);

  if (userId) {
    // Per-user context
    await initializeUserContext(userId);
    const files = await listUserContextFiles(userId);
    const contexts = await Promise.all(
      files.map(async (filename) => {
        try {
          const content = await readUserContextFile(userId, filename);
          return { filename, content };
        } catch {
          return { filename, content: "" };
        }
      })
    );
    return NextResponse.json({ files: contexts });
  }

  // Fallback: shared context (no auth)
  await initializeDefaultContext();
  const files = await listContextFiles();
  const contexts = await Promise.all(
    files.map(async (filename) => {
      try {
        const content = await readContextFile(filename);
        return { filename, content };
      } catch {
        return { filename, content: "" };
      }
    })
  );
  return NextResponse.json({ files: contexts });
}

export async function PUT(req: NextRequest) {
  const userId = getAuthUserId(req);
  const { filename, content } = await req.json();

  if (!filename || typeof content !== "string") {
    return NextResponse.json(
      { error: "filename and content are required" },
      { status: 400 }
    );
  }

  if (userId) {
    await writeUserContextFile(userId, filename, content);
  } else {
    await writeContextFile(filename, content);
  }

  return NextResponse.json({ ok: true });
}

export async function POST(req: NextRequest) {
  const { userName, userId: bodyUserId } = await req.json();
  const userId = getAuthUserId(req) || bodyUserId;

  if (userId) {
    await initializeUserContext(userId, userName);
  } else {
    await initializeDefaultContext(userName);
  }

  return NextResponse.json({ ok: true });
}
