import { NextResponse } from "next/server";
import { readLayout, writeLayout } from "@/lib/dyno-fs";

export async function GET() {
  try {
    const widgets = await readLayout();
    return NextResponse.json({ widgets });
  } catch {
    return NextResponse.json({ widgets: [] });
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const widgets = body.widgets;
    if (!Array.isArray(widgets)) {
      return NextResponse.json(
        { error: "widgets must be an array" },
        { status: 400 }
      );
    }
    await writeLayout(widgets);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: String(err) },
      { status: 500 }
    );
  }
}
