import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getAuthUserId } from "@/lib/auth";

export async function PUT(req: NextRequest) {
  const body = await req.json();
  const userId = getAuthUserId(req) || body.userId;
  const { encrypted_api_key, chat_settings } = body;

  if (!userId) {
    return NextResponse.json(
      { error: "userId is required" },
      { status: 400 }
    );
  }

  // Build update payload — only include fields that were sent
  const update: Record<string, unknown> = {};
  if (typeof encrypted_api_key === "string") {
    update.encrypted_api_key = encrypted_api_key;
  }
  if (chat_settings !== undefined) {
    update.chat_settings = chat_settings;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json(
      { error: "No fields to update" },
      { status: 400 }
    );
  }

  const supabase = createServerSupabaseClient();

  const { error } = await supabase
    .from("profiles")
    .update(update)
    .eq("id", userId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
