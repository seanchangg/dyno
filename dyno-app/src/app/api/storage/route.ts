import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { getAuthUserId } from "@/lib/auth";

const ALLOWED_BUCKETS = ["workspace", "scripts", "widgets", "uploads"] as const;
type BucketName = (typeof ALLOWED_BUCKETS)[number];

const STORAGE_MODE = process.env.STORAGE_MODE || "local";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

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

export async function GET(request: NextRequest) {
  const bucket = request.nextUrl.searchParams.get("bucket") as BucketName | null;

  if (!bucket || !ALLOWED_BUCKETS.includes(bucket)) {
    return NextResponse.json(
      { error: "Invalid bucket. Must be one of: workspace, scripts, widgets, uploads" },
      { status: 400 },
    );
  }

  const userId = getAuthUserId(request);

  if (useCloud() && userId) {
    try {
      const res = await fetch(
        `${SUPABASE_URL}/storage/v1/object/list/${bucket}`,
        {
          method: "POST",
          headers: supabaseHeaders("application/json"),
          body: JSON.stringify({
            prefix: `${userId}/`,
            limit: 1000,
            offset: 0,
            sortBy: { column: "created_at", order: "desc" },
          }),
        },
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
  const bucketDir = path.resolve(process.cwd(), "data", bucket);
  try {
    await fs.mkdir(bucketDir, { recursive: true });
    const files = await fs.readdir(bucketDir);

    const results = await Promise.all(
      files.map(async (filename) => {
        const stat = await fs.stat(path.join(bucketDir, filename));
        return {
          filename,
          size: stat.size,
          createdAt: stat.mtimeMs,
        };
      }),
    );

    results.sort((a, b) => b.createdAt - a.createdAt);
    return NextResponse.json(results);
  } catch {
    return NextResponse.json([], { status: 200 });
  }
}
