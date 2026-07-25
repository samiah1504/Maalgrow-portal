import { Resend } from "resend";
import { SITE_URL } from "@/lib/site-url";

/**
 * Campaign email sending via the EXISTING Resend integration.
 * Server-side only — never imported from client components.
 * Transactional emails (onboarding, password reset) in
 * src/lib/email.ts are untouched.
 */

export type CampaignEmailResult = {
  success: boolean;
  providerMessageId?: string;
  response: unknown;
  error?: string;
  retryable: boolean;
};

export function defaultFromParts(): { name: string; email: string } {
  // EMAIL_FROM is e.g. 'MaalGrow <noreply@maalvest.com>'
  const raw = process.env.RESEND_FROM_EMAIL ?? process.env.EMAIL_FROM ?? "";
  const m = raw.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1] || "MaalGrow", email: m[2] };
  return {
    name: process.env.RESEND_FROM_NAME ?? "MaalGrow Investor Relations",
    email: raw || "noreply@maalvest.com",
  };
}

export function defaultReplyTo(): string {
  return (
    process.env.RESEND_REPLY_TO_EMAIL ??
    process.env.SUPPORT_EMAIL ??
    "support@maalvest.com"
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Branded wrapper matching the existing MaalGrow email look */
export function buildCampaignHtml(p: {
  bodyText: string;
  previewText?: string | null;
  emailType: "operational" | "general";
  isTest?: boolean;
}): string {
  const paragraphs = p.bodyText
    .split(/\n{2,}/)
    .map(
      (para) =>
        `<p style="margin:0 0 14px;color:#374151;font-size:14px;line-height:1.7;">${escapeHtml(
          para
        ).replace(/\n/g, "<br/>")}</p>`
    )
    .join("");

  const footerNote =
    p.emailType === "general"
      ? "You are receiving this email because you are a registered MaalGrow investor. To change how we contact you, reply to this email or contact Investor Support."
      : "You are receiving this email because it concerns your MaalGrow investment account.";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width,initial-scale=1.0" />
${p.previewText ? `<span style="display:none;max-height:0;overflow:hidden;">${escapeHtml(p.previewText)}</span>` : ""}
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;">
<tr><td align="center" style="padding:32px 16px;">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08);">
<tr><td style="background:#2e1065;padding:28px 32px;text-align:center;">
  <img src="${SITE_URL}/logo-192.png" width="56" height="56" alt="MaalGrow" style="border-radius:12px;display:inline-block;" />
  <p style="margin:10px 0 0;color:#ffffff;font-size:18px;font-weight:700;">MaalGrow</p>
  <p style="margin:2px 0 0;color:#c4b5fd;font-size:11px;">A MAALVEST INVESTMENT PLATFORM</p>
</td></tr>
${
  p.isTest
    ? `<tr><td style="background:#fef3c7;padding:10px 32px;text-align:center;">
  <p style="margin:0;color:#92400e;font-size:12px;font-weight:700;">THIS IS A TEST EMAIL. No investor campaign status will be updated.</p>
</td></tr>`
    : ""
}
<tr><td style="padding:28px 32px;">
${paragraphs}
</td></tr>
<tr><td style="padding:18px 32px;background:#f9fafb;border-top:1px solid #e5e7eb;">
  <p style="margin:0;color:#9ca3af;font-size:11px;line-height:1.6;">${footerNote}</p>
  <p style="margin:6px 0 0;color:#9ca3af;font-size:11px;">MaalVest Investment Limited · <a href="${SITE_URL}" style="color:#7c3aed;text-decoration:none;">${SITE_URL.replace("https://", "")}</a></p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

export async function sendCampaignEmail(p: {
  to: string;
  subject: string;
  bodyText: string;
  previewText?: string | null;
  emailType: "operational" | "general";
  fromName?: string | null;
  fromEmail?: string | null;
  replyTo?: string | null;
  attachment?: { filename: string; content: Buffer } | null;
  isTest?: boolean;
}): Promise<CampaignEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return {
      success: false,
      response: null,
      error: "RESEND_API_KEY is not configured",
      retryable: false,
    };
  }

  const def = defaultFromParts();
  const fromName = p.fromName?.trim() || def.name;
  const fromEmail = p.fromEmail?.trim() || def.email;
  const replyTo = p.replyTo?.trim() || defaultReplyTo();

  try {
    const resend = new Resend(apiKey);
    const { data, error } = await resend.emails.send({
      from: `${fromName} <${fromEmail}>`,
      to: p.to,
      replyTo,
      subject: p.isTest ? `[TEST] ${p.subject}` : p.subject,
      html: buildCampaignHtml({
        bodyText: p.bodyText,
        previewText: p.previewText,
        emailType: p.emailType,
        isTest: p.isTest,
      }),
      text: p.bodyText,
      ...(p.attachment
        ? {
            attachments: [
              {
                filename: p.attachment.filename,
                content: p.attachment.content.toString("base64"),
              },
            ],
          }
        : {}),
    });

    if (error) {
      const msg = error.message ?? String(error);
      return {
        success: false,
        response: { error: msg },
        error: msg,
        // rate limits are retryable; validation errors are not
        retryable: /rate|too many|429|5\d\d/i.test(msg),
      };
    }
    return {
      success: true,
      providerMessageId: data?.id,
      response: { id: data?.id },
      retryable: false,
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
