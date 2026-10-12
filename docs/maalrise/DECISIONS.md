# MaalRise — business decisions

The rules MaalRise is built on, as confirmed by the business. Code,
database functions and tests must follow these; when one changes,
change it here first.

## Confirmed

### Markup rate — confirmed 12 Oct 2026 (was open assumption A2)

- The markup rate is entered **separately for each Cycle**; it can
  vary between transactions.
- The percentage entered is the **total markup for the whole Cycle
  duration**. It is never an annual rate and never a monthly rate.
- The system must never annualise it, multiply it by the number of
  months, or treat it as monthly.

| Cycle | Cost | Rate | Markup | Sale price* |
|---|---|---|---|---|
| 6 months | ₦10,000,000 | 30% | ₦3,000,000 | ₦13,000,000 |
| 12 months | ₦10,000,000 | 35% | ₦3,500,000 | ₦13,500,000 |

\*Before any separately applicable service fee.

Where it is enforced:

- `src/lib/maalrise/compute.ts` — `markup = cost × rate`, once.
- `maalrise_save_terms()` (migration 051) — recomputes the markup the
  same way and refuses terms whose figures differ by a kobo.
- New Cycle form — the field reads "Total markup for the Cycle (%)".
- Tests — `scripts/test-maalrise-compute.ts` (markup-rate block) and
  scenario R12 in `supabase/tests/maalrise_core_scenarios.sql`.

### Earlier decisions (Implementation Plan v2)

- **D1 Service fee** — per Cycle; basis cost, markup or fixed;
  treatment deducted from investors, charged to the counterparty, or
  waived; always separate from the markup.
- **D2 Schedule** — equal instalments or contract-specific amounts,
  reconciled to the kobo; rounding shown; no part-month prorating
  unless the contract requires it.
- **D3 Subscription** — drafts may be part-funded; activation refused
  until every check passes.
- **D4 Tax** — not configured; no withholding until the Nigerian
  treatment is confirmed.
- **D5 Approval** — whoever prepares or submits terms cannot approve
  them; approval freezes the version and its breakdown.
- **D6 Shortfalls and excess** — partial distributions where permitted;
  excess held unallocated until assigned (Phase 4).
- **D7 Reversals** — super admin only, with a reason, history kept
  (Phase 4).
- **D8 Permissions** — prepare: super admin, administrator, operations;
  approve and activate: super admin, administrator; funding: super
  admin, administrator, finance; payment officer: payments only.
- **D9 Product switching** — investors in both products can switch.
- **D10 Staff emails** — staff accounts cannot be MaalRise investors.
- **D11 MaalGrow investor creation** — unchanged for now.

## Still open — configurable, not blocking

| | Question | Current handling |
|---|---|---|
| A3 | Is markup paid monthly and cost repaid at maturity? | Schedule spreads markup monthly; capital settled separately at maturity |
| A4 | Payment dates (first due date, weekends/holidays) | First payment one month after start; no adjustment |
| A7 | When the fee is taken from receipts | Shown evenly across months; real rule set before distributions (Phase 4) |
| A11 | Unit definition | Whole units at a fixed naira price per Cycle |
| A12 | Tax treatment | Not configured |
