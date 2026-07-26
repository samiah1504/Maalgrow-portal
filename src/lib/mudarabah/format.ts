/**
 * Kobo formatting. Money is integer kobo everywhere in this feature;
 * it becomes naira here, at the edge, and nowhere else.
 */

/** ₦1,234,567 — rounded, for summaries and headline figures */
export function naira(kobo: number, symbol = "₦"): string {
  const sign = kobo < 0 ? "-" : "";
  const whole = Math.round(Math.abs(kobo) / 100);
  return `${sign}${symbol}${whole.toLocaleString("en-NG")}`;
}

/** ₦1,234,567.89 — to the kobo, for ledger fields */
export function nairaExact(kobo: number, symbol = "₦"): string {
  const sign = kobo < 0 ? "-" : "";
  const abs = Math.abs(kobo);
  const whole = Math.floor(abs / 100);
  const part = Math.round(abs - whole * 100);
  return `${sign}${symbol}${whole.toLocaleString("en-NG")}.${String(part).padStart(2, "0")}`;
}

/** Plain digits with separators, no symbol */
export function nairaPlain(kobo: number): string {
  return (Math.round(kobo) / 100).toLocaleString("en-NG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function units(n: number): string {
  return n.toLocaleString("en-NG");
}

export function percent(value: number, dp = 2): string {
  return `${value.toFixed(dp)}%`;
}

/**
 * What the admin types (naira, possibly with separators or a symbol)
 * becomes integer kobo. Returns null for blank so an empty field can
 * stay empty instead of snapping to zero.
 */
export function parseNairaToKobo(input: string): number | null {
  const cleaned = String(input ?? "").replace(/[^0-9.-]/g, "");
  if (cleaned === "" || cleaned === "-" || cleaned === ".") return null;
  const n = parseFloat(cleaned);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

/** Integer kobo back into an editable naira string */
export function koboToInput(kobo: number | null | undefined): string {
  if (kobo === null || kobo === undefined) return "";
  const naira = kobo / 100;
  return Number.isInteger(naira) ? String(naira) : naira.toFixed(2);
}

export function parseCount(input: string): number | null {
  const cleaned = String(input ?? "").replace(/[^0-9-]/g, "");
  if (cleaned === "" || cleaned === "-") return null;
  const n = parseInt(cleaned, 10);
  return Number.isFinite(n) ? n : null;
}
