import { Resend } from "resend";
import { SITE_URL } from "@/lib/site-url";

const FROM_EMAIL =
  process.env.EMAIL_FROM ?? "MaalGrow <noreply@maalgrow.com>";
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL ?? "support@maalgrow.com";

export type OnboardingEmailParams = {
  to: string;
  fullName: string;
  investorCode: string;
  email: string;
  passwordSetupLink: string;
  portalLink: string;
  seriesName: string;
  cycleLabel: string;
  slots: number;
  slotValue: number;
  totalInvestment: number;
  paymentDate?: string;
  cycleStart: string;
  maturityDate: string;
};

function fmtNGN(amount: number): string {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

function fmtDate(dateStr: string): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function buildHtml(p: OnboardingEmailParams): string {
  const rows = [
    ["Series", `Series ${p.seriesName}`],
    ["Cycle", p.cycleLabel],
    [
      "Slots Allocated",
      `${p.slots} ${p.slots === 1 ? "slot" : "slots"} × ${fmtNGN(p.slotValue)}`,
    ],
    ["Total Investment", fmtNGN(p.totalInvestment)],
    ["Cycle Start", fmtDate(p.cycleStart)],
    ["Maturity Date", fmtDate(p.maturityDate)],
  ]
    .filter(([, v]) => v && v !== "Series —" && v !== "—")
    .map(
      ([k, v]) =>
        `<tr><td style="padding:7px 0;color:#6b7280;font-size:14px;">${k}</td>
         <td style="padding:7px 0;font-weight:600;color:#111827;font-size:14px;text-align:right;">${v}</td></tr>`
    )
    .join("");

  // Investors always pay in full before onboarding — no partial
  // payment concept exists on this platform.
  const payRows = [
    ["Amount Paid", fmtNGN(p.totalInvestment), "#059669"],
    ["Payment Status", "Paid in Full", "#059669"],
    ...(p.paymentDate ? [["Payment Date", fmtDate(p.paymentDate), "#111827"]] : []),
  ]
    .map(
      ([k, v, color]) =>
        `<tr><td style="padding:7px 0;color:#6b7280;font-size:14px;">${k}</td>
         <td style="padding:7px 0;font-weight:600;color:${color};font-size:14px;text-align:right;">${v}</td></tr>`
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width,initial-scale=1.0" />
<title>Welcome to MaalGrow</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;">
<tr><td align="center" style="padding:32px 16px;">
<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08);max-width:600px;width:100%;">
  <!-- Header -->
  <tr>
    <td style="background:#1e3a5f;padding:32px;text-align:center;">
      <img src="${SITE_URL}/logo-192.png" width="64" height="64" alt="MaalGrow"
           style="border-radius:14px;margin-bottom:10px;display:inline-block;" />
      <div style="font-size:22px;font-weight:700;color:#fff;letter-spacing:-0.5px;">MaalGrow Portal</div>
      <div style="font-size:13px;color:#8fb0d8;margin-top:4px;">Shariah-Compliant Mudārabah Investment Platform</div>
    </td>
  </tr>
  <!-- Body -->
  <tr>
    <td style="padding:32px;">
      <div style="font-size:18px;font-weight:600;color:#111827;margin-bottom:12px;">
        As-salamu alaykum, ${p.fullName}
      </div>
      <p style="font-size:15px;color:#4b5563;line-height:1.6;margin:0 0 24px;">
        Welcome to MaalGrow. Your investor account has been created and your
        Mudārabah investment allocation is confirmed. Use the button below to
        set your password and access your investor portal.
      </p>

      <!-- Investor code box -->
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f4ff;border:2px dashed #3b82f6;border-radius:8px;margin-bottom:28px;">
        <tr>
          <td style="padding:16px 24px;text-align:center;">
            <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#6b7280;margin-bottom:4px;">Your Investor Code</div>
            <div style="font-size:30px;font-family:'Courier New',monospace;font-weight:700;color:#1e3a5f;letter-spacing:6px;">${p.investorCode}</div>
          </td>
        </tr>
      </table>

      <!-- Account details -->
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#6b7280;margin:0 0 8px;padding-bottom:4px;border-bottom:1px solid #e5e7eb;">Your Account</div>
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;border-bottom:1px solid #f3f4f6;">
        <tr>
          <td style="padding:7px 0;color:#6b7280;font-size:14px;">Name</td>
          <td style="padding:7px 0;font-weight:600;color:#111827;font-size:14px;text-align:right;">${p.fullName}</td>
        </tr>
        <tr>
          <td style="padding:7px 0;color:#6b7280;font-size:14px;">Email</td>
          <td style="padding:7px 0;font-weight:600;color:#111827;font-size:14px;text-align:right;">${p.email}</td>
        </tr>
      </table>

      ${
        rows
          ? `<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#6b7280;margin:0 0 8px;padding-bottom:4px;border-bottom:1px solid #e5e7eb;">Investment Details</div>
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;border-bottom:1px solid #f3f4f6;">${rows}</table>`
          : ""
      }

      ${
        payRows
          ? `<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#6b7280;margin:0 0 8px;padding-bottom:4px;border-bottom:1px solid #e5e7eb;">Payment Summary</div>
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;border-bottom:1px solid #f3f4f6;">${payRows}</table>`
          : ""
      }

      <!-- CTA -->
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
        <tr>
          <td align="center">
            <a href="${p.passwordSetupLink}"
               style="display:inline-block;background:#1e3a5f;color:#fff;text-decoration:none;padding:14px 36px;border-radius:8px;font-weight:700;font-size:15px;letter-spacing:0.3px;">
              Set Up Your Password →
            </a>
          </td>
        </tr>
      </table>
      <p style="font-size:12px;color:#9ca3af;text-align:center;margin:0 0 24px;word-break:break-all;">
        This link expires in 24 hours. If the button doesn't work, copy this URL:<br />
        <span style="color:#3b82f6;">${p.passwordSetupLink}</span>
      </p>

      <p style="font-size:13px;color:#6b7280;line-height:1.6;margin:0;">
        Profit (Mudārabah) will be declared at cycle maturity and is <strong>not guaranteed in advance</strong>.
        This email is a record of your investment allocation only, not a guaranteed-return certificate.<br /><br />
        Questions? Contact us at <a href="mailto:${SUPPORT_EMAIL}" style="color:#3b82f6;">${SUPPORT_EMAIL}</a>
      </p>
    </td>
  </tr>
  <!-- Footer -->
  <tr>
    <td style="background:#f9fafb;padding:24px 32px;border-top:1px solid #e5e7eb;text-align:center;">
      <p style="font-size:12px;color:#9ca3af;margin:4px 0;">MaalGrow · Shariah-Compliant Mudārabah Investments</p>
      <p style="font-size:12px;margin:4px 0;">
        <a href="${p.portalLink}" style="color:#3b82f6;text-decoration:none;">Investor Portal</a>
        &nbsp;·&nbsp;
        <a href="mailto:${SUPPORT_EMAIL}" style="color:#3b82f6;text-decoration:none;">Support</a>
      </p>
      <p style="font-size:11px;color:#d1d5db;margin:4px 0;">Do not reply to this email.</p>
    </td>
  </tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

// ============================================================
// Password reset email
// ============================================================

export type PasswordResetEmailParams = {
  to: string;
  fullName: string;
  resetLink: string;
  portalLink: string;
};

function buildPasswordResetHtml(p: PasswordResetEmailParams): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width,initial-scale=1.0" />
<title>Reset Your MaalGrow Password</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;">
<tr><td align="center" style="padding:32px 16px;">
<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08);max-width:600px;width:100%;">
  <tr>
    <td style="background:#1e3a5f;padding:32px;text-align:center;">
      <img src="${SITE_URL}/logo-192.png" width="64" height="64" alt="MaalGrow"
           style="border-radius:14px;margin-bottom:10px;display:inline-block;" />
      <div style="font-size:22px;font-weight:700;color:#fff;letter-spacing:-0.5px;">MaalGrow Portal</div>
      <div style="font-size:13px;color:#8fb0d8;margin-top:4px;">Shariah-Compliant Mudārabah Investment Platform</div>
    </td>
  </tr>
  <tr>
    <td style="padding:32px;">
      <div style="font-size:18px;font-weight:600;color:#111827;margin-bottom:12px;">
        As-salamu alaykum, ${p.fullName}
      </div>
      <p style="font-size:15px;color:#4b5563;line-height:1.6;margin:0 0 24px;">
        A password reset was requested for your MaalGrow investor account.
        Click the button below to choose a new password.
      </p>
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
        <tr>
          <td align="center">
            <a href="${p.resetLink}"
               style="display:inline-block;background:#1e3a5f;color:#fff;text-decoration:none;padding:14px 36px;border-radius:8px;font-weight:700;font-size:15px;letter-spacing:0.3px;">
              Reset Your Password →
            </a>
          </td>
        </tr>
      </table>
      <p style="font-size:12px;color:#9ca3af;text-align:center;margin:0 0 24px;word-break:break-all;">
        This link expires soon. If the button doesn't work, copy this URL:<br />
        <span style="color:#3b82f6;">${p.resetLink}</span>
      </p>
      <p style="font-size:13px;color:#6b7280;line-height:1.6;margin:0;">
        If you did not request this reset, you can safely ignore this email —
        your password will not change.<br /><br />
        Questions? Contact us at <a href="mailto:${SUPPORT_EMAIL}" style="color:#3b82f6;">${SUPPORT_EMAIL}</a>
      </p>
    </td>
  </tr>
  <tr>
    <td style="background:#f9fafb;padding:24px 32px;border-top:1px solid #e5e7eb;text-align:center;">
      <p style="font-size:12px;color:#9ca3af;margin:4px 0;">MaalGrow · Shariah-Compliant Mudārabah Investments</p>
      <p style="font-size:12px;margin:4px 0;">
        <a href="${p.portalLink}" style="color:#3b82f6;text-decoration:none;">Investor Portal</a>
      </p>
      <p style="font-size:11px;color:#d1d5db;margin:4px 0;">Do not reply to this email.</p>
    </td>
  </tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

export async function sendPasswordResetEmail(
  params: PasswordResetEmailParams
): Promise<{ success: boolean; error?: string }> {
  if (!process.env.RESEND_API_KEY) {
    console.warn("[email] RESEND_API_KEY not set — skipping password reset email");
    return { success: false, error: "RESEND_API_KEY not configured" };
  }

  const resend = new Resend(process.env.RESEND_API_KEY);

  try {
    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: params.to,
      subject: "Reset your MaalGrow Portal password",
      html: buildPasswordResetHtml(params),
    });

    if (error) {
      console.error("[email] Resend password reset error:", error);
      return { success: false, error: error.message };
    }
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown email error";
    console.error("[email] sendPasswordResetEmail error:", message);
    return { success: false, error: message };
  }
}

// ============================================================
// Rollover confirmation email
// ============================================================

export type RolloverEmailParams = {
  to: string;
  fullName: string;
  investorCode: string;
  seriesName: string;
  completedCycleLabel: string;
  completedCycleStart: string;
  completedCycleEnd: string;
  newCycleLabel: string;
  newCycleStart: string;
  newCycleEnd: string;
  decision: "continue" | "exit" | "rollover_all" | "partial_exit";
  slots: number;
  actualProfit: number;
  capitalRolledOver: number;
  profitRolledOver: number;
  withdrawalAmount: number;
  portalLink: string;
};

function decisionHeadline(p: RolloverEmailParams): { subject: string; intro: string } {
  if (p.decision === "exit") {
    return {
      subject: `Your MaalGrow Series ${p.seriesName} withdrawal has been processed`,
      intro:
        "Your withdrawal request for the completed cycle has been processed. Payment requests for your capital and profit are pending approval and will be paid to your registered bank account.",
    };
  }
  return {
    subject: `Your MaalGrow Series ${p.seriesName} investment has been rolled over successfully`,
    intro:
      "Your investment has been rolled over into the next cycle. No action is required — your updated timeline is available in your investor portal.",
  };
}

function buildRolloverHtml(p: RolloverEmailParams): string {
  const { intro } = decisionHeadline(p);

  const rows: [string, string][] = [
    ["Completed cycle", `${p.completedCycleLabel} (${fmtDate(p.completedCycleStart)} – ${fmtDate(p.completedCycleEnd)})`],
    ["Actual profit (completed cycle)", fmtNGN(p.actualProfit)],
  ];

  if (p.decision !== "exit") {
    rows.push(
      ["New active cycle", `${p.newCycleLabel} (${fmtDate(p.newCycleStart)} – ${fmtDate(p.newCycleEnd)})`],
      ["Slots", `${p.slots}`],
      ["Capital rolled over", fmtNGN(p.capitalRolledOver)],
      ["Profit rolled over", fmtNGN(p.profitRolledOver)]
    );
  }
  if (p.withdrawalAmount > 0) {
    rows.push(["Amount being paid to you", fmtNGN(p.withdrawalAmount)]);
  }

  const rowsHtml = rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:7px 0;color:#6b7280;font-size:14px;">${k}</td>
         <td style="padding:7px 0;font-weight:600;color:#111827;font-size:14px;text-align:right;">${v}</td></tr>`
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width,initial-scale=1.0" />
<title>MaalGrow Cycle Rollover</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;">
<tr><td align="center" style="padding:32px 16px;">
<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08);max-width:600px;width:100%;">
  <tr>
    <td style="background:#1e3a5f;padding:32px;text-align:center;">
      <img src="${SITE_URL}/logo-192.png" width="64" height="64" alt="MaalGrow"
           style="border-radius:14px;margin-bottom:10px;display:inline-block;" />
      <div style="font-size:22px;font-weight:700;color:#fff;letter-spacing:-0.5px;">MaalGrow Portal</div>
      <div style="font-size:13px;color:#8fb0d8;margin-top:4px;">Shariah-Compliant Mudārabah Investment Platform</div>
    </td>
  </tr>
  <tr>
    <td style="padding:32px;">
      <div style="font-size:18px;font-weight:600;color:#111827;margin-bottom:12px;">
        As-salamu alaykum, ${p.fullName}
      </div>
      <p style="font-size:15px;color:#4b5563;line-height:1.6;margin:0 0 24px;">${intro}</p>

      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#6b7280;margin:0 0 8px;padding-bottom:4px;border-bottom:1px solid #e5e7eb;">Rollover Summary — ${p.investorCode}</div>
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;border-bottom:1px solid #f3f4f6;">${rowsHtml}</table>

      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
        <tr>
          <td align="center">
            <a href="${p.portalLink}"
               style="display:inline-block;background:#1e3a5f;color:#fff;text-decoration:none;padding:14px 36px;border-radius:8px;font-weight:700;font-size:15px;letter-spacing:0.3px;">
              View Your Investment Timeline →
            </a>
          </td>
        </tr>
      </table>

      <p style="font-size:13px;color:#6b7280;line-height:1.6;margin:0;">
        Profit shown is the actual declared Mudārabah profit for the completed cycle —
        MaalGrow does not offer fixed or guaranteed returns.<br /><br />
        Questions? Contact us at <a href="mailto:${SUPPORT_EMAIL}" style="color:#3b82f6;">${SUPPORT_EMAIL}</a>
      </p>
    </td>
  </tr>
  <tr>
    <td style="background:#f9fafb;padding:24px 32px;border-top:1px solid #e5e7eb;text-align:center;">
      <p style="font-size:12px;color:#9ca3af;margin:4px 0;">MaalGrow · Shariah-Compliant Mudārabah Investments</p>
      <p style="font-size:11px;color:#d1d5db;margin:4px 0;">Do not reply to this email.</p>
    </td>
  </tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

export async function sendRolloverEmail(
  params: RolloverEmailParams
): Promise<{ success: boolean; error?: string }> {
  if (!process.env.RESEND_API_KEY) {
    console.warn("[email] RESEND_API_KEY not set — skipping rollover email");
    return { success: false, error: "RESEND_API_KEY not configured" };
  }

  const resend = new Resend(process.env.RESEND_API_KEY);

  try {
    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: params.to,
      subject: decisionHeadline(params).subject,
      html: buildRolloverHtml(params),
    });

    if (error) {
      console.error("[email] Resend rollover error:", error);
      return { success: false, error: error.message };
    }
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown email error";
    console.error("[email] sendRolloverEmail error:", message);
    return { success: false, error: message };
  }
}

export async function sendOnboardingEmail(
  params: OnboardingEmailParams
): Promise<{ success: boolean; error?: string }> {
  if (!process.env.RESEND_API_KEY) {
    console.warn("[email] RESEND_API_KEY not set — skipping onboarding email");
    return { success: false, error: "RESEND_API_KEY not configured" };
  }

  const resend = new Resend(process.env.RESEND_API_KEY);

  try {
    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: params.to,
      subject: `Welcome to MaalGrow — Your Investor Code is ${params.investorCode}`,
      html: buildHtml(params),
    });

    if (error) {
      console.error("[email] Resend error:", error);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unknown email error";
    console.error("[email] sendOnboardingEmail error:", message);
    return { success: false, error: message };
  }
}

// ============================================================
// Staff invitation
//
// A staff member is not an investor: there is no portfolio to
// summarise and no slot value to quote. What they need is who they
// are, what they can do, and a link to set their own password.
//
// The password is NEVER in this email — only a link they redeem
// themselves, exactly as the investor invitation works.
// ============================================================

export type StaffInviteEmailParams = {
  to: string;
  fullName: string;
  roleLabel: string;
  /** One line on what this role can reach. Sets expectations before
      they log in and find one menu item. */
  roleSummary: string;
  passwordSetupLink: string;
  portalLink: string;
  invitedBy?: string;
};

function buildStaffInviteHtml(p: StaffInviteEmailParams): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width,initial-scale=1.0" />
<title>Your MaalGrow Portal Account</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;">
<tr><td align="center" style="padding:32px 16px;">
<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08);max-width:600px;width:100%;">
  <tr>
    <td style="background:#1e3a5f;padding:32px;text-align:center;">
      <img src="${SITE_URL}/logo-192.png" width="64" height="64" alt="MaalGrow"
           style="border-radius:14px;margin-bottom:10px;display:inline-block;" />
      <div style="font-size:22px;font-weight:700;color:#fff;letter-spacing:-0.5px;">MaalGrow Portal</div>
      <div style="font-size:13px;color:#8fb0d8;margin-top:4px;">Staff Access</div>
    </td>
  </tr>
  <tr>
    <td style="padding:32px;">
      <div style="font-size:18px;font-weight:600;color:#111827;margin-bottom:12px;">
        As-salamu alaykum, ${p.fullName}
      </div>
      <p style="font-size:15px;color:#4b5563;line-height:1.6;margin:0 0 20px;">
        An account has been created for you on the MaalGrow Portal${
          p.invitedBy ? ` by ${p.invitedBy}` : ""
        }. Set your password below and you can sign in straight away.
      </p>

      <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;">
        <tr><td style="padding:16px 18px;">
          <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.6px;color:#9ca3af;margin-bottom:4px;">Your role</div>
          <div style="font-size:16px;font-weight:700;color:#111827;">${p.roleLabel}</div>
          <div style="font-size:13px;color:#6b7280;line-height:1.6;margin-top:6px;">${p.roleSummary}</div>
          <div style="font-size:12px;color:#9ca3af;margin-top:12px;">Sign in with: <span style="color:#374151;font-weight:600;">${p.to}</span></div>
        </td></tr>
      </table>

      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
        <tr>
          <td align="center">
            <a href="${p.passwordSetupLink}"
               style="display:inline-block;background:#1e3a5f;color:#fff;text-decoration:none;padding:14px 36px;border-radius:8px;font-weight:700;font-size:15px;letter-spacing:0.3px;">
              Set Your Password →
            </a>
          </td>
        </tr>
      </table>
      <p style="font-size:12px;color:#9ca3af;text-align:center;margin:0 0 24px;word-break:break-all;">
        If the button doesn't work, copy this URL:<br />
        <span style="color:#3b82f6;">${p.passwordSetupLink}</span>
      </p>

      <p style="font-size:13px;color:#6b7280;line-height:1.6;margin:0;">
        Nobody at MaalGrow will ever ask you for your password. If you did not
        expect this email, please tell us at
        <a href="mailto:${SUPPORT_EMAIL}" style="color:#3b82f6;">${SUPPORT_EMAIL}</a>
        rather than clicking the link.
      </p>
    </td>
  </tr>
  <tr>
    <td style="background:#f9fafb;padding:24px 32px;border-top:1px solid #e5e7eb;text-align:center;">
      <p style="font-size:12px;color:#9ca3af;margin:4px 0;">MaalGrow · Shariah-Compliant Mudārabah Investments</p>
      <p style="font-size:12px;margin:4px 0;">
        <a href="${p.portalLink}" style="color:#3b82f6;text-decoration:none;">Portal</a>
      </p>
      <p style="font-size:11px;color:#d1d5db;margin:4px 0;">Do not reply to this email.</p>
    </td>
  </tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

export async function sendStaffInviteEmail(
  params: StaffInviteEmailParams
): Promise<{ success: boolean; error?: string }> {
  if (!process.env.RESEND_API_KEY) {
    console.warn("[email] RESEND_API_KEY not set — skipping staff invite email");
    return { success: false, error: "RESEND_API_KEY not configured" };
  }

  const resend = new Resend(process.env.RESEND_API_KEY);

  try {
    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: params.to,
      subject: `Your MaalGrow Portal account — ${params.roleLabel}`,
      html: buildStaffInviteHtml(params),
    });

    if (error) {
      console.error("[email] Resend staff invite error:", error);
      return { success: false, error: error.message };
    }
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown email error";
    console.error("[email] sendStaffInviteEmail error:", message);
    return { success: false, error: message };
  }
}

// ============================================================
// Cycle-end statement
//
// THE ONE EMAIL THAT ASKS FOR A DECISION. Settling pays the profit and
// leaves the capital question open, and since migration 036 an
// instruction is final the moment it is given. So this is not merely a
// notification with a document attached — for most investors it is the
// thing that prompts the only irreversible choice they make all cycle.
//
// It therefore has to do three jobs in an order the reader can follow:
//
//   1. tell them their profit is paid, and how much
//   2. tell them the capital question is open and by when
//   3. say plainly that the answer cannot be changed afterwards
//
// The figure quoted is the NET — what reaches their account. Quoting
// the gross would be a larger, friendlier number that does not match
// the transfer, and would generate a phone call from every reader.
// ============================================================

export type StatementEmailParams = {
  to: string;
  fullName: string;
  investorCode: string;
  seriesName: string;
  cycleLabel: string;
  slots: number;
  /** Net of withholding tax — the amount that reaches their bank */
  netProfit: number;
  capital: number;
  /** Last day an instruction can be given, already formatted */
  instructionDeadline: string | null;
  /** True once they have answered — the email then confirms rather than asks */
  decisionMade: boolean;
  decisionLabel: string | null;
  portalLink: string;
};

/**
 * Exported so the copy can be tested. It is the one email that asks
 * for an irreversible decision, and the words are the risky part —
 * far more than the plumbing around them.
 */
export function buildStatementHtml(p: StatementEmailParams): string {
  const slotText = `${p.slots} slot${p.slots === 1 ? "" : "s"}`;

  // Answered or not answered are genuinely different emails. Sending
  // the same "please decide" paragraph to somebody who decided last
  // week reads as though the portal lost their instruction.
  const capitalBlock = p.decisionMade
    ? `<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;">
        <tr><td style="padding:16px 18px;">
          <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.6px;color:#15803d;margin-bottom:4px;">Your instruction</div>
          <div style="font-size:15px;font-weight:600;color:#14532d;">${p.decisionLabel ?? "Recorded"}</div>
          <div style="font-size:13px;color:#166534;line-height:1.6;margin-top:6px;">
            This is on record and does not need anything further from you.
          </div>
        </td></tr>
      </table>`
    : `<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;">
        <tr><td style="padding:16px 18px;">
          <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.6px;color:#a16207;margin-bottom:4px;">One decision to make</div>
          <div style="font-size:15px;font-weight:600;color:#78350f;">
            Would you like your capital returned, or to continue into the next cycle?
          </div>
          <div style="font-size:13px;color:#854d0e;line-height:1.65;margin-top:8px;">
            Your profit is paid either way — this is only about your
            ${fmtNGN(p.capital)} capital.${
              p.instructionDeadline
                ? ` Please answer by <strong>${p.instructionDeadline}</strong>.`
                : ""
            }
            <br /><br />
            <strong>Your answer is final once submitted</strong>, so please be sure
            before you send it. If you do not answer, your capital continues into
            the next cycle.
          </div>
        </td></tr>
      </table>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width,initial-scale=1.0" />
<title>Your ${p.cycleLabel} statement</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;">
<tr><td align="center" style="padding:32px 16px;">
<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08);max-width:600px;width:100%;">
  <tr>
    <td style="background:#1e3a5f;padding:32px;text-align:center;">
      <img src="${SITE_URL}/logo-192.png" width="64" height="64" alt="MaalGrow"
           style="border-radius:14px;margin-bottom:10px;display:inline-block;" />
      <div style="font-size:22px;font-weight:700;color:#fff;letter-spacing:-0.5px;">MaalGrow Portal</div>
      <div style="font-size:13px;color:#8fb0d8;margin-top:4px;">Series ${p.seriesName} · ${p.cycleLabel}</div>
    </td>
  </tr>
  <tr>
    <td style="padding:32px;">
      <div style="font-size:18px;font-weight:600;color:#111827;margin-bottom:12px;">
        As-salāmu ʿalaykum, ${p.fullName}
      </div>
      <p style="font-size:15px;color:#4b5563;line-height:1.6;margin:0 0 22px;">
        Your ${p.cycleLabel} cycle has completed and the profit has been declared.
        Your full statement is attached to this email.
      </p>

      <!-- The number they are looking for, before anything else. -->
      <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;">
        <tr><td style="padding:18px;text-align:center;">
          <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.7px;color:#9ca3af;">Your profit for this cycle</div>
          <div style="font-size:30px;font-weight:700;color:#1e3a5f;line-height:1.2;margin:4px 0 2px;">${fmtNGN(p.netProfit)}</div>
          <div style="font-size:12px;color:#6b7280;">
            after withholding tax · on ${slotText} · ${fmtNGN(p.capital)} capital
          </div>
        </td></tr>
      </table>

      ${capitalBlock}

      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:18px;">
        <tr><td align="center">
          <a href="${p.portalLink}/investments"
             style="display:inline-block;background:#1e3a5f;color:#fff;text-decoration:none;padding:14px 36px;border-radius:8px;font-weight:700;font-size:15px;letter-spacing:0.3px;">
            ${p.decisionMade ? "View Your Investment →" : "Choose What Happens to Your Capital →"}
          </a>
        </td></tr>
      </table>

      <p style="font-size:13px;color:#6b7280;line-height:1.65;margin:0;">
        The attached statement shows how the whole Series traded over the three
        months, and your own share of it. Your investor code is
        <strong style="color:#374151;">${p.investorCode}</strong>.
        <br /><br />
        If anything here does not look right, reply to your Investment Manager
        in the portal or contact us at
        <a href="mailto:${SUPPORT_EMAIL}" style="color:#3b82f6;">${SUPPORT_EMAIL}</a>.
      </p>
    </td>
  </tr>
  <tr>
    <td style="background:#f9fafb;padding:24px 32px;border-top:1px solid #e5e7eb;text-align:center;">
      <p style="font-size:12px;color:#9ca3af;margin:4px 0;">MaalGrow · Shariah-Compliant Mudārabah Investments</p>
      <p style="font-size:12px;margin:4px 0;">
        <a href="${p.portalLink}" style="color:#3b82f6;text-decoration:none;">Investor Portal</a>
      </p>
      <p style="font-size:11px;color:#d1d5db;margin:4px 0;">Do not reply to this email.</p>
    </td>
  </tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

export async function sendStatementEmail(
  params: StatementEmailParams,
  attachment: { filename: string; content: Buffer }
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  if (!process.env.RESEND_API_KEY) {
    console.warn("[email] RESEND_API_KEY not set — skipping statement email");
    return { success: false, error: "RESEND_API_KEY not configured" };
  }

  const resend = new Resend(process.env.RESEND_API_KEY);

  try {
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: params.to,
      subject: `Your ${params.cycleLabel} statement — profit of ${fmtNGN(params.netProfit)}`,
      html: buildStatementHtml(params),
      attachments: [
        {
          filename: attachment.filename,
          content: attachment.content.toString("base64"),
        },
      ],
    });

    if (error) {
      console.error("[email] Resend statement error:", error);
      return { success: false, error: error.message };
    }
    return { success: true, messageId: data?.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown email error";
    console.error("[email] sendStatementEmail error:", message);
    return { success: false, error: message };
  }
}

/* ── Chasing an investor whose money is waiting ─────────────── */

export type PaymentReminderParams = {
  to: string;
  fullName: string;
  investorCode: string;
  seriesName: string;
  cycleLabel: string;
  /** naira */
  profitAvailable: number;
  capital: number;
  /** Why nothing has been raised. Decides what we actually ask for. */
  reason: "no_instruction" | "no_bank_details" | "not_raised";
  /** Already formatted, e.g. "4 August 2026". Null when it has passed. */
  deadline: string | null;
  portalLink: string;
};

/**
 * Exported so the words can be tested.
 *
 * THE TRAP THIS AVOIDS. The obvious wording — "you have not submitted
 * a payment request, please log in and submit one" — describes a
 * button that does not exist. Investors here never raise their own
 * requests; the request appears on its own the moment they answer the
 * maturity question. Sending that sentence would have thirty-eight
 * people hunting a screen that was never built, and the ones who
 * gave up would conclude the portal was broken.
 *
 * So each reason asks for the thing that ACTUALLY unblocks it:
 *
 *   no_instruction   answer the maturity question
 *   no_bank_details  add your bank account
 *   not_raised       nothing for them to do — we are on it
 */
export function buildPaymentReminderHtml(p: PaymentReminderParams): string {
  const ask =
    p.reason === "no_bank_details"
      ? {
          heading: "We need your bank account details",
          body: `Your profit of <strong>${fmtNGN(p.profitAvailable)}</strong> is ready,
                 but there is no bank account on your record for us to pay it into.
                 Add it in the portal and the payment will be raised straight away.`,
          cta: "Add Your Bank Details →",
          href: `${p.portalLink}/kyc`,
        }
      : p.reason === "no_instruction"
      ? {
          heading: "One answer is all we need",
          body: `Your profit of <strong>${fmtNGN(p.profitAvailable)}</strong> is ready.
                 Before we can pay it we need to know what you would like done with
                 your ${fmtNGN(p.capital)} capital — returned to you, or continued
                 into the next cycle. Your profit is paid either way.${
                   p.deadline
                     ? ` Please answer by <strong>${p.deadline}</strong>.`
                     : ""
                 }`,
          cta: "Choose What Happens to Your Capital →",
          href: `${p.portalLink}/investments`,
        }
      : {
          heading: "Your payment is being prepared",
          body: `Your profit of <strong>${fmtNGN(p.profitAvailable)}</strong> is ready
                 and we are arranging the transfer. There is nothing you need to do —
                 this note is so you know where it has got to.`,
          cta: "View Your Investment →",
          href: `${p.portalLink}/investments`,
        };

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width,initial-scale=1.0" />
<title>Your ${p.cycleLabel} profit is waiting</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;">
<tr><td align="center" style="padding:32px 16px;">
<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08);max-width:600px;width:100%;">
  <tr>
    <td style="background:#1e3a5f;padding:32px;text-align:center;">
      <img src="${SITE_URL}/logo-192.png" width="64" height="64" alt="MaalGrow"
           style="border-radius:14px;margin-bottom:10px;display:inline-block;" />
      <div style="font-size:22px;font-weight:700;color:#fff;letter-spacing:-0.5px;">MaalGrow Portal</div>
      <div style="font-size:13px;color:#8fb0d8;margin-top:4px;">Series ${p.seriesName} · ${p.cycleLabel}</div>
    </td>
  </tr>
  <tr>
    <td style="padding:32px;">
      <div style="font-size:18px;font-weight:600;color:#111827;margin-bottom:12px;">
        As-salāmu ʿalaykum, ${p.fullName}
      </div>

      <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;">
        <tr><td style="padding:18px;text-align:center;">
          <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.7px;color:#9ca3af;">Profit waiting for you</div>
          <div style="font-size:30px;font-weight:700;color:#1e3a5f;line-height:1.2;margin:4px 0 2px;">${fmtNGN(p.profitAvailable)}</div>
          <div style="font-size:12px;color:#6b7280;">after withholding tax</div>
        </td></tr>
      </table>

      <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;">
        <tr><td style="padding:16px 18px;">
          <div style="font-size:15px;font-weight:600;color:#78350f;">${ask.heading}</div>
          <div style="font-size:13px;color:#854d0e;line-height:1.65;margin-top:8px;">${ask.body}</div>
        </td></tr>
      </table>

      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:18px;">
        <tr><td align="center">
          <a href="${ask.href}"
             style="display:inline-block;background:#1e3a5f;color:#fff;text-decoration:none;padding:14px 36px;border-radius:8px;font-weight:700;font-size:15px;letter-spacing:0.3px;">
            ${ask.cta}
          </a>
        </td></tr>
      </table>

      <p style="font-size:13px;color:#6b7280;line-height:1.65;margin:0;">
        Your investor code is <strong style="color:#374151;">${p.investorCode}</strong>.
        <br /><br />
        If you are having trouble signing in, or you would rather tell us by phone
        or WhatsApp, reply to your Investment Manager in the portal or contact us at
        <a href="mailto:${SUPPORT_EMAIL}" style="color:#3b82f6;">${SUPPORT_EMAIL}</a>
        and we will record it for you.
      </p>
    </td>
  </tr>
  <tr>
    <td style="background:#f9fafb;padding:24px 32px;border-top:1px solid #e5e7eb;text-align:center;">
      <p style="font-size:12px;color:#9ca3af;margin:4px 0;">MaalGrow · Shariah-Compliant Mudārabah Investments</p>
      <p style="font-size:12px;margin:4px 0;">
        <a href="${p.portalLink}" style="color:#3b82f6;text-decoration:none;">Investor Portal</a>
      </p>
    </td>
  </tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

export async function sendPaymentReminderEmail(
  p: PaymentReminderParams
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  if (!process.env.RESEND_API_KEY) {
    console.warn("[email] RESEND_API_KEY not set — skipping payment reminder");
    return { success: false, error: "RESEND_API_KEY not configured" };
  }
  const resend = new Resend(process.env.RESEND_API_KEY);
  try {
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: p.to,
      subject:
        p.reason === "no_bank_details"
          ? `Your ${fmtNGN(p.profitAvailable)} profit is ready — we need your bank details`
          : `Your ${fmtNGN(p.profitAvailable)} profit is waiting — one answer needed`,
      html: buildPaymentReminderHtml(p),
    });
    if (error) {
      console.error("[email] Resend reminder error:", error);
      return { success: false, error: error.message };
    }
    return { success: true, messageId: data?.id };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}
