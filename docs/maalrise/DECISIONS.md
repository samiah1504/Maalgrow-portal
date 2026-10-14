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
- **New logins / invitations**: Phase 6 gave access to existing logins
  only; Phase 7 adds new logins and invitations (see below).

### Phase 7 — go-live readiness (confirmed 14 Oct 2026)

- **One person, one investor record.** Every MaalRise investor also has
  the MaalGrow investor record, so the login invitation, the **same KYC
  form**, Chat with Manager and the Communication Centre work for them
  unchanged. A MaalRise-only person's record has no MaalGrow
  investments. MaalGrow totals (dashboard, Reports) leave them out and
  the MaalGrow investor list tags them "MaalRise only". MaalGrow
  tables are never changed by MaalRise.
- **Onboarding.** Staff (super admin, administrator, operations) add a
  person by email; with no login yet, a login and investor record are
  created and **nothing is sent**. The invitation is sent only when a
  super admin or administrator presses "Send invitation". On first
  sign-in the investor fills the KYC form; staff review it in the
  existing KYC Review, and the result is carried to MaalRise
  (approved → verified; bank details, if MaalRise has none, carried
  across unconfirmed). MaalRise's own verifications are never undone.
- **Emails.** MaalRise emails (profit paid, capital repaid, bank-change
  decisions; staff reminders) are drafts until a super admin or
  administrator presses **Send** (or Discard) in MaalRise Emails. Each
  is sent once, through the same service and sender as MaalGrow;
  failures are kept to retry. Nothing is sent automatically.
- **Communication Centre.** MaalRise investors are selectable in
  Individual Investors (all, or one Cycle); campaigns are then built
  and sent exactly as for MaalGrow.
- **Reports.** Monthly payments register (for bank reconciliation),
  each Cycle's printable report and CSVs (received, investors), and the
  Cycle's full audit trail. Staff only.
- **Guide.** An in-app MaalRise Guide: who does what, from adding
  investors to closing a Cycle.

### Bulk import, Confirm all and Cycle emails (confirmed 14 Oct 2026, migration 057)

- **Import.** On a Cycle, super admins and administrators can import
  many investors' funding from a Google Sheet ("anyone with the link")
  or a CSV/Excel file with five columns: Full name, Email, Phone, Units,
  Date received (simplified 14 Oct 2026). **No bank details**: the
  investor gives them on the KYC form and staff confirm them as usual.
  No bank reference column either: each row gets a reference made from
  its email, units and date (a sheet's own "Bank reference" column is
  used if present). Every row is checked first
  (staff refused, whole units, no future dates, not more units than
  the Cycle still needs, no repeated references). Importing adds the
  person (a new login if needed — **nothing sent**) and RECORDS the
  funding. A reference already in the Cycle is skipped, so a repeat
  import adds nothing.
- **Confirm all.** One press confirms every recorded entry the person
  may confirm, through the same database rule as one by one; a super
  admin confirming their own entries gives one reason, kept on each.
- **Email all investors in this Cycle.** Available once funding is
  confirmed. A count is shown first (invitations for people who never
  signed in, with a fresh set-password link; notifications for people
  who already sign in), then one press sends. One email per investor
  per Cycle, however often pressed; failures stay to retry. Emailing
  all MaalRise investors at any time is the Communication Centre's
  MaalRise option.

### Activation without complete KYC and bank details (confirmed 14 Oct 2026, migration 058)

- A Cycle can be activated while some of its investors have not
  finished KYC or had their bank details confirmed. Both are listed as
  **warnings** with the number of investors affected, and kept in the
  activation's audit entry.
- Money is still protected where it moves: a profit distribution or a
  capital settlement cannot be approved while any investor in it has
  unconfirmed bank details (unchanged from 052/053).
- Every other check still blocks activation: approved terms, full
  funding, no funding awaiting confirmation, allocations reconciling,
  no suspended investor, the contract uploaded, a consistent maturity.

### View as investor (confirmed 14 Oct 2026, migration 059)

- Staff can open a read-only preview of exactly what one MaalRise
  investor sees: "View as investor" on the investor's MaalRise page.
- The figures come from the same database functions as the investor's
  own portal (059 makes them take the investor as a parameter), so the
  preview cannot differ. Staff only (not the payment officer); each
  view is recorded in the audit log; nothing can be changed or sent.

### Reopening a mistaken activation (confirmed 14 Oct 2026, migration 060)

- A super admin can put an active Cycle back to "terms approved",
  giving a reason (recorded with who activated it before), to correct
  the terms or add missed funding, then activate it again through the
  normal steps. Nothing is deleted; the earlier terms stay as
  superseded. Investors do not see the Cycle while it is reopened.
- Refused once any money has moved on the Cycle: a payment or capital
  received, a distribution or a capital settlement, in any status.

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
  them; approval freezes the version and its breakdown. *Changed 14 Oct
  2026 (migration 056):* a **super admin** may approve terms they
  prepared or submitted, and confirm funding they recorded, only by
  giving a reason, which is stored on the record and in the audit log.
  Everyone else still needs a different authorised person.
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
- **D11 MaalGrow investor creation** — unchanged; MaalRise creates the
  same investor record for MaalRise-only people (Phase 7).

## Still open — configurable, not blocking

| | Question | Current handling |
|---|---|---|
| A4 | Payment dates (first due date, weekends/holidays) | First payment one month after start; no adjustment |
| A11 | Unit definition | Whole units at a fixed naira price per Cycle |
| A12 | Tax treatment | Not configured |
