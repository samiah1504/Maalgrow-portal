import type { CommsProvider, SendResult, SmsParams, WhatsAppParams } from "./provider";
import { isNigerianNumber } from "./util";

/**
 * Sendchamp implementation of CommsProvider.
 *
 * Credentials come exclusively from server-side environment variables —
 * this module must never be imported from client components:
 *   SENDCHAMP_API_KEY              (required)
 *   SENDCHAMP_SMS_SENDER_ID        (required for SMS; registered sender)
 *   SENDCHAMP_WHATSAPP_SENDER_ID   (required for WhatsApp; approved number)
 *   SENDCHAMP_BASE_URL             (default https://api.sendchamp.com/api/v1)
 *   SENDCHAMP_SMS_ROUTE            (default dnd — deliverable to DND numbers)
 */
export class SendchampProvider implements CommsProvider {
  readonly name = "sendchamp";

  private get baseUrl() {
    return (process.env.SENDCHAMP_BASE_URL ?? "https://api.sendchamp.com/api/v1").replace(/\/+$/, "");
  }

  private get apiKey() {
    return process.env.SENDCHAMP_API_KEY ?? "";
  }

  private async post(path: string, body: unknown): Promise<SendResult> {
    if (!this.apiKey) {
      return {
        success: false,
        response: null,
        error: "SENDCHAMP_API_KEY is not configured",
        retryable: false,
      };
    }
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(body),
        cache: "no-store",
      });

      let json: Record<string, unknown> | null = null;
      try {
        json = (await res.json()) as Record<string, unknown>;
      } catch {
        json = null;
      }

      // Sendchamp responds { status: "success" | ..., code, message, data: {...} }
      const statusField = String(json?.status ?? "");
      const ok = res.ok && (statusField === "success" || statusField === "200");
      const data = (json?.data ?? null) as Record<string, unknown> | null;

      return {
        success: ok,
        providerMessageId:
          (data?.id as string | undefined) ??
          (data?.message_id as string | undefined),
        response: json ?? { http_status: res.status },
        error: ok ? undefined : String(json?.message ?? `HTTP ${res.status}`),
        // Rate limits and server errors are worth retrying; validation
        // errors (bad number, unapproved sender) are not.
        retryable: !ok && (res.status === 429 || res.status >= 500),
      };
    } catch (err) {
      return {
        success: false,
        response: null,
        error: err instanceof Error ? err.message : "Network error",
        retryable: true,
      };
    }
  }

  async sendSms({ to, message }: SmsParams): Promise<SendResult> {
    // Nigerian numbers use the configured route (dnd by default so
    // messages reach DND-enabled lines); anything else goes over
    // Sendchamp's international route.
    const route = isNigerianNumber(to)
      ? process.env.SENDCHAMP_SMS_ROUTE ?? "dnd"
      : "international";
    return this.post("/sms/send", {
      to: [to],
      message,
      sender_name: process.env.SENDCHAMP_SMS_SENDER_ID ?? "MaalGrow",
      route,
    });
  }

  async sendWhatsApp({ to, message, templateCode, headerMediaUrl }: WhatsAppParams): Promise<SendResult> {
    const sender = process.env.SENDCHAMP_WHATSAPP_SENDER_ID ?? "";
    if (!sender) {
      return {
        success: false,
        response: null,
        error: "SENDCHAMP_WHATSAPP_SENDER_ID is not configured",
        retryable: false,
      };
    }

    if (templateCode) {
      return this.post("/whatsapp/message/send", {
        recipient: to,
        sender,
        type: "template",
        template_code: templateCode,
        custom_data: {
          body: { message },
          ...(headerMediaUrl ? { header: { media_url: headerMediaUrl } } : {}),
        },
      });
    }

    return this.post("/whatsapp/message/send", {
      recipient: to,
      sender,
      type: "text",
      message,
    });
  }
}
