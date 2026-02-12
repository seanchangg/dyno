import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * GET /api/screenshots?userId=...
 * List screenshots for a user from Supabase DB.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get("userId");

  if (!userId) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }

  const supabase = createServerSupabaseClient();

  const { data, error } = await supabase
    .from("agent_screenshots")
    .select("id, filename, storage_path, public_url, size, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ screenshots: data });
}

/**
 * POST /api/screenshots
 * Upload a screenshot to Supabase Storage and insert metadata row.
 * Accepts multipart form data with fields: file (PNG), userId, filename.
 */
export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const userId = formData.get("userId") as string | null;
  const filename = formData.get("filename") as string | null;

  if (!file || !userId || !filename) {
    return NextResponse.json(
      { error: "file, userId, and filename are required" },
      { status: 400 }
    );
  }

  const supabase = createServerSupabaseClient();

  // Upload to Supabase Storage: screenshots/{userId}/{filename}
  const storagePath = `${userId}/${filename}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: uploadError } = await supabase.storage
    .from("screenshots")
    .upload(storagePath, buffer, {
      contentType: "image/png",
      upsert: true,
    });

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 400 });
  }

  // Get public URL
  const { data: urlData } = supabase.storage
    .from("screenshots")
    .getPublicUrl(storagePath);

  const publicUrl = urlData.publicUrl;

  // Insert metadata row
  const { data, error: insertError } = await supabase
    .from("agent_screenshots")
    .insert({
      user_id: userId,
      filename,
      storage_path: storagePath,
      public_url: publicUrl,
      size: buffer.length,
    })
    .select("id, filename, public_url, size, created_at")
    .single();

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    id: data.id,
    filename: data.filename,
    publicUrl: data.public_url,
    size: data.size,
    createdAt: data.created_at,
  });
}

/**
 * DELETE /api/screenshots?userId=...&id=...
 * Delete a screenshot from both Supabase Storage and DB.
 */
export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get("userId");
  const id = searchParams.get("id");

  if (!userId || !id) {
    return NextResponse.json(
      { error: "userId and id are required" },
      { status: 400 }
    );
  }

  const supabase = createServerSupabaseClient();

  // Get the storage path before deleting the row
  const { data: row, error: fetchError } = await supabase
    .from("agent_screenshots")
    .select("storage_path")
    .eq("id", id)
    .eq("user_id", userId)
    .single();

  if (fetchError || !row) {
    return NextResponse.json({ error: "Screenshot not found" }, { status: 404 });
  }

  // Delete from Storage
  await supabase.storage.from("screenshots").remove([row.storage_path]);

  // Delete DB row
  const { error: deleteError } = await supabase
    .from("agent_screenshots")
    .delete()
    .eq("id", id)
    .eq("user_id", userId);

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
