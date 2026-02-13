import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getAuthUserId } from "@/lib/auth";

/**
 * GET /api/memories?userId=...&tag=...&q=...
 * List/search memories. Optional tag filter and text search.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const userId = getAuthUserId(req);
  const tag = searchParams.get("tag");
  const q = searchParams.get("q");

  if (!userId) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }

  const supabase = createServerSupabaseClient();

  let query = supabase
    .from("agent_memories")
    .select("id, tag, content, created_at, updated_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });

  if (tag) {
    query = query.eq("tag", tag);
  }

  if (q) {
    query = query.textSearch("content", q, { type: "websearch" });
  }

  query = query.limit(50);

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ memories: data });
}

/**
 * POST /api/memories
 * Create or upsert a memory. If tag matches existing, updates content.
 * Body: { userId, tag, content }
 */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const userId = getAuthUserId(req) || body.userId;
  const { tag, content } = body;

  if (!userId || !tag || !content) {
    return NextResponse.json(
      { error: "userId, tag, and content are required" },
      { status: 400 }
    );
  }

  const supabase = createServerSupabaseClient();

  // Check if a memory with this tag already exists for this user
  const { data: existing } = await supabase
    .from("agent_memories")
    .select("id")
    .eq("user_id", userId)
    .eq("tag", tag)
    .limit(1)
    .single();

  if (existing) {
    // Update existing
    const { error } = await supabase
      .from("agent_memories")
      .update({ content, updated_at: new Date().toISOString() })
      .eq("id", existing.id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ ok: true, id: existing.id, action: "updated" });
  }

  // Create new
  const { data, error } = await supabase
    .from("agent_memories")
    .insert({ user_id: userId, tag, content })
    .select("id")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, id: data.id, action: "created" });
}

/**
 * DELETE /api/memories?userId=...&id=...
 * Delete a specific memory by ID.
 */
export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const userId = getAuthUserId(req);
  const id = searchParams.get("id");
  const tag = searchParams.get("tag");

  if (!userId) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }

  const supabase = createServerSupabaseClient();

  if (id) {
    const { error } = await supabase
      .from("agent_memories")
      .delete()
      .eq("id", id)
      .eq("user_id", userId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
  } else if (tag) {
    // Delete all memories with this tag
    const { error } = await supabase
      .from("agent_memories")
      .delete()
      .eq("tag", tag)
      .eq("user_id", userId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
  } else {
    return NextResponse.json(
      { error: "id or tag is required" },
      { status: 400 }
    );
  }

  return NextResponse.json({ ok: true });
}
