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

### Phase 4 — monthly profit distribution (confirmed 12 Oct 2026)

- **Recording payments received.** Finance, administrators and super
  admins record the amount, the ACTUAL date received and an optional
  reference. No bank receipt documents are uploaded.
- **Confirming.** An administrator or super admin confirms, including
  an entry they recorded themselves (no second person needed). Finance
  cannot confirm. A wrong unconfirmed entry is rejected with a reason;
  confirmed entries are final.
- **Reminders.** On the scheduled date, finance and admins get an
  in-app notification: "Today is the scheduled payment date for
  {counterparty}. Please record the payment received when available."
  If the month is still not fully recorded five days later, it is
  flagged for follow-up. Nothing is recorded as zero, assumed received,
  or distributed because a date passed. Scheduled and actual dates are
  kept apart.
- **Distribution.** Confirming a payment calculates the month's
  distribution automatically, for review and approval: the approved
  terms, the fee taken **in proportion to each payment** (A7, now
  decided), investors' shares by units of the whole Cycle with largest
  remainder to the kobo, the unsubscribed units' share unallocated, and
  a snapshot of each investor's confirmed bank account.
- **Part and late payments.** Only confirmed money is distributed; the
  rest stays outstanding. Each part is applied once. One open
  distribution per Cycle and month; money confirmed after that month's
  distribution was approved creates a follow-on distribution of the
  new money only. (Phase 5: entries above what is owed are refused.)
- **Approval.** An administrator or super admin approves; the person
  who prepared it may approve. Approval is refused while an investor's
  bank details are unconfirmed or changed since preparation (refresh
  first). Nobody is paid automatically.
- **Mark as Paid.** After the bank transfer is made outside MaalRise,
  the payment officer (or an administrator / super admin) records the
  transfer date and reference. The status lives in one place, the
  payment line, and every screen — including the Phase 6 investor
  portal — reads it there; an investor never sees "Paid" before it is
  recorded. Only a super admin reverses, with a reason; the history is
  append-only.
- **Notifications.** In-app for reminders, follow-ups and payment and
  distribution events. Emails are prepared as **unsent drafts**
  (`maalrise_email_outbox`, status `draft`) until sending is approved.
- **Contracts.** Cycle documents upload to the private
  `maalrise-documents` bucket; the contract is required for activation.
- **Activation lock removed.** As agreed, `MAALRISE_ACTIVATION_ENABLED`
  no longer exists. Activation is controlled by the approver roles
  (super admin, administrator) and the database's activation checklist,
  which re-runs on activation and refuses if any check fails.

### Phase 5 — capital settlement and closing (confirmed 13 Oct 2026)

- **A3 confirmed.** The cost (capital) is repaid in one sum at maturity;
  the markup is paid monthly.
- **Capital cannot be short at maturity.** Several capital entries are
  allowed (a split bank transfer), never above the capital owed, and
  investors are paid out **only once the full capital is confirmed** —
  never in part. Each investor gets back exactly the capital they
  funded, to their confirmed account. No fee or tax is taken from
  capital; the service fee comes from profit only.
- **No overpayment.** Payments are received outside the app and
  recorded, so an entry above what is still owed (monthly or capital)
  is refused as an entry error. Nothing is "held".
- **Correcting mistakes.** A super admin can reverse a confirmed entry
  (monthly or capital) with a reason, only until its distribution or
  capital settlement is approved; the figures are recalculated exactly
  and the entry's history is kept.
- **Closing.** A Cycle closes only when every month's profit and the
  capital have been received, distributed, approved and marked paid.
  **No write-offs.** A closed Cycle's payments are final.
- **No rollover.** Investors collect their money at maturity.
- Reminders on the maturity date and a follow-up five days later while
  the capital is not fully recorded; capital approval, Mark as Paid and
  super-admin reversal work as for monthly profit.

### Phase 6 — investor portal (confirmed 13 Oct 2026)

- **What investors see.** Their own Cycles: name, counterparty, dates,
  their units and capital, their expected profit for each month, and
  each profit and capital payment's status. **Never** the Cycle's total
  size, the markup rate, the service fee workings, other investors,
  staff notes or internal approvals. These come only from the
  `maalrise_my_*` database functions (migration 054); the direct read
  rules that would have let an investor read a Cycle's terms and
  schedule, the Cycle row, or their own record with KYC notes were
  removed.
- **Expected profit** is shown, labelled "Expected": the investor's
  share of each month's scheduled profit by units of the whole Cycle,
  largest remainder to the kobo, the same rule distributions use. If a
  month is paid in part, the portal shows what was actually paid.
- **Statuses**: Scheduled → Awaiting payment (date passed, nothing
  received yet) → Being processed (received; distribution under
  review) → Approved for payment → **Paid** (green, with date and
  reference) or Part paid. "Paid" appears only once staff marked the
  transfer paid; a super-admin reversal takes it back to Approved.
- **Bank detail changes**: the investor submits new details in the
  portal; one request at a time; they may withdraw it. Super admin,
  administrator or operations (the roles that already confirm bank
  details) approve — the new details become the confirmed account — or
  reject with a reason the investor sees. Until approved, payments go
  to the confirmed account. Payments already approved keep the account
  they were approved with.
- **Documents**: not shown to investors in Phase 6.
- **Statements**: a printable page (Print → Save as PDF) and a CSV of
  payments marked paid; accounts by their last four digits.
- **Product switch**: investors in both products switch between
  MaalGrow and MaalRise in the sidebar; MaalRise-only investors see
  MaalRise only; MaalGrow-only investors see no change.
- **New logins / invitations**: unchanged — MaalRise access is given
  only to existing logins; no invitations are sent.

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
- **D6 Shortfalls and excess** — partial distributions from confirmed
  monthly money; capital is paid out only in full. There is no excess:
  entries above what is owed are refused (Phase 5).
- **D7 Reversals** — super admin only, with a reason, history kept
  (built in Phase 4).
- **D8 Permissions** — prepare: super admin, administrator, operations;
  approve and activate: super admin, administrator; funding: super
  admin, administrator, finance; payment officer: payments only.
- **D9 Product switching** — investors in both products can switch.
- **D10 Staff emails** — staff accounts cannot be MaalRise investors.
- **D11 MaalGrow investor creation** — unchanged for now.

## Still open — configurable, not blocking

| | Question | Current handling |
|---|---|---|
| A4 | Payment dates (first due date, weekends/holidays) | First payment one month after start; no adjustment |
| A11 | Unit definition | Whole units at a fixed naira price per Cycle |
| A12 | Tax treatment | Not configured |
