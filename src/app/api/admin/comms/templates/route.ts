import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { requireCommsAdmin } from "@/lib/comms/server";
import { extractVariables } from "@/lib/comms/util";

export async function GET() {
  const auth = await requireCommsAdmin();
  if (!auth.ok) return auth.response;

  const db = await createAdminClient();
  const { data: templates } = await db
    .from("comm_templates")
    .select("*")
    .order("is_builtin", { ascending: false })
    .order("name");

  return NextResponse.json({
    templates: (templates ?? []).map((t) => ({
      ...t,
      variables: extractVariables(t.body),
    })),
  });
}

export async function POST(request: Request) {
  const auth = await requireCommsAdmin();
  if (!auth.ok) return auth.response;

  const body = (await request.json()) as {
    name?: string;
    channel?: "sms" | "whatsapp" | "both";
    body?: string;
    whatsapp_template_code?: string | null;
    header_media_url?: string | null;
  };

  if (!body.name?.trim() || !body.body?.trim()) {
    return NextResponse.json(
      { error: "Template name and message are required" },
      { status: 400 }
    );
  }

  const db = await createAdminClient();
  const { data: template, error } = await db
    .from("comm_templates")
    .insert({
      name: body.name.trim(),
      channel: body.channel ?? "both",
      body: body.body,
      whatsapp_template_code: body.whatsapp_template_code ?? null,
      header_media_url: body.header_media_url ?? null,
      created_by: auth.userId,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ template }, { status: 201 });
}
