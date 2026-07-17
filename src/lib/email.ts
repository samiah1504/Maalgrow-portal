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
  if (status === "full" || status === "Full Payment") return "Fully Paid";
  if (status === "partial" || status === "Partial Payment") return "Partially Paid";
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
