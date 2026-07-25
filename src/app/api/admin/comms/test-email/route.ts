import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { requireCommsAdmin } from "@/lib/comms/server";
import { isValidEmail } from "@/lib/comms/util";
import { sendCampaignEmail } from "@/lib/comms/resend-email";

// POST — sends ONE clearly-marked test email to an authorised address.
// The body/subject arrive already resolved with sample data from the
// composer preview. No campaign or recipient status is touched.
export async function POST(request: Request) {
  const auth = await requireCommsAdmin();
  if (!auth.ok) return auth.response;

  try {
    const body = (await request.json()) as {
      to?: string;
      subject?: string;
      message?: string;
      preview_text?: string | null;
      email_type?: "operational" | "general";
      from_name?: string | null;
      from_email?: string | null;
      reply_to_email?: string | null;
      attachment_path?: string | null;
      attachment_name?: string | null;
    };

    if (!isValidEmail(body.to)) {
      return NextResponse.json({ error: "Enter a valid test email address" }, { status: 400 });
    }
    if (!body.subject?.trim() || !body.message?.trim()) {
      return NextResponse.json({ error: "Subject and message are required" }, { status: 400 });
    }

    let attachment: { filename: string; content: Buffer } | null = null;
    if (body.attachment_path) {
      const db = await createAdminClient();
      const { data: file } = await db.storage
        .from("comm-attachments")
        .download(body.attachment_path);
      if (file) {
        attachment = {
          filename: body.attachment_name ?? "report.pdf",
          content: Buffer.from(await file.arrayBuffer()),
        };
      }
    }

    const result = await sendCampaignEmail({
      to: body.to!.trim(),
      subject: body.subject.trim(),
      bodyText: body.message,
      previewText: body.preview_text,
      emailType: body.email_type === "general" ? "general" : "operational",
      fromName: body.from_name,
      fromEmail: body.from_email,
      replyTo: body.reply_to_email,
      attachment,
      isTest: true,
    });

    if (!result.success) {
      return NextResponse.json(
        { error: result.error ?? "Test email failed" },
        { status: 500 }
      );
    }

    const session = await createClient();
    await session.rpc("create_audit_log", {
      p_action: "comms_test_email_sent",
      p_entity_type: "comm_campaign",
      p_entity_id: null,
      p_old_values: null,
      p_new_values: { to: body.to, subject: body.subject },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[API] POST /admin/comms/test-email error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
