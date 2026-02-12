import { supabase } from "@/lib/supabase/client";
import type { Widget } from "@/types/widget";

/**
 * Fetch the saved layout for a user from Supabase.
 */
export async function fetchLayout(userId: string): Promise<Widget[] | null> {
  try {
    const { data, error } = await supabase
      .from("widget_layouts")
      .select("layout")
      .eq("user_id", userId)
      .maybeSingle();

    if (error || !data) return null;

    const layout = data.layout;
    if (Array.isArray(layout)) return layout as Widget[];
    if (layout && typeof layout === "object" && Array.isArray(layout.widgets)) {
      return layout.widgets as Widget[];
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Save the layout for a user to Supabase (upsert).
 */
export async function saveLayoutToSupabase(
  userId: string,
  widgets: Widget[]
): Promise<void> {
  try {
    await supabase
      .from("widget_layouts")
      .upsert(
        {
          user_id: userId,
          layout: widgets,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );
  } catch {
    // non-critical
  }
}
