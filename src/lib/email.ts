import { Resend } from "resend";

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
  totalPaid: number;
  outstandingBalance: number;
  paymentStatus: string;
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

function payStatusLabel(status: string): string {
  const s = status.toLowerCase();
  if (s === "full" || s === "full payment" || s === "fully paid") return "Fully Paid";
  if (s === "partial" || s === "partial payment" || s === "part paid") return "Partially Paid";
  if (s === "overpaid") return "Overpaid";
  return "Payment Pending";
}

function buildHtml(p: OnboardingEmailParams): string {
  const outstanding = p.outstandingBalance;
  const outstandingColor = outstanding > 0 ? "#d97706" : "#059669";

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

  const payRows = [
    ["Total Paid", fmtNGN(p.totalPaid), "#059669"],
    ["Outstanding Balance", fmtNGN(outstanding), outstandingColor],
    ["Payment Status", payStatusLabel(p.paymentStatus), "#111827"],
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
  decision: "continue" | "exit" | "rollover_all";
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
