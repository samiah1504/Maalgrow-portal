// Fixed slot value — ₦500,000 per slot, constant across all series and cycles
export const SLOT_VALUE_NGN = 500_000;

// Validate that units is a valid slot quantity (≥ 0.5, multiples of 0.5).
// value * 2 must itself be an integer — do NOT round first, or every
// number passes (halves are exact in IEEE-754, so this test is precise).
export function isValidSlots(value: number): boolean {
  if (!isFinite(value) || isNaN(value)) return false;
  if (value < 0.5) return false;
  return Number.isInteger(value * 2);
}

// Calculate investment capital in kobo first, then convert to naira
// to avoid IEEE-754 floating-point accumulation errors.
export function calcCapital(slots: number): number {
  return Math.round(slots * SLOT_VALUE_NGN * 100) / 100;
}

// Payment status based on total paid vs capital (kobo comparison)
export type PaymentStatus = "Unpaid" | "Part Paid" | "Fully Paid" | "Overpaid";

export function getPaymentStatus(capital: number, totalPaid: number): PaymentStatus {
  const capKobo = Math.round(capital * 100);
  const paidKobo = Math.round(totalPaid * 100);

  if (paidKobo === 0) return "Unpaid";
  if (paidKobo < capKobo) return "Part Paid";
  if (paidKobo === capKobo) return "Fully Paid";
  return "Overpaid";
}

export function paymentStatusColor(status: PaymentStatus): string {
  switch (status) {
    case "Fully Paid": return "bg-green-100 text-green-700";
    case "Part Paid": return "bg-amber-100 text-amber-700";
    case "Overpaid": return "bg-blue-100 text-blue-700";
    case "Unpaid": return "bg-red-100 text-red-700";
  }
}

// Slot label: "0.5 slot", "1 slot", "1.5 slots", "10 slots"
export function slotLabel(units: number): string {
  const display = units % 1 === 0 ? String(units) : units.toFixed(1);
  return units <= 1 ? `${display} slot` : `${display} slots`;
}
