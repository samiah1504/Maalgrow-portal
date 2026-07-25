import { NextResponse } from "next/server";
import crypto from "crypto";
import { createAdminClient } from "@/lib/supabase/server";

// POST /api/webhooks/resend
// Resend delivery webhooks (Svix-signed). Updates campaign recipient
// rows by provider_message_id: delivered / opened / clicked / bounced /
// complained / failed. Events for transactional emails (invitations,
// password resets) simply find no matching row and are acknowledged.
//
// Configure in Resend → Webhooks with endpoint
//   https://maalgrow.maalvest.com/api/webhooks/resend
// and put the signing secret (whsec_…) in RESEND_WEBHOOK_SECRET.

function verifySvix(
  secret: string,
  id: string,
  timestamp: string,
  payload: string,
  signatureHeader: string
): boolean {
  try {
    const secretBytes = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
    const signed = `${id}.${timestamp}.${payload}`;
    const expected = crypto
      .createHmac("sha256", secretBytes)
      .update(signed)
      .digest("base64");
    // Header format: "v1,<base64sig> v1,<base64sig2> …"
    return signatureHeader.split(" ").some((part) => {
      const sig = part.split(",")[1];
      if (!sig) return false;
      const a = Buffer.from(sig);
      const b = Buffer.from(expected);
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    });
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  try {
    const payload = await request.text();
    const secret = process.env.RESEND_WEBHOOK_SECRET;

    if (secret) {
      const id = request.headers.get("svix-id") ?? "";
      const timestamp = request.headers.get("svix-timestamp") ?? "";
      const signature = request.headers.get("svix-signature") ?? "";
      if (!verifySvix(secret, id, timestamp, payload, signature)) {
        return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
      }
      // Reject stale timestamps (replay protection, 5 minutes)
      const ts = parseInt(timestamp, 10);
      if (!ts || Math.abs(Date.now() / 1000 - ts) > 300) {
        return NextResponse.json({ error: "Stale timestamp" }, { status: 401 });
      }
    } else {
      console.warn("[Webhook] RESEND_WEBHOOK_SECRET not set — accepting unverified event");
    }

    const event = JSON.parse(payload) as {
      type?: string;
      data?: { email_id?: string; bounce?: { message?: string } };
    };
    const emailId = event.data?.email_id;
    const type = event.type ?? "";
    if (!emailId || !type.startsWith("email.")) {
      return NextResponse.json({ received: true });
    }

    const db = await createAdminClient();
    const { data: recipient } = await db
      .from("comm_recipients")
      .select("id, campaign_id, delivered_at, opened_at, clicked_at, bounced_at")
      .eq("provider_message_id", emailId)
      .maybeSingle();

    // Not a campaign email (e.g. an invitation) — acknowledge quietly
    if (!recipient) return NextResponse.json({ received: true });

    const now = new Date().toISOString();
    type RecipientUpdate = { delivered_at?: string; opened_at?: string; clicked_at?: string; bounced_at?: string; status?: "failed"; error?: string; bounce_reason?: string };
    const updates: RecipientUpdate = {};
    let counter: string | null = null;

    switch (type) {
      case "email.delivered":
        if (!recipient.delivered_at) {
          updates.delivered_at = now;
          counter = "delivered_count";
        }
        break;
      case "email.opened":
        if (!recipient.opened_at) {
          updates.opened_at = now;
          counter = "opened_count";
        }
        break;
      case "email.clicked":
        if (!recipient.clicked_at) {
          updates.clicked_at = now;
          counter = "clicked_count";
        }
        break;
      case "email.bounced":
        if (!recipient.bounced_at) {
          updates.bounced_at = now;
          updates.status = "failed";
          updates.error = event.data?.bounce?.message ?? "Bounced";
          updates.bounce_reason = event.data?.bounce?.message ?? "Bounced";
          counter = "bounced_count";
        }
        break;
      case "email.complained":
        updates.bounce_reason = "Marked as spam by recipient";
        counter = "complained_count";
        break;
      case "email.failed":
      case "email.delivery_delayed":
        if (type === "email.failed") {
          updates.status = "failed";
          updates.error = "Provider reported delivery failure";
        }
        break;
      default:
        return NextResponse.json({ received: true });
    }

    if (Object.keys(updates).length > 0) {
      await db.from("comm_recipients").update(updates).eq("id", recipient.id);
    }

    if (counter === "complained_count") {
      const { data: c } = await db
        .from("comm_campaigns")
        .select("complained_count")
        .eq("id", recipient.campaign_id)
        .single();
      await db
        .from("comm_campaigns")
        .update({ complained_count: (c?.complained_count ?? 0) + 1 })
        .eq("id", recipient.campaign_id);
    } else if (counter) {
      // Recompute the campaign counter from recipient rows (idempotent)
      const col =
        counter === "delivered_count"
          ? "delivered_at"
          : counter === "opened_count"
          ? "opened_at"
          : counter === "clicked_count"
          ? "clicked_at"
          : "bounced_at";
      const { count } = await db
        .from("comm_recipients")
        .select("id", { count: "exact", head: true })
        .eq("campaign_id", recipient.campaign_id)
        .not(col, "is", null);
      const counterUpdate =
        counter === "delivered_count"
          ? { delivered_count: count ?? 0 }
          : counter === "opened_count"
          ? { opened_count: count ?? 0 }
          : counter === "clicked_count"
          ? { clicked_count: count ?? 0 }
          : { bounced_count: count ?? 0 };
      await db
        .from("comm_campaigns")
        .update(counterUpdate)
        .eq("id", recipient.campaign_id);
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    console.error("[Webhook] resend error:", err);
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}
