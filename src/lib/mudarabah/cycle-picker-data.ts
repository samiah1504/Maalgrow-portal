/**
 * What the cycle pickers show, derived rather than read off a counter.
 *
 * THE BUG THIS EXISTS TO PREVENT. Both pickers used to select
 * cycles.total_slots and cycles.total_investors. Those columns are
 * accumulators: nothing recalculates them, a trigger only ever applies
 * deltas (total_slots - OLD.units + NEW.units). The ledger editor, the
 * settlement engine and the investor report all use the thing itself —
 * SUM(investments.units) over active memberships. So the list and the
 * detail page could disagree, and did: 77 on one screen, 78 on the
 * next, with no indication which was real.
 *
 * The rule this file restores is the one the rest of the feature
 * follows: DERIVE ON READ. The membership rows are the truth. The
 * accumulator is reported alongside only so a disagreement is visible
 * instead of silent — a mismatch means a delta was missed somewhere,
 * which is worth knowing before anyone settles.
 *
 * Money here is NAIRA with two decimals, matching the columns it comes
 * from — not the integer kobo the ledger engine works in. Nothing in
 * this file feeds a calculation; it is all for display.
 *
 * SERVER ONLY.
 */

import type { MudarabahClient } from "./db";

export type PickerSeries = { id: string; name: string };

export type PickerCycle = {
  id: string;
  seriesId: string;
  label: string;
  startDate: string;
  endDate: string;
  status: string;

  /** Derived: SUM(units) over ACTIVE memberships. The figure that governs money. */
  totalSlots: number;
  /** Derived: COUNT of ACTIVE memberships. */
  investors: number;

  /** cycles.total_slots — the stored accumulator, for comparison only */
  storedSlots: number;
  /** cycles.total_investors — the stored accumulator, for comparison only */
  storedInvestors: number;

  /** totalSlots × the cycle's effective slot value, in naira */
  pooledCapital: number;
  /** cycles.amount_received — confirmed payments only, trigger-maintained */
  amountReceived: number;

  /** null when this cycle has no ledger — nothing is backfilled */
  ledgerStatus: string | null;
};

/** Naira, two decimals. Anything under half a kobo is float noise. */
const EPSILON = 0.005;

/** The stored counter disagrees with the memberships that produced it. */
export function slotsDrifted(c: PickerCycle): boolean {
  return Math.abs(c.storedSlots - c.totalSlots) > EPSILON;
}

/**
 * Slots are held that no confirmed payment covers — or money is in
 * that no slot accounts for. Positive means underfunded.
 */
export function fundingGap(c: PickerCycle): number {
  const gap = c.pooledCapital - c.amountReceived;
  return Math.abs(gap) > EPSILON ? gap : 0;
}

/**
 * Load every series and cycle for a picker.
 *
 * Four queries in parallel. The memberships query is the only one that
 * grows with the investor base, and it selects two columns over active
 * rows only.
 */
export async function loadPickerCycles(
  db: MudarabahClient
): Promise<{ series: PickerSeries[]; cycles: PickerCycle[] }> {
  const [{ data: series }, { data: cycles }, { data: ledgers }, { data: memberships }] =
    await Promise.all([
      db.from("series").select("id, name, price_per_unit").order("name"),
      db
        .from("cycles")
        .select(
          "id, series_id, cycle_label, start_date, end_date, status, unit_value, total_slots, total_investors, amount_received"
        )
        .order("start_date", { ascending: false }),
      db.from("mudarabah_ledgers").select("cycle_id, status"),
      db.from("investments").select("cycle_id, units").eq("status", "active"),
    ]);

  const ledgerByCycle = new Map(
    (ledgers ?? []).map((l) => [l.cycle_id, l.status as string])
  );

  // The same COALESCE(c.unit_value, s.price_per_unit) that
  // mudarabah_effective_unit_value() applies, so the picker and the
  // ledger editor cannot value a slot differently.
  const priceBySeries = new Map(
    (series ?? []).map((s) => [s.id, Number(s.price_per_unit ?? 0)])
  );

  const derived = new Map<string, { slots: number; investors: number }>();
  for (const m of memberships ?? []) {
    const at = derived.get(m.cycle_id) ?? { slots: 0, investors: 0 };
    at.slots += Number(m.units ?? 0);
    at.investors += 1;
    derived.set(m.cycle_id, at);
  }

  return {
    series: (series ?? []).map((s) => ({ id: s.id, name: String(s.name) })),
    cycles: (cycles ?? []).map((c) => {
      const at = derived.get(c.id) ?? { slots: 0, investors: 0 };
      const unitValue =
        c.unit_value != null
          ? Number(c.unit_value)
          : priceBySeries.get(c.series_id) ?? 0;

      return {
        id: c.id,
        seriesId: c.series_id,
        label: c.cycle_label,
        startDate: c.start_date,
        endDate: c.end_date,
        status: c.status,
        totalSlots: at.slots,
        investors: at.investors,
        storedSlots: Number(c.total_slots ?? 0),
        storedInvestors: Number(c.total_investors ?? 0),
        pooledCapital: at.slots * unitValue,
        amountReceived: Number(c.amount_received ?? 0),
        ledgerStatus: ledgerByCycle.get(c.id) ?? null,
      };
    }),
  };
}
