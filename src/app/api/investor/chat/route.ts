import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// POST /api/investor/chat
//   action: "start"      — open (or reuse) the investor's conversation
//   action: "send"       — send a message in their own conversation
//   action: "mark_read"  — mark admin messages read
// All authorisation lives in the SECURITY DEFINER functions.
export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = (await request.json()) as {
      action?: string;
      conversation_id?: string;
      category?: string;
      message?: string;
      related_series_id?: string | null;
      related_cycle_id?: string | null;
    };

    let rpc;
    switch (body.action) {
      case "start":
        rpc = supabase.rpc("chat_start_conversation", {
          p_category: body.category ?? "General Enquiry",
          p_body: body.message ?? "",
          p_related_series_id: body.related_series_id ?? null,
          p_related_cycle_id: body.related_cycle_id ?? null,
        });
        break;
      case "send":
        if (!body.conversation_id) {
          return NextResponse.json({ error: "conversation_id required" }, { status: 400 });
        }
        rpc = supabase.rpc("chat_send_message", {
          p_conversation_id: body.conversation_id,
          p_body: body.message ?? "",
        });
        break;
      case "mark_read":
        if (!body.conversation_id) {
          return NextResponse.json({ error: "conversation_id required" }, { status: 400 });
        }
        rpc = supabase.rpc("chat_mark_read", {
          p_conversation_id: body.conversation_id,
        });
        break;
      default:
        return NextResponse.json(
          { error: "action must be start, send or mark_read" },
          { status: 400 }
        );
    }

    const { data, error } = await rpc;
    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: error.code === "P0001" ? 400 : 500 }
      );
    }
    return NextResponse.json({ result: data ?? { success: true } });
  } catch (err) {
    console.error("[API] POST /investor/chat error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
