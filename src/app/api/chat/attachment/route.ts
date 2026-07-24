import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import {
  CHAT_BUCKET,
  CHAT_MAX_FILE_BYTES,
  CHAT_ALLOWED_MIME,
  canAccessConversation,
} from "@/lib/chat-server";

// POST /api/chat/attachment (multipart form)
//   fields: conversation_id, file, internal_note? ("true" for staff)
// Validates type/size + conversation membership, uploads to the
// PRIVATE chat-attachments bucket via the service role, then records
// the message through chat_send_message (which enforces authorisation
// again and updates statuses/unread/notifications).
export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const form = await request.formData();
    const conversationId = String(form.get("conversation_id") ?? "");
    const file = form.get("file");
    const caption = String(form.get("message") ?? "");
    const internalNote = String(form.get("internal_note") ?? "") === "true";

    if (!conversationId || !(file instanceof File)) {
      return NextResponse.json(
        { error: "conversation_id and file are required" },
        { status: 400 }
      );
    }

    const ext = CHAT_ALLOWED_MIME[file.type];
    if (!ext) {
      return NextResponse.json(
        { error: "Only PDF, JPG and PNG files are allowed" },
        { status: 400 }
      );
    }
    if (file.size > CHAT_MAX_FILE_BYTES) {
      return NextResponse.json(
        { error: "File is too large (maximum 5 MB)" },
        { status: 400 }
      );
    }

    const adminClient = await createAdminClient();
    const access = await canAccessConversation(adminClient, conversationId, user.id);
    if (!access.ok) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const safeName = (file.name || `attachment.${ext}`)
      .replace(/[^\w.\-() ]+/g, "_")
      .slice(0, 120);
    const path = `${conversationId}/${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}.${ext}`;

    const { error: uploadErr } = await adminClient.storage
      .from(CHAT_BUCKET)
      .upload(path, Buffer.from(await file.arrayBuffer()), {
        contentType: file.type,
        upsert: false,
      });
    if (uploadErr) {
      return NextResponse.json(
        { error: "Upload failed: " + uploadErr.message },
        { status: 500 }
      );
    }

    // Record the message with the caller's session (auth.uid = sender)
    const { data, error } = await supabase.rpc("chat_send_message", {
      p_conversation_id: conversationId,
      p_body: caption || null,
      p_attachment_path: path,
      p_attachment_name: safeName,
      p_attachment_mime: file.type,
      p_attachment_size: file.size,
      p_internal_note: internalNote && access.isStaff,
    });

    if (error) {
      // Roll the orphaned file back
      await adminClient.storage.from(CHAT_BUCKET).remove([path]);
      return NextResponse.json(
        { error: error.message },
        { status: error.code === "P0001" ? 400 : 500 }
      );
    }

    return NextResponse.json({ result: data });
  } catch (err) {
    console.error("[API] POST /chat/attachment error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// GET /api/chat/attachment?message_id=...
// Returns a short-lived signed URL for an attachment the caller is
// authorised to see. No permanent public links exist.
export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const url = new URL(request.url);
    const messageId = url.searchParams.get("message_id");
    if (!messageId) {
      return NextResponse.json({ error: "message_id required" }, { status: 400 });
    }

    const adminClient = await createAdminClient();
    const { data: msg } = await adminClient
      .from("chat_messages")
      .select("conversation_id, attachment_path, is_internal_note")
      .eq("id", messageId)
      .maybeSingle();
    if (!msg?.attachment_path) {
      return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
    }

    const access = await canAccessConversation(adminClient, msg.conversation_id, user.id);
    if (!access.ok || (msg.is_internal_note && !access.isStaff)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { data: signed, error: signErr } = await adminClient.storage
      .from(CHAT_BUCKET)
      .createSignedUrl(msg.attachment_path, 120);
    if (signErr || !signed?.signedUrl) {
      return NextResponse.json(
        { error: "Could not generate download link" },
        { status: 500 }
      );
    }

    return NextResponse.redirect(signed.signedUrl);
  } catch (err) {
    console.error("[API] GET /chat/attachment error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
