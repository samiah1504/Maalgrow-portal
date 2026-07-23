/**
 * Channel-agnostic Communication Centre utilities:
 * phone normalisation, template variable resolution, SMS estimation.
 * No provider imports here — safe to unit test standalone.
 */

// ── Phone normalisation ──────────────────────────────────────────────
// Canonical outbound format: 234XXXXXXXXXX (13 digits, no plus).
// The investor's stored phone number is NEVER modified.
export function normalizeNigerianPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/[\s()+-]/g, "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("0")) {
    return "234" + digits.slice(1);
  }
  if (digits.length === 13 && digits.startsWith("234")) {
    return digits;
  }
  if (digits.length === 10 && /^[789]/.test(digits)) {
    return "234" + digits;
  }
  return null;
}

// ── Template variables ───────────────────────────────────────────────

export const TEMPLATE_VARIABLES = [
  "first_name",
  "full_name",
  "registered_email",
  "investor_code",
  "series_name",
  "maturity_date",
  "total_slots",
  "portal_url",
] as const;

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
