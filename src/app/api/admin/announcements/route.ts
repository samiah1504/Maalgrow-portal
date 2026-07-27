import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// GET  /api/admin/announcements  — what has been sent
// POST /api/admin/announcements  — send one
// DELETE /api/admin/announcements?id=... — withdraw one, and pull it
//        from every recipient's notifications
//
// The role check, the fan-out and the audit entry all live in
// broadcast_announcement / delete_announcement (migration 028), in
// one transaction with the writes. The session client is used so
// auth.uid() is the administrator who sent it.

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // RLS on announcements already limits this to administrators.
  const { data, error } = await supabase
    .from("announcements")
    .select(
      "id, title, content, target_audience, recipient_count, is_published, created_at"
    )
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ announcements: data ?? [] });
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = (await request.json()) as {
      title?: string;
      message?: string;
      audience?: string;
      actionUrl?: string;
    };

    if (!body.title?.trim() || !body.message?.trim()) {
      return NextResponse.json(
        { error: "An announcement needs a title and a message" },
        { status: 400 }
      );
    }

    const { data, error } = await supabase.rpc("broadcast_announcement", {
      p_title: body.title.trim(),
      p_body: body.message.trim(),
      p_audience: body.audience ?? "investors",
      p_action_url: body.actionUrl?.trim() || null,
    });

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: error.code === "P0001" ? 400 : 500 }
      );
    }

    return NextResponse.json(data ?? {});
  } catch (err) {
    console.error("[API] POST /admin/announcements error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const id = new URL(request.url).searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "Which announcement?" }, { status: 400 });
    }

    const { data, error } = await supabase.rpc("delete_announcement", {
      p_id: id,
    });
    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: error.code === "P0001" ? 400 : 500 }
      );
    }
    return NextResponse.json(data ?? {});
  } catch (err) {
    console.error("[API] DELETE /admin/announcements error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
