/**
 * Channel-agnostic Communication Centre utilities:
 * phone normalisation, template variable resolution, SMS estimation.
 * No provider imports here — safe to unit test standalone.
 */

// ── Phone normalisation ──────────────────────────────────────────────
// Canonical outbound format: 234XXXXXXXXXX (13 digits, no plus).
// The investor's stored phone number is NEVER modified.
/**
 * Normalizes a phone number for sending (stored numbers are never
 * modified). Nigerian formats are converted to 234XXXXXXXXXX; numbers
 * with an explicit international prefix (+, 00) or a recognisable
 * country code are kept in full international format, so investors
 * outside Nigeria are supported.
 */
export function normalizeNigerianPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  const hasIntlPrefix = trimmed.startsWith("+") || trimmed.startsWith("00");
  const digitsAll = trimmed.replace(/\D/g, "");
  const digits = trimmed.startsWith("00") ? digitsAll.replace(/^00/, "") : digitsAll;

  // Explicit international number: +<country code><number> or 00<...>
  if (hasIntlPrefix) {
    if (digits.length >= 10 && digits.length <= 15 && !digits.startsWith("0")) {
      // +234 numbers still get canonical Nigerian handling
      if (digits.startsWith("234") && digits.length === 13) return digits;
      return digits;
    }
    return null;
  }

  // Nigerian local formats
  if (digits.length === 11 && digits.startsWith("0")) {
    return "234" + digits.slice(1);
  }
  if (digits.length === 13 && digits.startsWith("234")) {
    return digits;
  }
  if (digits.length === 10 && /^[789]/.test(digits)) {
    return "234" + digits;
  }

  // Bare international number stored without "+" (e.g. 447911123456,
  // 12025550123): plausible country code + subscriber number.
  if (digits.length >= 11 && digits.length <= 15 && !digits.startsWith("0")) {
    return digits;
  }

  return null;
}

/** True when a normalized number is Nigerian (used for route selection) */
export function isNigerianNumber(normalized: string): boolean {
  return normalized.startsWith("234") && normalized.length === 13;
}

// ── Template variables ───────────────────────────────────────────────

export const TEMPLATE_VARIABLES = [
  "first_name",
  "full_name",
  "registered_email",
  "investor_code",
  "series_name",
  "cycle_name",
  "capital_amount",
  "total_slots",
  "profit_amount",
  "maturity_value",
  "maturity_date",
  "maturity_instruction_deadline",
  "kyc_status",
  "portal_url",
] as const;

export function isValidEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
}

export type TemplateVars = Partial<Record<(typeof TEMPLATE_VARIABLES)[number], string>>;

/**
 * Replaces {{variable}} placeholders. Returns the unresolved variable
 * names — callers MUST skip recipients with unresolved variables; a
 * message with a raw {{placeholder}} is never sent.
 */
export function resolveTemplate(
  body: string,
  vars: TemplateVars
): { text: string; unresolved: string[] } {
  const unresolved = new Set<string>();
  const text = body.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_, name: string) => {
    const key = name.toLowerCase() as keyof TemplateVars;
    const value = vars[key];
    if (value === undefined || value === null || value === "") {
      unresolved.add(name.toLowerCase());
      return `{{${name}}}`;
    }
    return value;
  });
  return { text, unresolved: [...unresolved] };
}

export function extractVariables(body: string): string[] {
  const found = new Set<string>();
  for (const m of body.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/gi)) {
    found.add(m[1].toLowerCase());
  }
  return [...found];
}

// ── SMS unit + cost estimation ───────────────────────────────────────
// GSM-7: 160 chars for a single SMS, 153 per part when concatenated.
// Unicode (any char outside GSM-7): 70 single / 67 per part.

const GSM7 =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?" +
  "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà" +
  "^{}\\[~]|€";

export function smsUnits(message: string): number {
  if (message.length === 0) return 0;
  const isGsm = [...message].every((c) => GSM7.includes(c));
  const single = isGsm ? 160 : 70;
  const perPart = isGsm ? 153 : 67;
  return message.length <= single ? 1 : Math.ceil(message.length / perPart);
}

export function smsCostNgn(units: number, recipients: number): number {
  const perUnit = Number(process.env.COMM_SMS_COST_NGN ?? 4);
  return units * recipients * perUnit;
}

export function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}
