import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { requireCommsAdmin } from "@/lib/comms/server";

// PATCH: edit fields, archive/restore, or duplicate a template
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireCommsAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const body = (await request.json()) as {
    action?: "archive" | "restore" | "duplicate";
    name?: string;
    channel?: "sms" | "whatsapp" | "both";
    body?: string;
    whatsapp_template_code?: string | null;
    header_media_url?: string | null;
  };

  const db = await createAdminClient();
  const { data: existing } = await db
    .from("comm_templates")
    .select("*")
    .eq("id", id)
    .single();
  if (!existing) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

  if (body.action === "duplicate") {
    const { data: copy, error } = await db
      .from("comm_templates")
      .insert({
        name: `${existing.name} (copy)`,
        channel: existing.channel,
        body: existing.body,
        whatsapp_template_code: existing.whatsapp_template_code,
        header_media_url: existing.header_media_url,
        created_by: auth.userId,
      })
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ template: copy });
  }

  const update =
    body.action === "archive"
      ? { status: "archived" as const }
      : body.action === "restore"
      ? { status: "active" as const }
      : {
          ...(body.name !== undefined ? { name: body.name.trim() } : {}),
          ...(body.channel !== undefined ? { channel: body.channel } : {}),
          ...(body.body !== undefined ? { body: body.body } : {}),
          ...(body.whatsapp_template_code !== undefined
            ? { whatsapp_template_code: body.whatsapp_template_code }
            : {}),
          ...(body.header_media_url !== undefined
            ? { header_media_url: body.header_media_url }
            : {}),
        };

  const { data: template, error } = await db
    .from("comm_templates")
    .update({ ...update, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ template });
}
