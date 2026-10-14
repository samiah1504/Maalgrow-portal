/**
 * MaalRise emails. Server only.
 *
 * Sent through the same service and sender address as MaalGrow
 * (Resend, EMAIL_FROM), and only ever because a person pressed Send:
 * an outbox draft, or "Send invitation" on an investor's page.
 */
import { Resend } from "resend";
import { SITE_URL } from "@/lib/site-url";

const FROM_EMAIL = process.env.EMAIL_FROM ?? "MaalGrow <noreply@maalgrow.com>";
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL ?? "support@maalgrow.com";

export type SendResult = { success: true; providerId: string | null } | { success: false; error: string };

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** The MaalRise frame around a message: header, body, footer. */
export function maalriseEmailHtml(title: string, inner: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width,initial-scale=1.0" /><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;">
<tr><td align="center" style="padding:32px 16px;">
<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08);max-width:600px;width:100%;">
  <tr>
    <td style="background:#3B1D6B;padding:28px;text-align:center;">
      <img src="${SITE_URL}/logo-192.png" width="56" height="56" alt="MaalVest" style="border-radius:12px;margin-bottom:8px;display:inline-block;" />
      <div style="font-size:21px;font-weight:700;color:#fff;">MaalRise</div>
      <div style="font-size:12px;color:#d8c8f0;margin-top:3px;">A MaalVest platform · Murabaha</div>
    </td>
  </tr>
  <tr><td style="padding:28px 32px;font-size:15px;color:#374151;line-height:1.6;">${inner}</td></tr>
  <tr>
    <td style="padding:18px 32px;background:#fafafa;border-top:1px solid #eee;font-size:12px;color:#6b7280;">
      Questions? Reply to this email or write to <a href="mailto:${SUPPORT_EMAIL}" style="color:#3B1D6B;">${SUPPORT_EMAIL}</a>.
    </td>
  </tr>
</table>
</td></tr></table>
</body></html>`;
}

/** An outbox message: plain text written by the database, shown as paragraphs. */
export function outboxHtml(subject: string, body: string): string {
  const paras = body.split(/\n{2,}/).map((p) => `<p style="margin:0 0 14px;">${esc(p).replace(/\n/g, "<br />")}</p>`).join("");
  return maalriseEmailHtml(subject, `${paras}<p style="margin:18px 0 0;"><a href="${SITE_URL}/maalrise" style="color:#3B1D6B;font-weight:600;">Open MaalRise</a></p>`);
}

async function send(to: string, subject: string, html: string): Promise<SendResult> {
  if (!process.env.RESEND_API_KEY) return { success: false, error: "RESEND_API_KEY not configured" };
  try {
    const { data, error } = await new Resend(process.env.RESEND_API_KEY).emails.send({ from: FROM_EMAIL, to, subject, html });
    if (error) return { success: false, error: error.message };
    return { success: true, providerId: data?.id ?? null };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Unknown email error" };
  }
}

export function sendOutboxEmail(to: string, subject: string, body: string): Promise<SendResult> {
  return send(to, subject, outboxHtml(subject, body));
}

export type MaalriseInvitationParams = {
  to: string;
  fullName: string;
  investorCode: string;
  passwordSetupLink: string;
};

export function maalriseInvitationHtml(p: MaalriseInvitationParams): string {
  const step = (n: number, t: string) =>
    `<tr><td style="padding:6px 10px 6px 0;vertical-align:top;font-weight:700;color:#3B1D6B;">${n}.</td><td style="padding:6px 0;">${t}</td></tr>`;
  return maalriseEmailHtml(
    "Welcome to MaalRise",
    `<div style="font-size:18px;font-weight:600;color:#111827;margin-bottom:12px;">As-salamu alaykum, ${esc(p.fullName)}</div>
     <p style="margin:0 0 18px;">Your MaalRise investor account has been created. Your investor code is
       <strong style="font-family:'Courier New',monospace;letter-spacing:2px;">${esc(p.investorCode)}</strong>.</p>
     <table cellpadding="0" cellspacing="0" style="margin:0 0 22px;font-size:15px;">
       ${step(1, "Set your password with the button below (the link works for 24 hours).")}
       ${step(2, "Complete the KYC form when you first sign in — we review it before your account is fully active.")}
       ${step(3, "See your Cycles, expected profit and every payment made to you in the portal.")}
     </table>
     <p style="text-align:center;margin:0 0 22px;">
       <a href="${p.passwordSetupLink}" style="background:#3B1D6B;color:#fff;text-decoration:none;padding:12px 26px;border-radius:8px;font-weight:600;display:inline-block;">Set your password</a>
     </p>
     <p style="margin:0;font-size:13px;color:#6b7280;">If the button has expired, ask us for a new invitation. Sign in later at
       <a href="${SITE_URL}" style="color:#3B1D6B;">${SITE_URL.replace(/^https?:\/\//, "")}</a>.</p>`
  );
}

export function sendMaalriseInvitation(p: MaalriseInvitationParams): Promise<SendResult> {
  return send(p.to, `Welcome to MaalRise — your investor code is ${p.investorCode}`, maalriseInvitationHtml(p));
}

/**
 * A Cycle invitation (migration 057): the prepared message, then the
 * "Set your password" button for someone who has never signed in.
 */
export function cycleInvitationHtml(subject: string, body: string, passwordSetupLink: string): string {
  const paras = body.split(/\n{2,}/).map((p) => `<p style="margin:0 0 14px;">${esc(p).replace(/\n/g, "<br />")}</p>`).join("");
  return maalriseEmailHtml(
    subject,
    `${paras}
     <p style="text-align:center;margin:8px 0 22px;">
       <a href="${passwordSetupLink}" style="background:#3B1D6B;color:#fff;text-decoration:none;padding:12px 26px;border-radius:8px;font-weight:600;display:inline-block;">Set your password</a>
     </p>
     <p style="margin:0;font-size:13px;color:#6b7280;">The button works for 24 hours. If it has expired, ask us for a new invitation. Sign in later at
       <a href="${SITE_URL}" style="color:#3B1D6B;">${SITE_URL.replace(/^https?:\/\//, "")}</a>.</p>`
  );
}

export function sendCycleInvitation(to: string, subject: string, body: string, passwordSetupLink: string): Promise<SendResult> {
  return send(to, subject, cycleInvitationHtml(subject, body, passwordSetupLink));
}
