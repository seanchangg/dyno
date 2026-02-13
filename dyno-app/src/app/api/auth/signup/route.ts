import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { initializeUserContext } from "@/lib/dyno-fs";

export async function POST(req: NextRequest) {
  const { email, password, username, fullName } = await req.json();

  if (!email || !password || !username || !fullName) {
    return NextResponse.json(
      { error: "All fields are required" },
      { status: 400 }
    );
  }

  const supabase = createServerSupabaseClient();

  // Try to create auth user with auto-confirm
  const { data: authData, error: authError } =
    await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

  let userId: string;

  if (authError) {
    if (authError.message.includes("already been registered")) {
      // Check if they have a profile (fully registered) vs ghost user
      const { data: listData } = await supabase.auth.admin.listUsers();
      const existing = listData?.users?.find((u) => u.email === email);
      if (!existing) {
        return NextResponse.json({ error: "User lookup failed" }, { status: 400 });
      }

      const { data: existingProfile } = await supabase
        .from("profiles")
        .select("id")
        .eq("id", existing.id)
        .single();

      if (existingProfile) {
        // Fully registered user — tell them to sign in
        return NextResponse.json(
          { error: "already_registered" },
          { status: 409 }
        );
      }

      // Ghost user — update password and create profile
      userId = existing.id;
      await supabase.auth.admin.updateUserById(userId, { password });
    } else {
      return NextResponse.json({ error: authError.message }, { status: 400 });
    }
  } else {
    userId = authData.user.id;
  }

  // Upsert profile row
  const { error: profileError } = await supabase.from("profiles").upsert({
    id: userId,
    username,
    full_name: fullName,
  });

  if (profileError) {
    return NextResponse.json(
      { error: profileError.message },
      { status: 400 }
    );
  }

  try {
    await initializeUserContext(userId, fullName);
  } catch {
    // Non-critical — workspace will be provisioned on first gateway connect
  }

  return NextResponse.json({ ok: true });
}
