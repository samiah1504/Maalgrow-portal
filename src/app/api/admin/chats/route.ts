import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

// POST /api/admin/chats
//   send                — staff reply (or internal note)
//   mark_read           — clear the staff unread counter
//   assign / priority_high / priority_normal / resolve / reopen / archive
//   bulk_assign_manager — default manager for many investors
//   save_quick_reply    — super admin adds/edits a quick reply
//   update_settings     — super admin edits the support notice
//   log_export          — audit a chat-list export
// Role enforcement lives inside the SECURITY DEFINER functions; the
// extra checks here are for the super-admin-only extras.
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
      message?: string;
      internal_note?: boolean;
      manager_id?: string | null;
      reason?: string;
      investor_ids?: string[];
      quick_reply?: { id?: string; title?: string; message?: string; active?: boolean };
      support_notice?: string;
      count?: number;
    };
    const action = body.action ?? "";

    const conversationActions = [
      "assign",
      "priority_high",
      "priority_normal",
      "resolve",
      "reopen",
      "archive",
    ];

    if (action === "send") {
      if (!body.conversation_id) {
        return NextResponse.json({ error: "conversation_id required" }, { status: 400 });
      }
      const { data, error } = await supabase.rpc("chat_send_message", {
        p_conversation_id: body.conversation_id,
        p_body: body.message ?? "",
        p_internal_note: body.internal_note === true,
      });
      if (error) {
        return NextResponse.json(
          { error: error.message },
          { status: error.code === "P0001" ? 400 : 500 }
        );
      }
      return NextResponse.json({ result: data });
    }

    if (action === "mark_read") {
      if (!body.conversation_id) {
        return NextResponse.json({ error: "conversation_id required" }, { status: 400 });
      }
      const { error } = await supabase.rpc("chat_mark_read", {
        p_conversation_id: body.conversation_id,
      });
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      return NextResponse.json({ result: { success: true } });
    }

    if (conversationActions.includes(action)) {
      if (!body.conversation_id) {
        return NextResponse.json({ error: "conversation_id required" }, { status: 400 });
      }
      const { data, error } = await supabase.rpc("chat_update_conversation", {
        p_conversation_id: body.conversation_id,
        p_action: action,
        p_manager_id: body.manager_id ?? null,
        p_reason: body.reason ?? null,
      });
      if (error) {
        return NextResponse.json(
          { error: error.message },
          { status: error.code === "P0001" ? 400 : 500 }
        );
      }
      return NextResponse.json({ result: data });
    }

    if (action === "bulk_assign_manager") {
      const { data, error } = await supabase.rpc("chat_bulk_assign_manager", {
        p_investor_ids: body.investor_ids ?? [],
        p_manager_id: body.manager_id ?? null,
      });
      if (error) {
        return NextResponse.json(
          { error: error.message },
          { status: error.code === "P0001" ? 400 : 500 }
        );
      }
      return NextResponse.json({ result: data });
    }

    // Super-admin-only extras below
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();
    const isSenior = ["super_admin", "administrator"].includes(profile?.role ?? "");

    const db = await createAdminClient();

    if (action === "save_quick_reply") {
      if (!isSenior) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      const qr = body.quick_reply ?? {};
      if (qr.id) {
        const { error } = await db
          .from("chat_quick_replies")
          .update({
            ...(qr.title !== undefined ? { title: qr.title } : {}),
            ...(qr.message !== undefined ? { message: qr.message } : {}),
            ...(qr.active !== undefined ? { active: qr.active } : {}),
            updated_at: new Date().toISOString(),
          })
          .eq("id", qr.id);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      } else {
        if (!qr.title?.trim() || !qr.message?.trim()) {
          return NextResponse.json(
            { error: "Title and message are required" },
            { status: 400 }
          );
        }
        const { error } = await db.from("chat_quick_replies").insert({
          title: qr.title.trim(),
          message: qr.message.trim(),
          created_by: user.id,
        });
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      }
      return NextResponse.json({ result: { success: true } });
    }

    if (action === "update_settings") {
      if (!isSenior) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      const { error } = await db
        .from("chat_settings")
        .update({
          support_notice: body.support_notice ?? "",
          updated_at: new Date().toISOString(),
        })
        .eq("id", true);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ result: { success: true } });
    }

    if (action === "log_export") {
      if (!isSenior) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      await supabase.rpc("create_audit_log", {
        p_action: "chat_export",
        p_entity_type: "chat_conversation",
        p_entity_id: null,
        p_old_values: null,
        p_new_values: { rows: body.count ?? 0 },
      });
      return NextResponse.json({ result: { success: true } });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    console.error("[API] POST /admin/chats error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
